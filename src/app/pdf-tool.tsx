import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { showDialog } from '@/components/app-dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ReaderScreenHeader, ToolScreenHeader as ScreenHeader } from '@/components/tool-screen-header';
import { AppLoader } from '@/components/app-loader';
import { useHeaderShare } from '@/components/header-share';
import { PdfToolLayoutContext } from '@/features/pdf/pdf-tool-layout';
import { ToolButton } from '@/components/tool-button';
import { usePalette } from '@/theme/colors';
import { PdfViewer } from '@/features/pdf/pdf-viewer';
import { handleReaderBack, handleReaderHelp } from '@/features/pdf/reader-back';
import { PdfTextEditor } from '@/features/pdf/pdf-text-editor';
import { OrganizePdf } from '@/features/pdf/organize-pdf';
import { EditPdfPages } from '@/features/pdf/edit-pdf-pages';
import { ArrangePdfPages } from '@/features/pdf/arrange-pdf-pages';
import { ImageToPdf } from '@/features/pdf/image-to-pdf';
import { AdvancedPdfTool } from '@/features/pdf/advanced-pdf-tool';
import { File } from 'expo-file-system';
import { createImportDirectory, disposeImports, savedPdfDirectory } from '@/features/files/file-storage';
import { savePdfResult } from '@/features/files/save-file';
import { showSavedPdf } from '@/features/pdf/open-pdf-screen';
import { toast } from '@/components/toast';
import { createPdfToolForWorkingCopy, forgetPdfToolSession, getPdfToolSession, implementedPdfTools, retainPdfEditingSource, type PdfTool } from '@/features/pdf/pdf-tool-session';
import { copyPdf, currentPdfHandoff, usePdfHandoffState } from '@/features/pdf/pdf-handoff';
import { PDF_SECTIONS } from '@/constants/pdf-methods';
import { ToolboxSheet } from '@/components/toolbox-sheet';
import { recordToolUse } from '@/features/search/search-history';
import { ControlHelpProvider, useControlHelp } from '@/components/control-help';

const pdfMethods = PDF_SECTIONS.flatMap(section => [...section.tools]);

export default function PdfToolScreen() {
  const { session } = useLocalSearchParams<{ session: string }>();
  // Switching tools replaces this route with a new session, so each session gets a fresh tool.
  return <ControlHelpProvider><PdfToolContent key={session} /></ControlHelpProvider>;
}

function PdfToolContent() {
  const { session: id, landscape: openedLandscape } = useLocalSearchParams<{ session: string; landscape?: string }>();
  const [session] = useState(() => getPdfToolSession(id));
  const colors = usePalette();
  const mounted = useRef(true);
  const [focused, setFocused] = useState(false);
  const [surrounding, setSurrounding] = useState(false);
  const [typing, setTyping] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const discardDraft = useRef<() => Promise<void>>(() => Promise.resolve());
  const registerDiscard = useCallback((action: () => Promise<void>) => { discardDraft.current = action; }, []);
  const [landscape, setLandscape] = useState(openedLandscape === '1');
  const layout = useMemo(() => ({ landscape, setLandscape }), [landscape]);
  const share = useHeaderShare();
  const help = useControlHelp();
  const handoff = usePdfHandoffState();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  // A carried working copy saved from this screen becomes the original for later tools.
  const [workingSaved, setWorkingSaved] = useState<{ uri: string; name: string } | null>(null);
  const carriedUnsaved = !!session?.carried && !workingSaved && !handoff?.saved;
  const leaveUnsaved = unsaved || carriedUnsaved;
  const toolSections = useMemo(() => PDF_SECTIONS.map(section => ({ title: section.title, data: section.tools.filter(item => implementedPdfTools.has(item.id) && item.id !== 'from_image' && item.id !== session?.tool) }))
    .filter(section => section.data.length), [session?.tool]);
  useEffect(() => { if (session) recordToolUse(`PDF:${session.tool}`); }, [session]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        forgetPdfToolSession(id);
        // The processing tools defer cleanup until their native jobs finish.
        if (session?.tool === 'viewer') disposeImports(session.directory);
      });
    };
  }, [id, session]);
  function leave() { Keyboard.dismiss(); if (router.canGoBack()) router.back(); else router.replace('/(modules)/documents'); }
  function close() {
    if (switchingRef.current) return;
    if (help?.close()) return;
    if (session?.tool === 'viewer' && handleReaderBack()) return;
    if (!leaveUnsaved) { leave(); return; }
    Keyboard.dismiss();
    showDialog('Discard PDF edits?', 'Your changes to this PDF have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { void discardDraft.current().then(leave).catch(() => showDialog('Draft could not be discarded', 'Try again to avoid recovering these edits next time.')); } },
    ], { ios: 'exclamationmark.triangle', android: 'warning' });
  }
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!leaveUnsaved && !switching) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (!switching) closeRef.current(); return true; });
    return () => subscription.remove();
  }, [leaveUnsaved, switching]);
  function chooseTool(next: string) {
    if (!session || switchingRef.current) return;
    const current = currentPdfHandoff();
    if (current?.blocked) { showDialog('Continue with one PDF', current.blocked, undefined, { ios: 'square.grid.2x2', android: 'apps' }); return; }
    if (!current) { showDialog('Create the PDF first', 'Finish this tool, then continue with another tool.', undefined, { ios: 'square.grid.2x2', android: 'apps' }); return; }
    if (current.pending) {
      showDialog('Continue without these changes?', current.pending, [
        { text: 'Stay', style: 'cancel' },
        { text: 'Continue', onPress: () => void switchTool(next) },
      ], { ios: 'square.grid.2x2', android: 'apps' });
      return;
    }
    void switchTool(next);
  }
  async function switchTool(next: string) {
    const method = pdfMethods.find(item => item.id === next);
    const current = currentPdfHandoff();
    if (!session || !method || !current || switchingRef.current) return;
    if (current.blocked) { showDialog('Continue with one PDF', current.blocked); return; }
    switchingRef.current = true;
    Keyboard.dismiss();
    setSwitching(true);
    const directory = createImportDirectory();
    try {
      directory.create({ intermediates: true, idempotent: true });
      const file = new File(directory, 'source.pdf');
      await current.write(file.uri);
      if (!file.exists || !file.size) throw new Error('The PDF could not be prepared for the next tool.');
      const changed = current.changed;
      const switched = current.switched;
      const saved = current.saved ?? (switched ? undefined : workingSaved ?? undefined);
      const inherited = !switched && !!session.carried;
      const carried = saved ? changed : inherited || changed;
      let origin = saved ?? (switched ? switched.origin : session.origin);
      // Before any carried change this file is still the original, so later tools can save over it and keep drafts.
      if (!origin && !inherited && session.tool !== 'from_image') origin = await retainPdfEditingSource(switched?.file ?? session.files[0]);
      if (!mounted.current) { disposeImports(directory); return; }
      // The next tool continues these edits, so a recovered draft would only duplicate them.
      if (changed) await discardDraft.current().catch(() => undefined);
      const name = origin?.name ?? session.files[0]?.name ?? 'Document.pdf';
      const nextId = createPdfToolForWorkingCopy(next as PdfTool, method.title, directory, { uri: file.uri, name, mimeType: 'application/pdf', size: file.size }, { origin, carried, returnRoute: session.returnRoute });
      router.replace({ pathname: '/pdf-tool', params: landscape ? { session: nextId, landscape: '1' } : { session: nextId } });
    } catch (cause) {
      disposeImports(directory);
      if (mounted.current) showDialog('Could not open the tool', (cause as Error).message || 'Please try again.', undefined, { ios: 'exclamationmark.triangle', android: 'warning' });
    } finally { switchingRef.current = false; if (mounted.current) setSwitching(false); }
  }
  async function saveWorkingCopy() {
    if (!session) return;
    const library = savedPdfDirectory();
    library.create({ intermediates: true, idempotent: true });
    // Saving takes ownership of its output, so it gets a copy and the working file stays open here.
    const output = new File(library, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    try {
      await copyPdf(session.files[0].uri, output.uri);
      const saved = await savePdfResult({ uri: output.uri, name: session.origin?.name ?? session.files[0].name }, session.origin, undefined, false);
      if (!saved) { if (output.exists) output.delete(); return; }
      toast(`Saved to ${saved.device.location}`);
      if (mounted.current && !showSavedPdf(saved.file, session.returnRoute)) setWorkingSaved({ uri: saved.file.uri, name: saved.file.name });
    } catch (cause) { if (output.exists) output.delete(); throw cause; }
  }
  // Tools without their own changes still save what earlier tools carried in.
  const saveAction = carriedUnsaved && !handoff?.changed ? { label: 'Save PDF', onPress: saveWorkingCopy } : undefined;
  const tool = session?.tool;
  const canSwitch = !!session && tool !== 'viewer';
  const Header = tool === 'viewer' ? ReaderScreenHeader : ScreenHeader;
  // Bottom inset is owned by ToolRail / PdfPreviewFooter so docks sit just above the system nav bar.
  return <PdfToolLayoutContext.Provider value={layout}><SafeAreaView style={[styles.screen, { backgroundColor: colors.systemBackground }]} edges={['top', 'left', 'right']}>
    <Stack.Screen options={{ gestureEnabled: !leaveUnsaved && !switching, orientation: landscape ? 'landscape' : 'portrait' }} />
    {!focused && !surrounding && !typing && <Header title={session?.title ?? 'PDF'} subtitle={tool === 'viewer' ? undefined : session?.origin?.name ?? session?.files[0]?.name} onBack={close} share={share} save={saveAction} leading={switching ? <AppLoader accessibilityLabel="Opening the next tool" /> : undefined}
      tool={session?.tool} helpIntercept={session?.tool === 'viewer' ? handleReaderHelp : undefined}
      menu={[...(canSwitch ? [{ id: 'tools', label: 'All tools', disabled: switching, selected: toolsOpen, icon: { ios: 'wrench.and.screwdriver' as const, android: 'mdi:toolbox-outline' as const }, onPress: () => { Keyboard.dismiss(); setToolsOpen(true); } }] : []), { id: 'orientation', label: landscape ? 'Portrait view' : 'Landscape view', disabled: switching, icon: { ios: 'rotate.right', android: 'screen-rotation' }, onPress: () => setLandscape(value => !value) }]} />}
    {!session ? <View style={styles.empty}><ThemedText>Select a file from the PDF tools to get started.</ThemedText><ToolButton title="Back to PDF tools" onPress={close} /></View>
      : tool === 'viewer' ? <PdfViewer initialDocument={session.files[0]} onFocusChange={setFocused} onSurroundChange={setSurrounding} />
      : tool === 'edit_text' || tool === 'remove_text' || tool === 'text' || tool === 'replace_text' ? <PdfTextEditor initialSelection={session} onUnsavedChange={setUnsaved} onTypingChange={setTyping} onDiscardReady={registerDiscard} initialMode={tool === 'text' ? 'add' : tool === 'remove_text' ? 'delete' : tool === 'replace_text' ? 'replace' : 'edit'} />
      : tool === 'merge' || tool === 'split' ? <OrganizePdf operation={tool} initialSelection={session} />
      : tool === 'extract' || tool === 'delete' ? <EditPdfPages operation={tool} initialSelection={session} />
      : tool === 'reorder' || tool === 'rotate' ? <ArrangePdfPages operation={tool} initialSelection={session} />
      : tool === 'from_image' ? <ImageToPdf initialSelection={session} />
      : <AdvancedPdfTool session={session} onUnsavedChange={setUnsaved} onDiscardReady={registerDiscard} />}
    {canSwitch && <ToolboxSheet visible={toolsOpen} title="All tools" subtitle={session?.origin?.name ?? session?.files[0]?.name ?? 'PDF'} caption="Your changes carry into the next tool. Save when you are done." sections={toolSections} footer={<View />} onClose={() => setToolsOpen(false)} onAction={chooseTool} />}
  </SafeAreaView></PdfToolLayoutContext.Provider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, empty: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
});

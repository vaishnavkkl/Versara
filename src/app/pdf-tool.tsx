import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { showDialog } from '@/components/app-dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/screen-header';
import { useHeaderShare } from '@/components/header-share';
import { UniversalIcon } from '@/components/universal-icon';
import { PdfToolLayoutContext } from '@/features/pdf/pdf-tool-layout';
import { ToolButton } from '@/components/tool-button';
import { usePalette } from '@/theme/colors';
import { PdfViewer } from '@/features/pdf/pdf-viewer';
import { handleReaderBack } from '@/features/pdf/reader-back';
import { PdfTextEditor } from '@/features/pdf/pdf-text-editor';
import { OrganizePdf } from '@/features/pdf/organize-pdf';
import { EditPdfPages } from '@/features/pdf/edit-pdf-pages';
import { ArrangePdfPages } from '@/features/pdf/arrange-pdf-pages';
import { ImageToPdf } from '@/features/pdf/image-to-pdf';
import { AdvancedPdfTool } from '@/features/pdf/advanced-pdf-tool';
import { disposeImports } from '@/features/files/file-storage';
import { forgetPdfToolSession, getPdfToolSession } from '@/features/pdf/pdf-tool-session';
import { recordToolUse } from '@/features/search/search-history';

export default function PdfToolScreen() {
  const { session: id, landscape: openedLandscape } = useLocalSearchParams<{ session: string; landscape?: string }>();
  const [session] = useState(() => getPdfToolSession(id));
  const colors = usePalette();
  const mounted = useRef(true);
  const [focused, setFocused] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const discardDraft = useRef<() => Promise<void>>(() => Promise.resolve());
  const registerDiscard = useCallback((action: () => Promise<void>) => { discardDraft.current = action; }, []);
  const [landscape, setLandscape] = useState(openedLandscape === '1');
  const [pageRows, setPageRows] = useState(0);
  const registerPageRow = useCallback(() => {
    setPageRows(count => count + 1);
    return () => setPageRows(count => count - 1);
  }, []);
  const layout = useMemo(() => ({ landscape, setLandscape, registerPageRow }), [landscape, registerPageRow]);
  const share = useHeaderShare();
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
    if (session?.tool === 'viewer' && handleReaderBack()) return;
    if (!unsaved) { leave(); return; }
    Keyboard.dismiss();
    showDialog('Discard PDF edits?', 'Your changes to this PDF have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { void discardDraft.current().then(leave).catch(() => showDialog('Draft could not be discarded', 'Try again to avoid recovering these edits next time.')); } },
    ], { ios: 'exclamationmark.triangle', android: 'warning' });
  }
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!unsaved) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => subscription.remove();
  }, [unsaved]);
  const tool = session?.tool;
  return <PdfToolLayoutContext.Provider value={layout}><SafeAreaView style={[styles.screen, { backgroundColor: colors.systemBackground }]} edges={['top', 'bottom', 'left', 'right']}>
    <Stack.Screen options={{ gestureEnabled: !unsaved, orientation: landscape ? 'landscape' : 'portrait' }} />
    {!focused && <ScreenHeader title={session?.title ?? 'PDF'} onBack={close} share={share} save={share?.save}>
      {!pageRows && <Pressable accessibilityRole="button" accessibilityLabel={landscape ? 'Switch to portrait' : 'Switch to landscape'} accessibilityState={{ selected: landscape }} onPress={() => { Keyboard.dismiss(); setLandscape(value => !value); }} style={({ pressed }) => [styles.orientation, { opacity: pressed ? .6 : 1 }]}><UniversalIcon ios="rotate.right" android="screen-rotation" size={22} color={colors.systemBlue} /></Pressable>}
    </ScreenHeader>}
    {!session ? <View style={styles.empty}><ThemedText>Select a file from the PDF tools to get started.</ThemedText><ToolButton title="Back to PDF tools" onPress={close} /></View>
      : tool === 'viewer' ? <PdfViewer initialDocument={session.files[0]} onFocusChange={setFocused} />
      : tool === 'edit_text' || tool === 'remove_text' || tool === 'text' || tool === 'replace_text' ? <PdfTextEditor initialSelection={session} onUnsavedChange={setUnsaved} onDiscardReady={registerDiscard} initialMode={tool === 'text' ? 'add' : tool === 'remove_text' ? 'delete' : tool === 'replace_text' ? 'replace' : 'edit'} />
      : tool === 'merge' || tool === 'split' ? <OrganizePdf operation={tool} initialSelection={session} />
      : tool === 'extract' || tool === 'delete' ? <EditPdfPages operation={tool} initialSelection={session} />
      : tool === 'reorder' || tool === 'rotate' ? <ArrangePdfPages operation={tool} initialSelection={session} />
      : tool === 'from_image' ? <ImageToPdf initialSelection={session} />
      : <AdvancedPdfTool session={session} onUnsavedChange={setUnsaved} onDiscardReady={registerDiscard} />}
  </SafeAreaView></PdfToolLayoutContext.Provider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, empty: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  orientation: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});

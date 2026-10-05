import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { AppLoader, withLoading } from '@/components/app-loader';
import { ScreenHeader } from '@/components/screen-header';
import { HeaderOrientationButton } from '@/components/header-orientation';
import { router, Stack, useLocalSearchParams, useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { File } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { HelpButton } from '@/components/help-button';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { ToolButton } from '@/components/tool-button';
import { PdfViewer } from '@/features/pdf/pdf-viewer';
import { handleReaderBack, handleReaderHelp } from '@/features/pdf/reader-back';
import { MediaPreview } from '@/features/files/media-preview';
import { ImageViewer } from '@/features/files/image-viewer';
import { saveImageWorkspace, useImageWorkspace } from '@/features/files/image-workspace';
import { MediaOptions } from '@/features/files/media-options';
import { EDITOR_TOOL_TABS, MediaToolbar } from '@/features/files/media-toolbar';
import { getRecentFile, touchRecentFile, type RecentFile } from '@/features/files/recent-files';
import { formatSize } from '@/features/files/file-storage';
import { saveExistingFile } from '@/features/files/save-file';
import { createImagePdfToolForFile, discardPdfToolSession } from '@/features/pdf/pdf-tool-session';
import { useScreenActive } from '@/hooks/use-screen-active';
import { usePalette } from '@/theme/colors';
import { getGradients, typography as t } from '@/theme/dashboard';
import { recordToolUse } from '@/features/search/search-history';
import { ADVANCED_IMAGE_TOOLS } from '@/features/files/image-tools';
import { FileEngine } from '../../modules/file-engine';
import { takePreviewFile } from '@/features/files/preview-handoff';

export default function FilePreviewScreen() {
  const { id, uri: resultUri, name: resultName, revision } = useLocalSearchParams<{ id: string; uri?: string; name?: string; revision?: string }>();
  const colors = usePalette();
  const active = useScreenActive();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const [initialFile] = useState(() => revision ? null : takePreviewFile(id));
  const handoff = useRef(initialFile);
  const [file, setFile] = useState<RecentFile | null>(initialFile);
  const [transitionReady, setTransitionReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialFile);
  const [options, setOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openingTool, setOpeningTool] = useState(false);
  const [toolActivation, setToolActivation] = useState(active);
  if (toolActivation !== active) { setToolActivation(active); if (active) setOpeningTool(false); }
  const [focused, setFocused] = useState(false);
  const [surrounding, setSurrounding] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  // Decode/upload the first image only after the native push/pop animation completes.
  // The timeout covers direct links/non-animated mounts that do not emit transitionEnd.
  useLayoutEffect(() => {
    if (!active) return;
    const fallback = setTimeout(() => setTransitionReady(true), 1000);
    const unsubscribe = navigation.addListener('transitionEnd', event => {
      if (!event.data.closing) { clearTimeout(fallback); setTransitionReady(true); }
    });
    return () => { clearTimeout(fallback); unsubscribe(); setTransitionReady(false); };
  }, [active, navigation]);
  useEffect(() => {
    mounted.current = true;
    if (resultUri || !active || !transitionReady) return () => { mounted.current = false; };
    let cancelled = false;
    const known = !revision && handoff.current?.id === id ? handoff.current : null;
    handoff.current = null;
    void (known ? Promise.resolve(known) : getRecentFile(id)).then(value => {
      if (!value || !new File(value.uri).exists) throw new Error('This file is no longer available. Open it again from your files.');
      if (!cancelled) { setFile(value); setError(null); }
      // Updating Recents must not turn a successfully opened image into a preview error.
      if (!cancelled) void touchRecentFile(value.id).catch(() => undefined);
    }).catch(cause => { if (!cancelled) setError((cause as Error).message || 'Could not open this file.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; mounted.current = false; };
  }, [active, id, resultUri, revision, transitionReady]);
  // Image tools apply into a shared working copy; the preview shows it and saves everything once.
  const workspace = useImageWorkspace(id ?? '');
  const [working, setWorking] = useState<RecentFile | null>(null);
  useEffect(() => {
    if (resultUri || !active || file?.kind !== 'image') return;
    let cancelled = false;
    void workspace.resolve().then(value => { if (!cancelled) setWorking(workspace.changed && value ? value : null); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [active, file, resultUri, workspace]);
  const shown = working ?? file;
  function leave() { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }
  function close() {
    if (handleReaderBack()) return;
    if (working && !busy) {
      showDialog('Save your changes?', 'Changes applied in image tools have not been saved yet.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { void workspace.discard().then(() => { setWorking(null); leave(); }).catch(cause => setError((cause as Error).message)); } },
        { text: 'Save', onPress: () => { void saveChanges(); } },
      ], { ios: 'photo', android: 'image' });
      return;
    }
    leave();
  }
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!working || !active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => subscription.remove();
  }, [working, active]);
  async function saveChanges() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const saved = await saveImageWorkspace(workspace);
      if (!saved || !mounted.current) return;
      setWorking(null);
      toast(`Saved to ${saved.device.location}`);
      if (saved.recent) router.replace({ pathname: '/file-preview', params: { id: saved.recent.id, revision: String(Date.now()) } });
    } catch (cause) { if (mounted.current) setError((cause as Error).message || 'Could not save the image.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function discardChanges() {
    showDialog('Discard all changes?', 'Every change applied in image tools since the last save will be removed.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { void workspace.discard().then(() => setWorking(null)).catch(cause => setError((cause as Error).message)); } },
    ], { ios: 'arrow.uturn.backward', android: 'undo' });
  }
  async function action(value: string) {
    if (!file || lock.current) return;
    setOptions(false);
    if (value === 'save' && working) { await saveChanges(); return; }
    if (file.kind === 'image' && ((ADVANCED_IMAGE_TOOLS.has(value) && FileEngine?.nativeImageToolsVersion) || value === 'text' || value === 'edit_text' || EDITOR_TOOL_TABS[value])) {
      lock.current = true; setOpeningTool(true);
      // Release the full-resolution preview before another native image canvas opens.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (mounted.current) {
        if (value === 'text' || value === 'edit_text') router.push({ pathname: '/image-text', params: { id: file.id, mode: value === 'text' ? 'add' : 'edit' } });
        else if (EDITOR_TOOL_TABS[value]) router.push({ pathname: '/image-editor', params: { id: file.id, tab: EDITOR_TOOL_TABS[value], tool: value } });
        else router.push({ pathname: '/image-tool', params: { id: file.id, tool: value } });
        recordToolUse(`Image:${value}`);
      }
      lock.current = false; return;
    }
    if (value === 'info') { showDialog('File details', `${file.name}\n${formatSize(file.size)}\n${file.mimeType}`, undefined, { ios: 'info.circle', android: 'info-outline' }); return; }
    lock.current = true; setBusy(true); setError(null);
    let session: string | null = null;
    const target = working ?? file;
    try {
      if (value === 'pdf') {
        toast('Preparing PDF…');
        session = await withLoading('Preparing your PDF…', () => createImagePdfToolForFile(target));
        if (!mounted.current) { discardPdfToolSession(session); return; }
        router.push({ pathname: '/pdf-tool', params: { session } });
      } else if (value === 'save') {
        const saved = await saveExistingFile(target);
        if (saved && mounted.current) showDialog('Saved', `${saved.file.name}\nSaved to ${saved.device.location}`, undefined, { ios: 'checkmark.circle', android: 'check-circle' });
      } else if (value === 'share') {
        const Sharing = await import('expo-sharing');
        if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
        if (mounted.current) await Sharing.shareAsync(target.uri, { mimeType: target.mimeType.includes('*') ? undefined : target.mimeType, dialogTitle: 'Share' });
      }
    } catch (cause) { if (session) discardPdfToolSession(session); if (mounted.current) setError((cause as Error).message || 'Could not complete this action. Try again.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <Stack.Screen options={{ gestureEnabled: !working, ...(!resultUri && file?.kind !== 'pdf' ? { orientation: landscape ? 'landscape' as const : 'portrait' as const } : {}), animation: resultUri || file?.kind === 'pdf' ? 'none' : 'slide_from_right' }} />
    {!focused && !surrounding && <ScreenHeader variant="close" title={resultUri ? resultName ?? 'PDF' : file?.name ?? 'Preview'} onBack={close} trailing={<HeaderOrientationButton />}><HelpButton tool={resultUri || file?.kind === 'pdf' ? 'viewer' : undefined} intercept={handleReaderHelp} /></ScreenHeader>}
    {loading && !resultUri ? <View style={styles.empty}><AppLoader /><ThemedText>Opening file...</ThemedText></View> : <>
      {error && !resultUri && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
      {resultUri ? <PdfViewer key={`${resultUri}:${revision}`} initialDocument={{ uri: resultUri, name: resultName ?? 'Document.pdf' }} onFocusChange={setFocused} onSurroundChange={setSurrounding} /> : !file ? <View style={styles.empty}><ToolButton title="Back to recent files" onPress={close} /></View> : file.kind === 'pdf' ? <PdfViewer key={file.uri} initialDocument={file} onFocusChange={setFocused} onSurroundChange={setSurrounding} /> : <>
        {file.kind === 'image' ? <ImageViewer file={shown ?? file} revision={revision} busy={busy || openingTool} active={active} showImage={active && transitionReady && !openingTool} landscape={landscape}
          changed={!!working} onSurroundChange={setSurrounding} onSave={() => void saveChanges()} onDiscard={discardChanges}
          onToggleLandscape={() => setLandscape(value => !value)} onAction={value => void action(value)} onClose={close} />
        : file.kind === 'video' ? <View style={[styles.screen, landscape && styles.row]}>
          {landscape && <MediaToolbar side="left" kind={file.kind} busy={busy} landscape onToggleLandscape={() => setLandscape(value => !value)} onAction={value => void action(value)} />}
          {active && transitionReady ? <MediaPreview key={`${file.uri}:${revision ?? ''}`} file={file} onClose={close} /> : <View style={styles.empty}>{active && <AppLoader />}</View>}
          <MediaToolbar kind={file.kind} busy={busy} landscape={landscape} onToggleLandscape={() => setLandscape(value => !value)} onAction={value => void action(value)} />
        </View> : <>
        {active ? <MediaPreview key={file.uri} file={file} onClose={close} /> : <View style={styles.screen} />}<View style={[styles.footer, { borderColor: colors.separator }]}><ThemedText style={[styles.meta, { color: colors.secondaryLabel }]}>{formatSize(file.size)}</ThemedText><Pressable accessibilityRole="button" accessibilityLabel={`${file.kind} toolbox`} disabled={busy} onPress={() => setOptions(true)} style={[styles.options, getGradients(colors).module]}>{busy ? <AppLoader color={colors.moduleText} /> : <UniversalIcon ios="wrench.and.screwdriver" android="handyman" size={20} color={colors.moduleText} />}<ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>{busy ? 'Preparing...' : 'Toolbox'}</ThemedText></Pressable></View>
        <MediaOptions file={file} visible={options && active} onClose={() => setOptions(false)} onAction={value => void action(value)} /></>}
      </>}
    </>}
  </SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, row: { flexDirection: 'row' }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }, error: { padding: 16 }, footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 }, meta: { flex: 1, ...t.caption }, options: { minHeight: 48, borderRadius: 24, paddingHorizontal: 20, gap: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' } });

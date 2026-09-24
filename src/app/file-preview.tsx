import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppLoader, withLoading } from '@/components/app-loader';
import { ScreenHeader } from '@/components/screen-header';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { File } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { HelpButton } from '@/components/help-button';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { ToolButton } from '@/components/tool-button';
import { PdfViewer } from '@/features/pdf/pdf-viewer';
import { MediaPreview } from '@/features/files/media-preview';
import { MediaOptions } from '@/features/files/media-options';
import { EDITOR_TOOL_TABS, MediaToolbar } from '@/features/files/media-toolbar';
import { getRecentFile, touchRecentFile, type RecentFile } from '@/features/files/recent-files';
import { formatSize } from '@/features/files/file-storage';
import { concreteMimeType, saveToDevice } from '@/features/files/save-file';
import { createImagePdfToolForFile, discardPdfToolSession } from '@/features/pdf/pdf-tool-session';
import { useScreenActive } from '@/hooks/use-screen-active';
import { usePalette } from '@/theme/colors';
import { getGradients, typography as t } from '@/theme/dashboard';

export default function FilePreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = usePalette();
  const active = useScreenActive();
  const [file, setFile] = useState<RecentFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void getRecentFile(id).then(async value => {
      if (!value || !new File(value.uri).exists) throw new Error('This file is no longer available. Open it again from your files.');
      if (!cancelled) setFile(value);
      await touchRecentFile(value.id);
    }).catch(cause => { if (!cancelled) setError((cause as Error).message || 'Could not open this file.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; mounted.current = false; };
  }, [id]);
  function close() { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }
  async function action(value: string) {
    if (!file || lock.current) return;
    setOptions(false);
    if (value === 'text' || value === 'edit_text') { router.push({ pathname: '/image-text', params: { id: file.id, mode: value === 'text' ? 'add' : 'edit' } }); return; }
    if (EDITOR_TOOL_TABS[value]) { router.push({ pathname: '/image-editor', params: { id: file.id, tab: EDITOR_TOOL_TABS[value] } }); return; }
    if (value === 'info') { showDialog('File details', `${file.name}\n${formatSize(file.size)}\n${file.mimeType}`, undefined, { ios: 'info.circle', android: 'info-outline' }); return; }
    lock.current = true; setBusy(true); setError(null);
    let session: string | null = null;
    try {
      if (value === 'pdf') {
        toast('Preparing PDF…');
        session = await withLoading('Preparing your PDF…', () => createImagePdfToolForFile(file));
        if (!mounted.current) { discardPdfToolSession(session); return; }
        router.push({ pathname: '/pdf-tool', params: { session } });
      } else if (value === 'save') {
        const saved = await withLoading('Saving to your device…', () => saveToDevice(file.uri, file.name, concreteMimeType(file)));
        if (mounted.current) showDialog('Saved to your device', `${saved.name}\nSaved to ${saved.location}`, undefined, { ios: 'checkmark.circle', android: 'check-circle' });
      } else if (value === 'share') {
        const Sharing = await import('expo-sharing');
        if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
        if (mounted.current) await Sharing.shareAsync(file.uri, { mimeType: file.mimeType.includes('*') ? undefined : file.mimeType, dialogTitle: 'Share' });
      }
    } catch (cause) { if (session) discardPdfToolSession(session); if (mounted.current) setError((cause as Error).message || 'Could not complete this action. Try again.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <Stack.Screen options={{ orientation: landscape ? 'landscape' : 'portrait' }} />
    {!focused && <ScreenHeader variant="close" title={file?.name ?? 'Preview'} onBack={close}><HelpButton tool={file?.kind === 'pdf' ? 'viewer' : undefined} /></ScreenHeader>}
    {loading ? <View style={styles.empty}><AppLoader /><ThemedText>Opening file...</ThemedText></View> : <>
      {error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
      {!file ? <View style={styles.empty}><ToolButton title="Back to recent files" onPress={close} /></View> : file.kind === 'pdf' ? <PdfViewer initialDocument={file} onFocusChange={setFocused} /> : <>
        {file.kind === 'image' || file.kind === 'video' ? <View style={[styles.screen, landscape && styles.row]}>
          {active ? <MediaPreview key={file.uri} file={file} onClose={close} /> : <View style={styles.screen} />}
          <MediaToolbar kind={file.kind} busy={busy} landscape={landscape} onToggleLandscape={() => setLandscape(value => !value)} onAction={value => void action(value)} />
        </View> : <>
        {active ? <MediaPreview key={file.uri} file={file} onClose={close} /> : <View style={styles.screen} />}<View style={[styles.footer, { borderColor: colors.separator }]}><ThemedText style={[styles.meta, { color: colors.secondaryLabel }]}>{formatSize(file.size)}</ThemedText><Pressable accessibilityRole="button" accessibilityLabel={`${file.kind} toolbox`} disabled={busy} onPress={() => setOptions(true)} style={[styles.options, getGradients(colors).module]}>{busy ? <AppLoader color={colors.moduleText} /> : <UniversalIcon ios="wrench.and.screwdriver" android="handyman" size={20} color={colors.moduleText} />}<ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>{busy ? 'Preparing...' : 'Toolbox'}</ThemedText></Pressable></View>
        <MediaOptions file={file} visible={options && active} onClose={() => setOptions(false)} onAction={value => void action(value)} /></>}
      </>}
    </>}
  </SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, row: { flexDirection: 'row' }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }, error: { padding: 16 }, footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 }, meta: { flex: 1, ...t.caption }, options: { minHeight: 48, borderRadius: 24, paddingHorizontal: 20, gap: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' } });

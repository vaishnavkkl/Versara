import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { File } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { HelpButton } from '@/components/help-button';
import { ToolButton } from '@/components/tool-button';
import { PdfViewer } from '@/features/pdf/pdf-viewer';
import { MediaPreview } from '@/features/files/media-preview';
import { MediaOptions } from '@/features/files/media-options';
import { getRecentFile, touchRecentFile, type RecentFile } from '@/features/files/recent-files';
import { formatSize } from '@/features/files/file-storage';
import { createImagePdfToolForFile, discardPdfToolSession } from '@/features/pdf/pdf-tool-session';
import { useScreenActive } from '@/hooks/use-screen-active';
import { usePalette } from '@/theme/colors';
import { getGradients } from '@/theme/dashboard';

export default function FilePreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = usePalette();
  const active = useScreenActive();
  const [file, setFile] = useState<RecentFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState(false);
  const [busy, setBusy] = useState(false);
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
    if (value === 'info') { Alert.alert('File details', `${file.name}\n${formatSize(file.size)}\n${file.mimeType}`); return; }
    lock.current = true; setBusy(true); setError(null);
    let session: string | null = null;
    try {
      if (value === 'pdf') {
        session = await createImagePdfToolForFile(file);
        if (!mounted.current) { discardPdfToolSession(session); return; }
        router.push({ pathname: '/pdf-tool', params: { session } });
      } else if (value === 'save') {
        const Sharing = await import('expo-sharing');
        if (!(await Sharing.isAvailableAsync())) throw new Error('Saving is not available on this device.');
        if (mounted.current) await Sharing.shareAsync(file.uri, { mimeType: file.mimeType.includes('*') ? undefined : file.mimeType, dialogTitle: 'Save a copy' });
      }
    } catch (cause) { if (session) discardPdfToolSession(session); if (mounted.current) setError((cause as Error).message || 'Could not complete this action. Try again.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <View style={[styles.header, { borderColor: colors.separator }]}><ThemedText numberOfLines={1} style={styles.title}>{file?.name ?? 'Preview'}</ThemedText><HelpButton tool={file?.kind === 'pdf' ? 'viewer' : undefined} /><Pressable accessibilityRole="button" accessibilityLabel="Close preview" onPress={close} style={[styles.close, { backgroundColor: colors.navBackground }]}><UniversalIcon ios="xmark" android="close" size={24} color={colors.navIcon} /></Pressable></View>
    {loading ? <View style={styles.empty}><ActivityIndicator color={colors.systemBlue} /><ThemedText>Opening file...</ThemedText></View> : <>
      {error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
      {!file ? <View style={styles.empty}><ToolButton title="Back to recent files" onPress={close} /></View> : file.kind === 'pdf' ? <PdfViewer initialDocument={file} /> : <>
        {active ? <MediaPreview key={file.uri} file={file} /> : <View style={styles.screen} />}
        <View style={[styles.footer, { borderColor: colors.separator }]}><ThemedText style={{ flex: 1, color: colors.secondaryLabel }}>{formatSize(file.size)}</ThemedText><Pressable accessibilityRole="button" accessibilityLabel={`${file.kind} options`} disabled={busy} onPress={() => setOptions(true)} style={[styles.options, getGradients(colors).module]}>{busy ? <ActivityIndicator color={colors.moduleText} /> : <UniversalIcon ios="ellipsis" android="more-horiz" size={22} color={colors.moduleText} />}<ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>{busy ? 'Preparing...' : 'Options'}</ThemedText></Pressable></View>
        <MediaOptions file={file} visible={options && active} onClose={() => setOptions(false)} onAction={value => void action(value)} />
      </>}
    </>}
  </SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, header: { minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth }, title: { flex: 1, fontSize: 16, fontWeight: '600' }, close: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }, error: { padding: 16 }, footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 }, options: { minHeight: 48, borderRadius: 24, paddingHorizontal: 20, gap: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' } });

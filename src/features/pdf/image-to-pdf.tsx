import { rememberPdfResults, forgetRecentUri } from '../files/recent-files';
import { toast } from '@/components/toast';
import type { InitialSelection } from './pdf-tool-session';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { Host, Picker } from '@expo/ui';
import { PdfEngine, type ImagePdfOptions, type PdfResult } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { useAppearance, usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, formatSize, savedPdfDirectory, shareFile, type LocalFile } from '../files/file-storage';
import { savePdfResult } from '../files/save-file';
import { openPdfScreen } from './open-pdf-screen';

export function ImageToPdf({ initialSelection }: { initialSelection?: InitialSelection } = {}) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const [directory] = useState(() => initialSelection?.directory ?? createImportDirectory());
  const [files, setFiles] = useState<LocalFile[]>(initialSelection?.files ?? []);
  const [name, setName] = useState('Images');
  const [pageSize, setPageSize] = useState<ImagePdfOptions['pageSize']>('a4');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<(PdfResult & { name: string }) | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const job = useRef<string | null>(null);
  const nativeAvailable = !!PdfEngine?.imagesToPdf;
  useEffect(() => {
    mounted.current = true;
    const listener = nativeAvailable ? PdfEngine?.addListener('onConversionProgress', event => {
      if (event.jobId === job.current && mounted.current) setProgress(event.completed / event.total);
    }) : undefined;
    return () => {
      mounted.current = false;
      listener?.remove();
      // The async operation owns cleanup until native code has released its inputs.
      queueMicrotask(() => {
        if (mounted.current) return;
        if (job.current) PdfEngine?.cancelConversion(job.current);
        if (!locked.current) disposeImports(directory);
      });
    };
  }, [directory, nativeAvailable]);

  async function addImages() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const picked = await browseFiles(directory, true, 30 - files.length);
      if (mounted.current) setFiles(current => [...current, ...picked]);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not open the images.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); else disposeImports(directory); }
  }

  function reorder(index: number, offset: number) {
    setFiles(current => { const next = [...current]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  }

  async function convert() {
    if (!PdfEngine?.imagesToPdf || locked.current || !files.length) return;
    locked.current = true; setBusy(true); setProgress(0); setError(''); setCancelling(false);
    toast('Creating PDF…');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    job.current = id;
    const safeName = name.trim().replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 60) || 'Images';
    const timestamp = new Date().toISOString().replace(/[T:.]/g, '-').replace(/Z$/, '');
    const outputName = `${safeName}-${timestamp}.pdf`;
    try {
      const output = new File(savedPdfDirectory(), outputName);
      const created = await PdfEngine.imagesToPdf({ jobId: id, uris: files.map(file => file.uri), outputUri: output.uri, pageSize });
      if (mounted.current) setResult({ ...created, name: outputName });
      toast('PDF created and saved');
      // History failure must not discard an otherwise successful native export.
      void rememberPdfResults([{ ...created, name: outputName }]).catch(() => {});
      // Preserve completed PDFs in app storage if the sheet closes at completion.
    } catch (cause) {
      const failure = cause as { code?: string; message?: string };
      if (mounted.current) setError(failure.code === 'PDF_CANCELLED' ? 'Conversion cancelled. Your images are ready to try again.' : failure.message ?? 'Could not create the PDF.');
    } finally {
      job.current = null; locked.current = false;
      if (mounted.current) { setBusy(false); setProgress(null); setCancelling(false); } else disposeImports(directory);
    }
  }

  async function saveResult() {
    if (!result || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const saved = await savePdfResult(result);
      if (saved && mounted.current) setResult(current => current && { ...current, uri: saved.file.uri, name: saved.file.name });
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save the PDF.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); else disposeImports(directory); }
  }

  async function share() {
    if (!result || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await shareFile({ uri: result.uri, mimeType: 'application/pdf' }); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not share the PDF.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); else disposeImports(directory); }
  }


  if (result) return <View style={styles.result}>
    <UniversalIcon ios="checkmark.circle.fill" android="check-circle" size={48} color={colors.systemBlue} />
    <ThemedText style={styles.heading}>Your PDF is ready</ThemedText>
    <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{result.pageCount} pages · {formatSize(result.size)}{ '\n' }Save it to your device or share a copy.</ThemedText>
    <ThemedText numberOfLines={2} style={styles.body}>{result.name}</ThemedText>
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    <ToolButton title="Open PDF" onPress={() => result && openPdfScreen(result)} disabled={busy} />
    <ToolButton title="Save to device" onPress={saveResult} disabled={busy} />
    <ToolButton title="Share" secondary onPress={share} disabled={busy} />
    <ToolButton title="Create another PDF" secondary onPress={() => { setResult(null); setError(''); }} disabled={busy} />
    <ToolButton title="Delete this PDF" secondary disabled={busy} onPress={() => {
      try { new File(result.uri).delete(); void forgetRecentUri(result.uri).catch(() => {}); setResult(null); setError(''); }
      catch { setError('Could not delete the PDF. Please try again.'); }
    }} />
  </View>;

  return <View style={styles.screen}>
    <FlatList initialNumToRender={6} maxToRenderPerBatch={4} windowSize={5} data={files} keyExtractor={file => file.uri} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" ListHeaderComponent={<View style={styles.form}>
      <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>One image per page, in your chosen order. JPG, PNG and device-supported HEIC. Up to 30 images.</ThemedText>
      {!nativeAvailable && <ThemedText accessibilityRole="alert">Install a new development build to use native image-to-PDF conversion.</ThemedText>}
      <ToolButton title={files.length ? 'Add images from Files' : 'Browse files'} onPress={addImages} disabled={busy || files.length >= 30} />
      <ThemedText style={styles.label}>PDF name</ThemedText>
      <TextInput accessibilityLabel="PDF name" value={name} onChangeText={setName} editable={!busy} maxLength={64} style={[styles.input, { color: colors.label, backgroundColor: colors.accentSurface }]} />
      <View style={styles.options}><ThemedText style={styles.label}>Page size</ThemedText><Host colorScheme={mode} seedColor={colors.accent} matchContents><Picker selectedValue={pageSize} onValueChange={setPageSize} enabled={!busy}><Picker.Item label="A4" value="a4" /><Picker.Item label="Letter" value="letter" /><Picker.Item label="Fit image" value="image" /></Picker></Host></View>
      <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>A4 and Letter use a small white margin and follow each image’s orientation. Images fit without cropping.</ThemedText>
      {!!files.length && <ThemedText style={styles.label}>Page order · {files.length} images</ThemedText>}
    </View>} renderItem={({ item, index }) => <View style={[styles.row, { backgroundColor: colors.accentSurface }]}>
      <Image source={{ uri: item.uri }} style={styles.thumbnail} contentFit="contain" cachePolicy="none" recyclingKey={item.uri} accessibilityLabel={`Page ${index + 1}: ${item.name}`} />
      <View style={styles.fileName}><ThemedText style={styles.label}>{index + 1}</ThemedText><ThemedText numberOfLines={1} style={styles.body}>{item.name}</ThemedText></View>
      {([-1, 1] as const).map(offset => <Pressable key={offset} accessibilityRole="button" accessibilityLabel={`Move page ${index + 1} ${offset < 0 ? 'up' : 'down'}`} disabled={busy || index + offset < 0 || index + offset >= files.length} onPress={() => reorder(index, offset)} style={[styles.smallButton, { opacity: busy || index + offset < 0 || index + offset >= files.length ? 0.3 : 1 }]}><UniversalIcon ios={offset < 0 ? 'chevron.up' : 'chevron.down'} android={offset < 0 ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color={colors.systemBlue} /></Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove page ${index + 1}`} disabled={busy} onPress={() => setFiles(current => current.filter(file => file.uri !== item.uri))} style={styles.smallButton}><UniversalIcon ios="xmark" android="close" size={20} color={colors.systemBlue} /></Pressable>
    </View>} />
    <View style={[styles.footer, { borderColor: colors.separator }]}>
      {!!error && <ThemedText accessibilityRole="alert" style={styles.body}>{error}</ThemedText>}
      {busy && <AppLoader />}
      {progress !== null ? <><ThemedText accessibilityLiveRegion="polite">{cancelling ? 'Cancelling…' : progress === 1 ? 'Saving PDF…' : `Creating pages… ${Math.round(progress * 100)}%`}</ThemedText><ToolButton title="Cancel conversion" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelConversion(job.current); } }} /></> : <ToolButton title={`Create PDF${files.length ? ` · ${files.length} pages` : ''}`} disabled={!files.length || busy || !nativeAvailable} onPress={convert} />}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, list: { padding: s.lg, gap: s.sm }, form: { gap: s.md, paddingBottom: s.lg },
  body: { ...t.body }, label: { ...t.label }, heading: { ...t.heading },
  input: { minHeight: 48, paddingHorizontal: s.lg, borderRadius: radius.sm, ...t.body },
  options: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', gap: s.xs, alignItems: 'center', borderRadius: radius.sm, padding: s.xs },
  thumbnail: { width: 44, height: 58, borderRadius: 6 }, fileName: { flex: 1, minWidth: 0, paddingHorizontal: s.xs },
  smallButton: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: s.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: s.sm },
  result: { flex: 1, padding: s.xl, gap: s.lg, justifyContent: 'center' },
});

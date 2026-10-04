import { rememberPdfResults, forgetRecentUri } from '../files/recent-files';
import { toast } from '@/components/toast';
import type { InitialSelection } from './pdf-tool-session';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { PdfEngine, type ImagePdfOptions, type PdfResult } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, formatSize, savedPdfDirectory, shareFile, shareNamedFile, type LocalFile } from '../files/file-storage';
import { usePublishHeaderShare } from '@/components/header-share';
import { savePdfResult } from '../files/save-file';
import { openPdfScreen } from './open-pdf-screen';
import { PdfPreviewBody, PdfPreviewFooter, PdfPreviewStage, PdfPreviewToolbar } from './pdf-preview';
import { PdfFileOptionsSheet } from './pdf-file-options-sheet';
import { PdfSourceCard } from './pdf-source-card';
import { EditorOption } from '@/components/editor-option';
import { useScreenActive } from '@/hooks/use-screen-active';
import { useVisibleListItems } from '@/hooks/use-visible-list-items';
import { responsiveToolbarStyles } from '../editor/responsive-editor-toolbar';

export function ImageToPdf({ initialSelection }: { initialSelection?: InitialSelection } = {}) {
  const colors = usePalette();
  const active = useScreenActive();
  const { width, fontScale } = useWindowDimensions();
  const columns = width < 340 || fontScale > 1.5 ? 1 : 2;
  const { visibleKeys, onViewableItemsChanged, viewabilityConfig } = useVisibleListItems();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!active || previewIndex === null) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { setPreviewIndex(null); return true; });
    return () => listener.remove();
  }, [active, previewIndex]);
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
  usePublishHeaderShare({ disabled: busy || !result, label: result ? 'Share new PDF' : 'Share is available after creating the PDF',
    onShare: () => result && shareNamedFile({ uri: result.uri, name: result.name, size: result.size, mimeType: 'application/pdf' }),
    save: { disabled: busy || (!result && (!files.length || !nativeAvailable)), label: result ? 'Save new PDF to device' : 'Create PDF',
      onSave: () => result ? saveResult() : convert() } });
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


  if (result) return <ScrollView contentContainerStyle={styles.result}>
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
  </ScrollView>;

  if (previewIndex !== null && files[previewIndex]) return <View style={styles.screen}>
    <PdfPreviewBody toolbar={<PdfPreviewToolbar page={previewIndex + 1} count={files.length} onPageChange={value => setPreviewIndex(value - 1)} />}>
      <PdfPreviewStage hint="Image source - one image per PDF page.">
        {active && <Image source={{ uri: files[previewIndex].uri }} style={styles.screen} contentFit="contain" cachePolicy="none" recyclingKey={files[previewIndex].uri} />}
      </PdfPreviewStage>
    </PdfPreviewBody>
    <PdfPreviewFooter><ToolButton title="Back to tool" secondary onPress={() => setPreviewIndex(null)} /></PdfPreviewFooter>
  </View>;

  return <View style={styles.screen}>
    <PdfFileOptionsSheet visible={optionsOpen} onClose={() => setOptionsOpen(false)} name={name} onName={setName} disabled={busy}
      description="One image per page, in your chosen order. Up to 30 images. A4 and Letter add a small white margin and follow each image's orientation. Images fit without cropping." />
    <FlatList key={columns} initialNumToRender={6} maxToRenderPerBatch={4} windowSize={5} data={files} numColumns={columns} keyExtractor={file => file.uri} contentContainerStyle={styles.list} columnWrapperStyle={columns > 1 ? styles.columns : undefined}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
      ListHeaderComponent={<View style={styles.form}>
        <ThemedText style={styles.label}>{files.length ? `Page order - ${files.length} images` : 'Choose images to get started.'}</ThemedText>
        {!!files.length && <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Tap a card to preview. Use the arrows to change the order.</ThemedText>}
        {!nativeAvailable && <ThemedText accessibilityRole="alert">Install a new development build to use native image-to-PDF conversion.</ThemedText>}
      </View>}
      renderItem={({ item, index }) => <PdfSourceCard uri={item.uri} name={item.name} label={`Page ${index + 1}`} detail={formatSize(item.size)} kind="image" active={active && visibleKeys.has(item.uri)} disabled={busy} fullWidth={columns === 1}
        onPreview={() => setPreviewIndex(index)} onMove={offset => reorder(index, offset)} onRemove={() => setFiles(current => current.filter(file => file.uri !== item.uri))} canMoveBack={index > 0} canMoveForward={index + 1 < files.length} />} />
    <PdfPreviewFooter>
      {!!error && <ThemedText accessibilityRole="alert" style={styles.body}>{error}</ThemedText>}
      <View style={responsiveToolbarStyles.row}>{([{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'image', label: 'Fit image' }] as const).map(item => <EditorOption key={item.value} compact label={item.label} selected={pageSize === item.value} disabled={busy} onPress={() => setPageSize(item.value)} />)}</View>
      {busy && <AppLoader />}
      {progress !== null ? <><ThemedText accessibilityLiveRegion="polite">{cancelling ? 'Cancelling...' : progress === 1 ? 'Saving PDF...' : `Creating pages... ${Math.round(progress * 100)}%`}</ThemedText><ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelConversion(job.current); } }} /></> : <View style={responsiveToolbarStyles.row}>
        <EditorOption compact label="Options" icon={{ ios: 'slider.horizontal.3', android: 'tune' }} disabled={busy} selected={optionsOpen} onPress={() => setOptionsOpen(true)} />
        <EditorOption compact label="Add images" icon={{ ios: 'photo.badge.plus', android: 'add-photo-alternate' }} disabled={busy || !nativeAvailable || files.length >= 30} onPress={() => void addImages()} />
        <View style={[responsiveToolbarStyles.primary, { minWidth: 120 }]}><ToolButton title="Create PDF" disabled={!files.length || busy || !nativeAvailable} onPress={convert} /></View>
      </View>}
    </PdfPreviewFooter>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, columns: { justifyContent: 'space-between' }, list: { padding: s.lg, gap: s.sm }, form: { gap: s.md, paddingBottom: s.lg },
  body: { ...t.body }, label: { ...t.label }, heading: { ...t.heading },
  input: { minHeight: 48, paddingHorizontal: s.lg, borderRadius: radius.sm, ...t.body },
  options: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', gap: s.xs, alignItems: 'center', borderRadius: radius.sm, padding: s.xs },
  thumbnail: { width: 44, height: 58, borderRadius: 6 }, fileName: { flex: 1, minWidth: 0, paddingHorizontal: s.xs },
  smallButton: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: s.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: s.sm },
  result: { flexGrow: 1, padding: s.xl, gap: s.lg, justifyContent: 'center' },
});

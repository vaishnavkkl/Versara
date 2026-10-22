import { EditorActionBar } from '@/components/editor-action-bar';
import { forgetRecentUri } from '../files/recent-files';
import { toast } from '@/components/toast';
import type { InitialSelection } from './pdf-tool-session';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { PdfEngine, type ImagePdfOptions, type PdfResult } from '../../../modules/pdf-engine';
import { HandoffScreen } from '@/components/handoff-screen';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, formatSize, savedPdfDirectory, shareFile, shareNamedFile, type LocalFile } from '../files/file-storage';
import { usePublishHeaderShare } from '@/components/header-share';
import { copyPdf, usePublishPdfHandoff } from './pdf-handoff';
import { savePdfResult } from '../files/save-file';
import { openPdfScreen, showSavedPdf } from './open-pdf-screen';
import { PdfPreviewBody, PdfPreviewFooter, PdfPreviewStage, PdfPreviewToolbar } from './pdf-preview';
import { PdfFileOptionsSheet } from './pdf-file-options-sheet';
import { PdfSourceCard } from './pdf-source-card';
import { EditorOption } from '@/components/editor-option';
import { useScreenActive } from '@/hooks/use-screen-active';
import { useVisibleListItems } from '@/hooks/use-visible-list-items';

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
  const [result, setResult] = useState<(PdfResult & { name: string; location?: string }) | null>(null);
  // The saved PDF opens by itself; until then the result screen stays hidden.
  const [leaving, setLeaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const job = useRef<string | null>(null);
  const nativeAvailable = !!PdfEngine?.imagesToPdf;
  usePublishHeaderShare({ disabled: busy || !result, label: result ? 'Share new PDF' : 'Share is available after creating the PDF',
    onShare: () => result && shareNamedFile({ uri: result.uri, name: result.name, size: result.size, mimeType: 'application/pdf' }),
    save: { disabled: busy || !!result?.location || (!result && (!files.length || !nativeAvailable)), label: result?.location ? 'PDF saved' : 'Save PDF',
      onSave: () => result ? saveResult() : convert() } });
  usePublishPdfHandoff(true, {
    changed: !!result && !result.location,
    saved: result?.location ? { uri: result.uri, name: result.name } : undefined,
    blocked: busy ? 'Wait for the current task to finish, then choose another tool.' : !result ? 'Create the PDF first, then choose another tool.' : undefined,
    write: outputUri => result ? copyPdf(result.uri, outputUri) : Promise.reject(new Error('Create the PDF first.')),
  });
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
    if (!PdfEngine?.imagesToPdf || locked.current) return;
    if (!files.length) { toast('Add at least one image first.'); return; }
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
      if (mounted.current) { setResult({ ...created, name: outputName }); setLeaving(true); }
      const saved = await savePdfResult({ ...created, name: outputName }, undefined, { mode: 'new', name: outputName }, false);
      toast(saved ? `Saved to ${saved.device.location}` : 'PDF created');
      if (saved && mounted.current && showSavedPdf(saved.file)) return;
      // Preserve completed PDFs in app storage if the save does not finish.
      if (mounted.current) { setLeaving(false); if (saved) setResult({ ...created, uri: saved.file.uri, name: saved.file.name, location: saved.device.location }); }
    } catch (cause) {
      if (mounted.current) setLeaving(false);
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
      const saved = await savePdfResult(result, undefined, undefined, false);
      if (saved) toast(`Saved to ${saved.device.location}`);
      if (saved && mounted.current && showSavedPdf(saved.file)) { setLeaving(true); return; }
      if (saved && mounted.current) setResult(current => current && { ...current, uri: saved.file.uri, name: saved.file.name, location: saved.device.location });
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


  if (leaving) return <HandoffScreen label="Saving and opening your PDF…" />;
  if (result) return <ScrollView contentContainerStyle={styles.result}>
    <UniversalIcon ios="checkmark.circle.fill" android="check-circle" size={48} color={colors.systemBlue} />
    <ThemedText style={styles.heading}>Your PDF is ready</ThemedText>
    <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{result.pageCount} pages · {formatSize(result.size)}{ '\n' }{result.location ? `Saved to ${result.location}` : 'Your PDF is ready. Save to finish.'}</ThemedText>
    <ThemedText numberOfLines={2} style={styles.body}>{result.name}</ThemedText>
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    <ToolButton title="Open PDF" onPress={() => result && openPdfScreen(result)} disabled={busy} />
    {!result.location && <ToolButton title="Save" onPress={saveResult} disabled={busy} />}
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
      {busy ? <><AppLoader /><ThemedText accessibilityLiveRegion="polite">{cancelling ? 'Cancelling...' : progress === 1 ? 'Saving PDF...' : progress !== null ? `Creating pages... ${Math.round(progress * 100)}%` : 'Working…'}</ThemedText>{progress !== null && <ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelConversion(job.current); } }} />}</> : <>
        <ThemedText accessibilityLiveRegion="polite" style={styles.caption}>{files.length ? `${files.length} ${files.length === 1 ? 'image' : 'images'} · one page each` : 'Add images to get started.'}</ThemedText>
        <EditorActionBar>
          <EditorOption compact label="A4" selected={pageSize === 'a4'} icon={{ ios: 'doc', android: 'description' }} onPress={() => setPageSize('a4')} />
          <EditorOption compact label="Letter" selected={pageSize === 'letter'} icon={{ ios: 'doc.plaintext', android: 'article' }} onPress={() => setPageSize('letter')} />
          <EditorOption compact label="Fit image" selected={pageSize === 'image'} icon={{ ios: 'photo', android: 'image' }} onPress={() => setPageSize('image')} />
          <EditorOption compact label="Options" icon={{ ios: 'slider.horizontal.3', android: 'tune' }} selected={optionsOpen} onPress={() => setOptionsOpen(true)} />
          <EditorOption compact label="Add images" icon={{ ios: 'photo.badge.plus', android: 'add-photo-alternate' }} disabled={!nativeAvailable || files.length >= 30} onPress={() => void addImages()} />
          <ToolButton title="Save PDF" disabled={!files.length || !nativeAvailable} onPress={convert} icon={{ ios: 'square.and.arrow.down', android: 'save' }} />
        </EditorActionBar>
      </>}
    </PdfPreviewFooter>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, columns: { justifyContent: 'space-between' }, list: { padding: s.lg, gap: s.sm }, form: { gap: s.md, paddingBottom: s.lg },
  body: { ...t.body }, label: { ...t.label }, heading: { ...t.heading }, caption: { ...t.caption },
  input: { minHeight: 48, paddingHorizontal: s.lg, borderRadius: radius.sm, ...t.body },
  result: { flexGrow: 1, padding: s.xl, gap: s.lg, justifyContent: 'center' },
});

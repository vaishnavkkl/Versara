import { useStableCallback } from '@/hooks/use-stable-callback';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { Checkbox, Host } from '@expo/ui';
import { FileEngine, type ImagePrivacyFinding, type ImagePrivacyScan } from '../../../modules/file-engine';
import { PdfEngine } from '../../../modules/pdf-engine';
import PdfMarkupView, { type PdfMark, type PdfMarkChange } from '../../../modules/pdf-engine/src/PdfMarkupView';
import { AppLoader } from '@/components/app-loader';
import { showDialog } from '@/components/app-dialog';
import { EditorOption } from '@/components/editor-option';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { useAppearance, usePalette } from '@/theme/colors';
import { useScreenActive } from '@/hooks/use-screen-active';
import { useEditHistory } from '../editor/use-edit-history';
import { recordEditedFile } from '../files/edited-files';
import { browseFiles, createImportDirectory, disposeImports, formatSize, shareNamedFile, type LocalFile } from '../files/file-storage';
import { getRecentFile, rememberFile } from '../files/recent-files';
import { askNewFileName, saveToDevice } from '../files/save-file';
import { ZoomableImage } from '../files/zoomable-image';
import { PdfDocumentPreview } from '../pdf/pdf-document-preview';
import { PdfPreviewToolbar, PdfPagePreview, PdfPreviewFooter, PdfPreviewStage } from '../pdf/pdf-preview';
import { usePdfScreenActive } from '../pdf/use-pdf-screen-active';

type Mode = 'scan' | 'pdf_scan' | 'redact' | 'metadata';
type Rect = { x: number; y: number; width: number; height: number };
type Finding = ImagePrivacyFinding;
type Scan = ImagePrivacyScan;
type Info = { width: number; height: number; size: number; mimeType: string; camera: string; taken: string; hasLocation: boolean };
type Output = LocalFile & { width: number; height: number; coverCount?: number };
type Phase = 'idle' | 'opening' | 'scanning' | 'preparing' | 'saving' | 'sharing';
const TITLES: Record<Mode, string> = { scan: 'Privacy Review', pdf_scan: 'Redact PDF', redact: 'Redact Image', metadata: 'Remove Metadata' };
const CATEGORY_LABELS: Record<string, string> = { personal: 'Personal', financial: 'Financial', identity: 'Identity', authentication: 'Authentication', location: 'Location', other: 'Other' };
const RECTANGLE = JSON.stringify([[0, 0], [1, 0], [1, 1], [0, 1]]);
const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
const deleteTemporary = (uri?: string) => { if (uri) try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Session cleanup retries. */ } };
const findingMark = (finding: Finding, page = 1): PdfMark => ({
  id: 'scan-' + finding.id, page, kind: 'polygon', color: '#000000', fillColor: '#000000', opacity: 1, width: .001,
  points: [[finding.x, finding.y], [finding.x + finding.width, finding.y], [finding.x + finding.width, finding.y + finding.height], [finding.x, finding.y + finding.height]],
});
function markRect(mark: PdfMark): Rect {
  const xs = mark.points.map(point => point[0]), ys = mark.points.map(point => point[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
function safeMark(mark: PdfMark): PdfMark {
  if (!Array.isArray(mark.points) || mark.points.length < 2 || mark.points.length > 8
    || mark.points.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value) || value < 0 || value > 1))) {
    throw new Error('Draw a rectangle inside the image.');
  }
  const rect = markRect(mark);
  if (rect.width <= 0 || rect.height <= 0) throw new Error('Make the cover a little larger.');
  return {
    id: mark.id ?? uid(), page: 1, kind: 'polygon', color: '#000000', fillColor: '#000000', opacity: 1, width: .001,
    points: [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]],
  };
}

/** OCR findings and originals stay in this session; only an explicitly saved PNG enters the library. */
export function PrivacyEditor({ id, mode }: { id?: string; mode: Mode }) {
  const colors = usePalette();
  const isPdf = mode === 'pdf_scan';
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [progress, setProgress] = useState('');
  const pdfInput = useRef<LocalFile | null>(null);
  const active = usePdfScreenActive();
  const screenActive = useScreenActive();
  const available = !!FileEngine?.nativeImagePrivacyVersion && (!isPdf || !!PdfEngine?.nativePdfPrivacyVersion);
  const canSelect = !!PdfMarkupView && !!PdfEngine?.nativeMarkupEditingVersion;
  const [directory] = useState(createImportDirectory);
  const [source, setSource] = useState<LocalFile | null>(null);
  const [info, setInfo] = useState<Info>();
  const [basePreview, setBasePreview] = useState<Output>();
  const [scan, setScan] = useState<Scan>();
  const [preview, setPreview] = useState<Output>();
  const [saved, setSaved] = useState<Output>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewing, setReviewing] = useState(mode === 'metadata');
  const [selecting, setSelecting] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [fit, setFit] = useState(0);
  const history = useEditHistory<PdfMark[]>([]);
  const marks = history.value;
  const marksJson = useMemo(() => JSON.stringify(marks.filter(mark => mark.page === page).map(mark => ({ ...mark, page: 1 }))), [marks, page]);
  const selectedFindingIds = useMemo(() => new Set(marks.map(mark => mark.id)), [marks]);
  const mounted = useRef(true);
  const locked = useRef(false);
  const cancelled = useRef(false);
  const initial = useRef(false);
  const autoScanned = useRef(false);
  const jobs = useRef(new Map<string, { scan: boolean; pdf?: boolean; promise: Promise<unknown> }>());
  const pending = useRef(new Set<Promise<unknown>>());
  const closeRef = useRef<() => void>(() => {});
  const busy = phase !== 'idle';
  const editing = !preview && !saved;
  const cancelJobs = useCallback(() => {
    cancelled.current = true;
    jobs.current.forEach((job, key) => job.pdf ? PdfEngine?.cancelPdfTool(key) : job.scan ? FileEngine?.cancelPrivacyScan(key) : FileEngine?.cancelImageJob(key));
  }, []);
  function launch(operation: Promise<unknown>) {
    pending.current.add(operation);
    void operation.finally(() => pending.current.delete(operation));
  }
  async function perform(nextPhase: Phase, operation: () => Promise<void>) {
    if (locked.current || !mounted.current) return;
    locked.current = true; cancelled.current = false; setPhase(nextPhase); setError(''); setNotice(''); setProgress('');
    try { await operation(); }
    catch (cause) { if (mounted.current && !cancelled.current) setError(cause instanceof Error ? cause.message : 'The image could not be processed. Try again.'); }
    finally {
      locked.current = false;
      if (mounted.current) {
        if (cancelled.current && nextPhase === 'scanning') setNotice(current => current || 'Scan stopped. Tap Scan again when you are ready.');
        setPhase('idle');
      }
    }
  }
  const runImage = useCallback(async (request: Record<string, unknown>) => {
    if (!FileEngine?.nativeImagePrivacyVersion) throw new Error('Update the app build to use native privacy tools.');
    const key = uid(), promise = FileEngine.processImage(key, JSON.stringify(request));
    jobs.current.set(key, { scan: false, promise });
    try { return await promise; } finally { jobs.current.delete(key); }
  }, []);
  const runPdf = useCallback(async (request: Record<string, unknown>) => {
    if (!PdfEngine?.nativePdfPrivacyVersion) throw new Error('Update the app build to redact PDFs.');
    const key = uid(), promise = PdfEngine.processPdf(key, JSON.stringify(request));
    jobs.current.set(key, { scan: false, pdf: true, promise });
    try { return JSON.parse(await promise) as { info?: { pageCount: number }; outputs?: { uri: string; size: number; pageCount: number }[] }; }
    finally { jobs.current.delete(key); }
  }, []);
  useEffect(() => {
    const listener = isPdf ? PdfEngine?.addListener('onConversionProgress', event => {
      if (mounted.current && jobs.current.get(event.jobId)?.pdf) setProgress(`${event.completed} / ${event.total} pages`);
    }) : undefined;
    return () => listener?.remove();
  }, [isPdf]);
  async function renderPdfPage(file: LocalFile, number: number) {
    if (!mounted.current || cancelled.current) return false;
    const output = new File(directory, 'page-' + uid() + '.png');
    let accepted = false;
    try {
      await runPdf({ operation: 'preview', uri: file.uri, pages: [number], outputUris: [output.uri], format: 'png' });
      if (!mounted.current || cancelled.current) return false;
      const details = await runImage({ action: 'info', uri: output.uri }) as unknown as Info;
      if (!mounted.current || cancelled.current) return false;
      const old = basePreview?.uri;
      setBasePreview({ uri: output.uri, name: 'Page preview.png', size: output.size, mimeType: 'image/png', width: details.width, height: details.height });
      setInfo(details); setPage(number); setScan(undefined); setSelectedId(undefined); setFit(value => value + 1);
      autoScanned.current = false; accepted = true;
      if (old) requestAnimationFrame(() => deleteTemporary(old));
      return true;
    } finally { if (!accepted) deleteTemporary(output.uri); }
  }
  function changePage(number: number) {
    if (!pdfInput.current || number === page) return;
    launch(perform('preparing', async () => { await renderPdfPage(pdfInput.current!, number); }));
  }
  async function scanSource(file: LocalFile) {
    if (!FileEngine?.nativeImagePrivacyVersion) return;
    setPhase('scanning');
    const key = uid(), promise = FileEngine.scanImagePrivacy(key, file.uri);
    jobs.current.set(key, { scan: true, promise });
    try {
      const result = await promise;
      if (!mounted.current || cancelled.current) return;
      setScan({ ...result, findings: result.findings.map(finding => ({ ...finding, id: key + ':' + finding.id })) }); setReviewing(true);
      // A rescan never silently restores a cover the user removed or replaces manual edits.
      setNotice(result.findings.length ? 'Review the suggestions and choose what to hide.' : 'No text matches found. Review the image and add covers manually.');
    } finally { jobs.current.delete(key); }
  }
  async function openFile(existingId?: string) {
    await perform('opening', async () => {
      directory.create({ intermediates: true, idempotent: true });
      const file = existingId ? await getRecentFile(existingId) : (await browseFiles(directory, true, 1))[0];
      if (!file) throw new Error('This file is no longer available. Go back and choose another file.');
      let accepted = false;
      const image = new File(directory, 'source-preview-' + uid() + '.png');
      try {
        if (!mounted.current || cancelled.current) return;
        if ('kind' in file && file.kind !== (isPdf ? 'pdf' : 'image')) throw new Error('Choose the correct file type for this privacy tool.');
        setPhase('preparing');
        if (isPdf) {
          const copy = new File(directory, 'source.pdf');
          if (copy.exists) copy.delete();
          await new File(file.uri).copy(copy);
          if (!mounted.current || cancelled.current) return;
          const local = { ...file, uri: copy.uri };
          const result = await runPdf({ operation: 'info', uri: local.uri });
          if (!mounted.current || cancelled.current) return;
          if (!result.info) throw new Error('Could not read this PDF.');
          pdfInput.current = local; setPageCount(result.info.pageCount);
          if (await renderPdfPage(local, 1)) { setSource(file); accepted = true; }
          return;
        }
        const details = await runImage({ action: 'info', uri: file.uri }) as unknown as Info;
        if (!mounted.current || cancelled.current) return;
        // Native markup expects upright pixels. Normalize EXIF once at a bounded
        // resolution so OCR rectangles, manual covers and full-size export agree.
        const upright = await runImage({ action: 'preview', tool: 'privacy', uri: file.uri, outputUri: image.uri, rects: [] });
        if (!mounted.current || cancelled.current) return;
        setBasePreview({ ...upright, name: 'Image preview.png' } as Output);
        setSource(file); setInfo(details); accepted = true;
      } finally {
        if (!accepted) { deleteTemporary(image.uri); if (!existingId) deleteTemporary(file.uri); }
      }
    });
  }
  function leave() { if (router.canGoBack()) router.back(); else router.replace('/(modules)/privacy'); }
  function close() {
    if (busy) { cancelJobs(); leave(); return; }
    if (!saved && (marks.length || preview)) {
      showDialog('Leave privacy review?', 'Your unsaved covers and temporary preview will be discarded. The original is unchanged.',
        [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: leave }]);
    } else leave();
  }
  useLayoutEffect(() => { closeRef.current = close; });
  useEffect(() => {
    mounted.current = true;
    const operations = pending.current;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => {
      mounted.current = false; listener.remove();
      queueMicrotask(() => {
        if (mounted.current) return;
        cancelJobs();
        void Promise.allSettled([...operations]).then(() => { if (!mounted.current) disposeImports(directory); });
      });
    };
  }, [cancelJobs, directory]);
  useEffect(() => {
    if (!screenActive && (phase === 'scanning' || phase === 'preparing')) {
      cancelJobs();
    }
  }, [screenActive, phase, cancelJobs]);
  // Route metadata is loaded once; choosing a new file is an explicit action.
  const openRef = useRef(openFile);
  useLayoutEffect(() => { openRef.current = openFile; });
  useEffect(() => {
    if (!id || !active || !available || initial.current) return;
    initial.current = true;
    launch(openRef.current(id));
  }, [id, active, available]);
  const scanRef = useRef(scanSource);
  useLayoutEffect(() => { scanRef.current = scanSource; });
  useEffect(() => {
    if ((mode !== 'scan' && !isPdf) || !active || !source || !basePreview || busy || autoScanned.current) return;
    autoScanned.current = true;
    launch(perform('scanning', () => scanRef.current(isPdf ? basePreview : source)));
  }, [mode, isPdf, active, source, basePreview, busy]);

  function changeMarks(update: (current: PdfMark[]) => PdfMark[]) {
    if (locked.current || !editing) return;
    history.update(update);
    setError('');
  }
  function toggleFinding(finding: Finding, selected: boolean) {
    changeMarks(current => {
      const mark = findingMark(finding, page), filtered = current.filter(item => item.id !== mark.id);
      if (selected && filtered.length >= 300) { setNotice('Use up to 300 covers per file.'); return current; }
      return selected ? [...filtered, mark] : filtered;
    });
  }
  function selectAllFindings() {
    changeMarks(current => {
      const present = new Set(current.map(mark => mark.id));
      const next = [...current, ...(scan?.findings ?? []).map(finding => findingMark(finding, page)).filter(mark => !present.has(mark.id))];
      if (next.length > 300) { setNotice('Remove some manual covers before selecting all suggestions. The limit is 300 covers.'); return current; }
      return next;
    });
  }
  function onMark(serialized: string) {
    try {
      const value = JSON.parse(serialized) as PdfMarkChange;
      changeMarks(current => {
        if ('deleted' in value) return current.filter(mark => mark.id !== value.id);
        const mark = { ...safeMark(value), page, id: value.id ?? uid() };
        const index = current.findIndex(item => item.id === mark.id);
        if (index >= 0) return current.map((item, i) => i === index ? mark : item);
        return current.length < 300 ? [...current, mark] : current;
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The cover could not be updated.'); }
  }
  function restoreHistory(redo: boolean) {
    if (locked.current) return;
    const before = history.getCurrent();
    const after = redo ? history.redo() : history.undo();
    setSelectedId(undefined);
    if (isPdf) {
      const oldMarks = new Set(before.map(mark => JSON.stringify(mark)));
      const newMarks = new Set(after.map(mark => JSON.stringify(mark)));
      const changed = before.find(mark => !newMarks.has(JSON.stringify(mark)))
        ?? after.find(mark => !oldMarks.has(JSON.stringify(mark))); 
      if (changed && changed.page !== page) changePage(changed.page);
    }
  }
  function preparePreview() {
    launch(perform('preparing', async () => {
      if (!source) return;
      const output = new File(directory, 'privacy-' + uid() + (isPdf ? '.pdf' : '.png'));
      let accepted = false;
      try {
        const currentMarks = history.getCurrent();
        if (isPdf) {
          if (!currentMarks.length || !pdfInput.current) throw new Error('Choose at least one region to redact.');
          const result = await runPdf({ operation: 'redact', uri: pdfInput.current.uri, outputUris: [output.uri], rects: currentMarks.map(mark => ({ ...markRect(mark), page: mark.page })) });
          if (!mounted.current || cancelled.current) return;
          const file = result.outputs?.[0];
          if (!file) throw new Error('Could not create the redacted PDF.');
          setPreview({ ...file, width: info!.width, height: info!.height, mimeType: 'application/pdf', name: 'Redacted preview.pdf', coverCount: currentMarks.length });
          setReviewing(false); setSelectedId(undefined); accepted = true; return;
        }
        const result = await runImage({ action: 'export', tool: 'privacy', uri: source.uri, outputUri: output.uri, rects: currentMarks.map(markRect) });
        if (!mounted.current || cancelled.current) return;
        setPreview({ ...result, name: 'Privacy preview.png', coverCount: currentMarks.length } as Output);
        setReviewing(false); setSelectedId(undefined);
        accepted = true;
      } finally { if (!accepted) deleteTemporary(output.uri); }
    }));
  }
  function returnToEditing() {
    if (busy || saved) return;
    // Retain at most one retired preview until its native canvas has released it.
    const old = preview?.uri;
    setPreview(undefined);
    requestAnimationFrame(() => deleteTemporary(old));
  }
  function saveCopy() {
    launch(perform('saving', async () => {
      if (!preview || !source) return;
      const name = await askNewFileName(source.name.replace(/\.[^.]+$/, '') + (isPdf ? ' - private.pdf' : mode === 'metadata' ? ' - metadata removed.png' : ' - private.png'));
      if (!name || !mounted.current || cancelled.current) return;
      const folder = new Directory(Paths.document, isPdf ? 'Versara PDFs' : 'Versara Images');
      folder.create({ intermediates: true, idempotent: true });
      const copy = new File(folder, 'privacy-' + uid() + (isPdf ? '.pdf' : '.png'));
      let accepted = false;
      try {
        await new File(preview.uri).copy(copy);
        const output = { ...preview, uri: copy.uri, name, size: copy.size };
        await recordEditedFile({ ...output, kind: isPdf ? 'pdf' : 'image', deviceUri: '', location: 'Versara - app storage' });
        accepted = true;
        // Edited files is authoritative; an optional Recents failure must not discard a saved copy.
        await rememberFile(output, isPdf ? 'pdf' : 'image').catch(() => null);
        if (mounted.current) { setSaved(output); setNotice('Saved in Edited files. You can now save to your device or share.'); }
      } finally { if (!accepted) deleteTemporary(copy.uri); }
    }));
  }
  function publishToDevice() {
    launch(perform('saving', async () => {
      if (!saved) return;
      const device = await saveToDevice(saved.uri, saved.name, saved.mimeType);
      await recordEditedFile({ ...saved, kind: isPdf ? 'pdf' : 'image', deviceUri: device.uri, location: device.location });
      if (mounted.current) setNotice('Saved to ' + device.location);
    }));
  }
  const image = saved ?? preview;
  const toggleFindingRow = useStableCallback(toggleFinding);
  const renderFinding = useCallback(({ item }: { item: Finding }) => <PrivacyFindingRow item={item} selected={selectedFindingIds.has('scan-' + item.id)} busy={busy} onToggle={toggleFindingRow} />, [selectedFindingIds, busy, toggleFindingRow]);
  const secondaryText = { color: colors.secondaryLabel };
  const totalSelected = scan?.findings.filter(finding => selectedFindingIds.has('scan-' + finding.id)).length ?? 0;
  return <View style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <ScreenHeader title={TITLES[mode]} onBack={close} />
    {!available ? <View style={styles.empty}>
      <UniversalIcon ios="lock.shield" android="security" size={36} color={colors.privacyInk} />
      <ThemedText>Update the app build to use native privacy scanning and export.</ThemedText>
      <ThemedText style={secondaryText}>All processing runs on your device.</ThemedText>
    </View> : !source || !info || !basePreview ? <ScrollView contentContainerStyle={styles.empty}>
      <UniversalIcon ios="lock.shield" android="verified-user" size={40} color={colors.privacyInk} />
      <ThemedText style={styles.heading}>{mode === 'metadata' ? 'Share the image, without its metadata' : mode === 'redact' ? 'Cover details before sharing' : 'Review private details before sharing'}</ThemedText>
      <ThemedText style={secondaryText}>{mode === 'scan' || isPdf ? 'Find possible private text, choose what to hide, then preview a flattened copy.' : mode === 'redact' ? 'Draw solid covers over text, faces, QR codes or other details.' : 'Preview common source metadata and create a clean PNG copy.'}</ThemedText>
      <ThemedText style={styles.note}>Your original stays unchanged. Temporary imports and scan results are cleared when you leave.</ThemedText>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy ? <AppLoader /> : <ToolButton title={id ? 'Retry opening' : isPdf ? 'Choose PDF' : 'Choose image'} icon={{ ios: 'folder', android: 'folder-open' }} onPress={() => id ? launch(openFile(id)) : router.replace({ pathname: '/privacy-files', params: { mode } })} />}
    </ScrollView> : <>
      <View style={styles.fileBar}>
        <ThemedText numberOfLines={1} style={styles.grow}>{source.name}</ThemedText>
        <ThemedText style={[styles.note, secondaryText]}>{info.width} × {info.height}</ThemedText>
      </View>
      {isPdf && !image && <PdfPreviewToolbar page={page} count={pageCount} disabled={busy} onPageChange={changePage} />}
      {isPdf && image ? <PdfDocumentPreview uri={image.uri} count={pageCount} embedded onClose={close} /> : image ? <PdfPreviewStage hint={saved ? 'Saved PNG copy. Pinch to zoom and review.' : 'Final PNG preview. Review every cover before saving.'} onFit={() => setFit(value => value + 1)}>
        {active && <ZoomableImage key={image.uri + ':' + fit} uri={image.uri} onClose={close} />}
      </PdfPreviewStage>
        : mode !== 'metadata' && PdfMarkupView ? <PdfPreviewStage hint={selecting ? 'Tap a cover to select it. Drag its handles to resize.' : 'Drag to add a solid cover. Use two fingers to zoom and pan.'} onFit={() => setFit(value => value + 1)}>
          {active && <PdfMarkupView key={fit} style={styles.grow} source={basePreview.uri} marks={marksJson} mode={selecting ? 'select' : 'polygon'}
            inkColor="#000000" fillColor="#000000" inkWidth={.001} inkOpacity={1} brush="pen" pattern="solid" shapePath={RECTANGLE}
            disabled={busy || (!selecting && marks.length >= 300)} onMark={event => onMark(event.nativeEvent.mark)}
            onSelection={event => { try { setSelectedId(event.nativeEvent.mark ? (JSON.parse(event.nativeEvent.mark) as PdfMark).id : undefined); } catch { setSelectedId(undefined); } }} />}
        </PdfPreviewStage> : <PdfPagePreview image={basePreview} active={active} hint="Image preview. The exported PNG copy removes metadata." />}
      {!!error && <ThemedText accessibilityRole="alert" style={styles.message}>{error}</ThemedText>}
      {mode !== 'metadata' && !PdfMarkupView && <ThemedText style={styles.message}>Update the app build to draw and review covers on the image.</ThemedText>}
      {!!notice && <ThemedText accessibilityLiveRegion="polite" style={[styles.message, secondaryText]}>{notice}</ThemedText>}
      {reviewing && editing && <View style={[styles.review, { borderColor: colors.separator }]}>
        {mode === 'metadata' ? <ScrollView contentContainerStyle={styles.details}>
          <ThemedText style={styles.label}>Metadata preview</ThemedText>
          <ThemedText>GPS location: {info.hasLocation ? 'Present → removed' : 'Not recorded'}</ThemedText>
          <ThemedText>Camera: {info.camera || 'Not recorded'}{info.camera ? ' → removed' : ''}</ThemedText>
          <ThemedText>Capture time: {info.taken || 'Not recorded'}{info.taken ? ' → removed' : ''}</ThemedText>
          <ThemedText style={[styles.note, secondaryText]}>The copy is freshly encoded as PNG without source EXIF, GPS or text metadata. Transparent areas become white. Visible details stay in the image.</ThemedText>
        </ScrollView> : <FlatList data={scan?.findings ?? EMPTY_FINDINGS} keyExtractor={item => item.id} initialNumToRender={6} maxToRenderPerBatch={6} windowSize={3}
          contentContainerStyle={styles.details} extraData={selectedFindingIds}
          ListHeaderComponent={<View style={styles.detailsHeading}>
            <ThemedText style={styles.label}>{scan ? totalSelected + ' of ' + scan.findings.length + ' suggestions selected' : 'Scan for private text'}</ThemedText>
            <ThemedText style={[styles.note, secondaryText]}>English text suggestions can miss details. Review names, faces and QR codes manually. Match scores are estimates, not a guarantee.</ThemedText>
            {scan?.truncated && <ThemedText style={styles.note}>Scan limit reached. Review the remaining image manually.</ThemedText>}
            {!!scan?.findings.length && <View style={styles.row}>
              <EditorOption label="Select all" disabled={busy} onPress={selectAllFindings} />
              <EditorOption label="Clear selection" disabled={busy || !totalSelected} onPress={() => changeMarks(current => current.filter(mark => !scan.findings.some(finding => mark.id === 'scan-' + finding.id)))} />
            </View>}
          </View>}
          ListEmptyComponent={<ThemedText style={secondaryText}>{phase === 'scanning' ? 'Scanning on your device…' : scan ? 'No matching text found. Add covers for anything else you want to hide.' : 'Tap Scan to look for possible private text.'}</ThemedText>}
          renderItem={renderFinding} />}
      </View>}
      <PdfPreviewFooter>
        {busy ? <View style={styles.row}>
          <AppLoader />{isPdf && !!progress && <ThemedText>{progress}</ThemedText>}<ThemedText style={styles.grow}>{phase === 'scanning' ? 'Scanning on your device…' : phase === 'preparing' ? 'Preparing the copy…' : phase === 'sharing' ? 'Opening share options…' : 'Saving…'}</ThemedText>
          {(phase === 'scanning' || phase === 'preparing') && <ToolButton title="Cancel" secondary onPress={() => { cancelJobs(); setNotice('Cancelled. Your current covers are kept.'); }} />}
        </View> : saved ? <>
          <ThemedText style={styles.note}>{saved.name} · {formatSize(saved.size)} · PNG</ThemedText>
          <View style={styles.row}><View style={styles.grow}><ToolButton title="Save to device" onPress={publishToDevice} /></View><ToolButton title="Share" secondary onPress={() => launch(perform('sharing', () => shareNamedFile(saved)))} /></View>
          <ToolButton title={isPdf ? "Choose another PDF" : "Choose another image"} secondary onPress={() => router.replace({ pathname: '/privacy-files', params: { mode } })} />
        </> : preview ? <>
          {isPdf && <ThemedText style={styles.note}>Image-based PDF copy. Text selection, links and forms are removed; the original stays unchanged.</ThemedText>}
          <ThemedText style={styles.note}>{preview.coverCount} solid covers · Source metadata removed · {formatSize(preview.size)}</ThemedText>
          <View style={styles.row}><ToolButton title="Back to edits" secondary onPress={returnToEditing} /><View style={styles.grow}><ToolButton title="Save copy" onPress={saveCopy} /></View></View>
        </> : <>
          <View style={styles.row}>
            {mode !== 'metadata' && <>
              <EditorOption label="Add cover" compact icon={{ ios: 'rectangle.fill', android: 'rectangle' }} selected={!selecting} disabled={!PdfMarkupView} onPress={() => { setSelecting(false); setSelectedId(undefined); setReviewing(false); }} />
              <EditorOption label="Select" compact selected={selecting} disabled={!canSelect} onPress={() => { setSelecting(true); setReviewing(false); }} />
              <EditorOption label="Undo" compact disabled={!history.canUndo} onPress={() => restoreHistory(false)} />
              <EditorOption label="Redo" compact disabled={!history.canRedo} onPress={() => restoreHistory(true)} />
              {selecting && <EditorOption label="Delete" compact disabled={!selectedId || !marks.some(mark => mark.id === selectedId)} onPress={() => changeMarks(current => current.filter(mark => mark.id !== selectedId))} />}
            </>}
            <EditorOption label={mode === 'metadata' ? 'Metadata' : 'Review'} compact icon={{ ios: mode === 'metadata' ? 'info.circle' : 'checklist', android: mode === 'metadata' ? 'info-outline' : 'fact-check' }} selected={reviewing} onPress={() => setReviewing(value => !value)} />
          </View>
          <View style={styles.row}>
            {mode !== 'metadata' && <ToolButton title={isPdf ? (scan ? 'Rescan page' : 'Scan page') : scan ? 'Scan again' : 'Scan'} secondary icon={{ ios: 'text.viewfinder', android: 'document-scanner' }} onPress={() => launch(perform('scanning', () => scanSource(isPdf ? basePreview : source)))} />}
            <View style={styles.grow}><ToolButton title="Preview copy" icon={{ ios: 'eye', android: 'visibility' }} disabled={(mode !== 'metadata' && !PdfMarkupView) || (isPdf && !marks.length)} onPress={preparePreview} /></View>
          </View>
          <ThemedText style={[styles.note, secondaryText]}>{isPdf ? marks.length + ' covers across this PDF. The copy uses image-based pages: text selection, links and forms are removed. Original unchanged.' : mode === 'metadata' ? 'Create a PNG copy with metadata removed.' : marks.length + ' covers selected. PNG export removes source metadata; transparent areas become white.'}</ThemedText>
        </>}
      </PdfPreviewFooter>
    </>}
  </View>;
}

const EMPTY_FINDINGS: Finding[] = [];
const PrivacyFindingRow = memo(function PrivacyFindingRow({ item, selected, busy, onToggle }: {
  item: Finding; selected: boolean; busy: boolean; onToggle: (finding: Finding, selected: boolean) => void;
}) {
  const colors = usePalette();
  const appearance = useAppearance(state => state.mode);
  return <View style={[styles.finding, { borderColor: colors.separator }]}>
            <Host colorScheme={appearance} seedColor={colors.accent} matchContents>
              <Checkbox value={selected} disabled={busy} label={item.kind + ': ' + item.text} onValueChange={value => onToggle(item, value)} />
            </Host>
            <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>{CATEGORY_LABELS[item.category] ?? 'Other'} · Match score {Math.round(item.confidence * 100)}%</ThemedText>
          </View>;
});

const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1, minWidth: 0 },
  empty: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 18 },
  heading: { fontSize: 24, fontWeight: '600', lineHeight: 31 }, label: { fontSize: 15, fontWeight: '600' },
  fileBar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  note: { fontSize: 12, lineHeight: 17 }, message: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 6 },
  review: { height: '30%', borderTopWidth: StyleSheet.hairlineWidth },
  details: { padding: 12, gap: 12 }, detailsHeading: { gap: 8 },
  finding: { paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
});

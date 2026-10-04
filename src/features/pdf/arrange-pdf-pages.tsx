import { EditorOption } from '@/components/editor-option';
import { PdfPreviewFooter } from './pdf-preview';
import { useVisibleListItems } from '@/hooks/use-visible-list-items';
import { rememberPdfResults } from '../files/recent-files';
import { toast } from '@/components/toast';
import type { InitialSelection } from './pdf-tool-session';
import { useInitialFiles } from './use-initial-files';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { File } from 'expo-file-system';
import { PdfEngine, type PdfResult } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, savedPdfDirectory, shareFile, shareNamedFile, type LocalFile } from '../files/file-storage';
import { usePublishHeaderShare } from '@/components/header-share';
import { savePdfResult } from '../files/save-file';
import { useScreenActive } from '@/hooks/use-screen-active';
import { openPdfResult } from './open-pdf-screen';
import { PdfDocumentPreview } from './pdf-document-preview';
import { ReorderPageGrid } from './reorder-page-grid';
import { PdfFileOptionsSheet } from './pdf-file-options-sheet';
import { responsiveToolbarStyles } from '../editor/responsive-editor-toolbar';

type Source = LocalFile & { pageCount: number };
type Output = PdfResult & { name: string };
type Page = { original: number; rotation: number };
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const originalPages = (count: number): Page[] => Array.from({ length: count }, (_, index) => ({ original: index + 1, rotation: 0 }));

export function ArrangePdfPages({ operation, initialSelection }: { operation: 'reorder' | 'rotate'; initialSelection?: InitialSelection }) {
  const colors = usePalette();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const active = useScreenActive();
  const { visibleKeys, onViewableItemsChanged, viewabilityConfig } = useVisibleListItems();
  const reorder = operation === 'reorder';
  const available = !!PdfEngine?.organizePdfs && !!PdfEngine?.inspectPdfs;
  const [directory] = useState(() => initialSelection?.directory ?? createImportDirectory());
  const [source, setSource] = useState<Source | null>(null);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [name, setName] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [allPages, setAllPages] = useState(false);
  const [fileOptions, setFileOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Output | null>(null);

  const mounted = useRef(true);
  const locked = useRef(false);
  const job = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    const subscription = available ? PdfEngine?.addListener('onConversionProgress', event => {
      if (mounted.current && job.current === event.jobId) setProgress(event.completed / event.total);
    }) : undefined;
    return () => {
      mounted.current = false;
      subscription?.remove();
      queueMicrotask(() => {
        if (mounted.current) return;
        if (job.current) PdfEngine?.cancelPdfJob(job.current);
        if (!locked.current) disposeImports(directory);
      });
    };
  }, [directory, available]);

  function finish() {
    locked.current = false; job.current = null;
    if (mounted.current) { setBusy(false); setCancelling(false); setProgress(null); setPhase(''); }
    else disposeImports(directory);
  }
  function fail(cause: unknown) {
    if (!mounted.current) return;
    const failure = cause as { code?: string; message?: string };
    setError(failure.code === 'PDF_CANCELLED' ? 'Cancelled. Your original PDF is unchanged.' : failure.message ?? 'Could not save this PDF. Please try again.');
  }
  useInitialFiles(initialSelection, available, choose);
  const shareTarget = result ?? source;
  async function choose(initialFiles?: LocalFile[]) {
    if (locked.current || !PdfEngine) return;
    locked.current = true; setBusy(true); setError(''); setPhase('Opening your PDF…');
    let picked: LocalFile[] = [];
    let accepted = false;
    try {
      picked = Array.isArray(initialFiles) ? initialFiles : await browseFiles(directory, false, 1, true);
      if (!picked.length || !mounted.current) return;
      const id = newId(); job.current = id;
      setPhase('Reading pages…');
      const details = await PdfEngine.inspectPdfs(id, [picked[0].uri]);
      if (!mounted.current) return;
      setSource({ ...picked[0], pageCount: details[0].pageCount });
      setPages(originalPages(details[0].pageCount));
      setCurrentPage(1); setAllPages(false); setFileOptions(false);
      setName(`${picked[0].name.replace(/\.pdf$/i, '')} - ${reorder ? 'reordered' : 'rotated'}`);
      accepted = true;
    } catch (cause) { fail(cause); }
    finally {
      if (!accepted) for (const file of picked) { try { new File(file.uri).delete(); } catch { /* Session cleanup retries. */ } }
      finish();
    }
  }
  function movePage(original: number, destination: number) {
    if (locked.current) return;
    if (!Number.isInteger(destination) || destination < 0 || destination >= pages.length) { setError(`Enter a position from 1 to ${pages.length}.`); return; }
    setError('');
    setPages(current => {
      const from = current.findIndex(page => page.original === original);
      if (from < 0) return current;
      const next = [...current]; const [page] = next.splice(from, 1); next.splice(destination, 0, page); return next;
    });
  }
  function rotate(original: number | null, degrees: number) {
    if (locked.current) return;
    setPages(current => current.map(page => original === null || page.original === original ? { ...page, rotation: (page.rotation + degrees + 360) % 360 } : page));
    setError('');
  }
  const changed = pages.filter((page, index) => reorder ? page.original !== index + 1 : page.rotation !== 0).length;
  usePublishHeaderShare({ active: !!shareTarget, disabled: busy, label: result ? 'Share new PDF' : 'Share original PDF',
    onShare: () => shareTarget && shareNamedFile({ uri: shareTarget.uri, name: shareTarget.name, size: shareTarget.size, mimeType: 'application/pdf' }),
    save: { disabled: busy || (!result && (!available || !changed)), label: result ? 'Save new PDF to device' : reorder ? 'Save new page order' : 'Save rotated PDF',
      onSave: () => result ? saveResult() : save() } });
  async function save() {
    if (!source || !PdfEngine || locked.current || !changed) return;
    Keyboard.dismiss(); locked.current = true; setBusy(true); setError(''); setProgress(0); setPhase('Creating your PDF…');
    toast('Creating your PDF…');
    const id = newId(); job.current = id;
    const filename = `${name.trim().replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 80) || 'Edited PDF'}-${id}.pdf`;
    try {
      const outputs = await PdfEngine.organizePdfs({ jobId: id, operation, uris: [source.uri], outputUris: [new File(savedPdfDirectory(), filename).uri], ranges: [], pages: reorder ? pages.map(page => page.original) : [], rotations: reorder ? [] : pages.filter(page => page.rotation !== 0).map(page => ({ page: page.original, degrees: page.rotation })) });
      if (mounted.current) setResult({ ...outputs[0], name: filename });
      toast('PDF saved');
      // History failure must not discard an otherwise successful native export.
      void rememberPdfResults([{ ...outputs[0], name: filename }]).catch(() => {});
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  async function saveResult() {
    if (!result || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const saved = await savePdfResult(result, initialSelection?.origin);
      if (saved && mounted.current) setResult(current => current && { ...current, uri: saved.file.uri, name: saved.file.name });
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  async function exportResult() {
    if (!result || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await shareFile({ uri: result.uri, mimeType: 'application/pdf' }); }
    catch (cause) { fail(cause); }
    finally { finish(); }
  }

  if (source && previewPage !== null) return <PdfDocumentPreview uri={source.uri} count={source.pageCount} initialPage={previewPage} onClose={() => setPreviewPage(null)} />;

  if (result) return <ScrollView contentContainerStyle={styles.result}>
    <UniversalIcon ios="checkmark.circle.fill" android="check-circle" size={48} color={colors.systemBlue} />
    <ThemedText style={styles.heading}>Your PDF is ready</ThemedText>
    <ThemedText style={styles.body}>{reorder ? 'Your new page order is saved.' : 'Your page rotations are saved.'} All {result.pageCount} pages are included. Your original is unchanged.</ThemedText>
    <ThemedText numberOfLines={3} style={[styles.body, { color: colors.secondaryLabel }]}>{result.name}</ThemedText>
    <ToolButton title="Open PDF" disabled={busy} onPress={() => openPdfResult(result, initialSelection?.returnRoute)} />
    <ToolButton title="Save to device" disabled={busy} onPress={saveResult} />
    <ToolButton title="Share" secondary disabled={busy} onPress={exportResult} />
    <ToolButton title="Edit another PDF" secondary disabled={busy} onPress={() => { setResult(null); setSource(null); setPages([]); setError(''); }} />
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    {busy && <AppLoader />}
  </ScrollView>;

  const fileSheet = <PdfFileOptionsSheet visible={fileOptions} onClose={() => setFileOptions(false)} name={name} onName={setName} disabled={busy}
    onChoose={available ? () => void choose() : undefined} description={reorder ? 'Long-press a page and drag it to a new place. Tap a page to preview. All pages are kept in the new PDF.' : 'Rotate the current page or all pages, then save a new PDF.'} />;

  const rotationControls = source && !reorder ? <PdfPreviewFooter>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy ? <View style={styles.liveActions}><AppLoader /><ThemedText style={styles.grow} accessibilityLiveRegion="polite">{cancelling ? 'Cancelling...' : phase}{progress !== null ? ' ' + Math.round(progress * 100) + '%' : ''}</ThemedText>
        <ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelPdfJob(job.current); } }} />
      </View> : <>
        <View style={styles.liveActions}>
          <EditorOption label="This page" compact selected={!allPages} onPress={() => setAllPages(false)} icon={{ ios: 'doc', android: 'description' }} />
          <EditorOption label="All pages" compact selected={allPages} onPress={() => setAllPages(true)} icon={{ ios: 'doc.on.doc', android: 'library-books' }} />
          <EditorOption label="Options" compact selected={fileOptions} onPress={() => setFileOptions(true)} icon={{ ios: 'slider.horizontal.3', android: 'tune' }} />
          <EditorOption label="Reset" compact disabled={!changed} onPress={() => setPages(originalPages(source.pageCount))} />
        </View>
        <View style={styles.liveActions}>
          <EditorOption label="Left 90°" icon={{ ios: 'rotate.left', android: 'rotate-left' }} onPress={() => rotate(allPages ? null : currentPage, -90)} />
          <EditorOption label="Right 90°" icon={{ ios: 'rotate.right', android: 'rotate-right' }} onPress={() => rotate(allPages ? null : currentPage, 90)} />
          <View style={styles.saveAction}><ToolButton title="Save PDF" disabled={!available || !changed} onPress={save} /></View>
        </View>
        <ThemedText accessibilityLiveRegion="polite" style={styles.caption}>{changed ? changed + (changed === 1 ? ' page changed' : ' pages changed') : 'Turn a page to get started.'}</ThemedText>
      </>}
    </PdfPreviewFooter> : null;

  if (source && !reorder) return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.screen, landscape && styles.rotationLandscape]}>
    <PdfDocumentPreview key={source.uri} uri={source.uri} count={source.pageCount} embedded
      page={currentPage} onPageChange={setCurrentPage} rotation={pages[currentPage - 1]?.rotation ?? 0} disabled={busy} onClose={() => {}} />
    {fileSheet}
    {landscape ? <ScrollView style={styles.rotationSide} keyboardShouldPersistTaps="handled">{rotationControls}</ScrollView> : rotationControls}
  </KeyboardAvoidingView>;

  return <View style={styles.screen}>
    <ReorderPageGrid uri={source?.uri ?? ''} pages={source ? pages : []} busy={busy} active={active} visibleKeys={visibleKeys}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig} onMove={movePage} onPreview={setPreviewPage}
      header={<View style={styles.form}>
        <ThemedText numberOfLines={2} style={styles.label}>{source ? `${source.name} - ${source.pageCount} pages` : 'Choose a PDF to get started.'}</ThemedText>
        <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Long-press and drag to reorder. Tap a page to preview.</ThemedText>
        {!available && <ThemedText accessibilityRole="alert">Install a new development build to use this tool.</ThemedText>}
        {source?.pageCount === 1 && <ThemedText>This PDF has one page, so there is nothing to reorder.</ThemedText>}
      </View>} />
    {fileSheet}
    <PdfPreviewFooter>
      {!!error && <ThemedText accessibilityRole="alert" style={styles.body}>{error}</ThemedText>}
      {busy ? <><AppLoader /><ThemedText accessibilityLiveRegion="polite">{cancelling ? 'Cancelling...' : progress === 1 ? 'Saving your PDF...' : `${phase}${progress === null ? '' : ` ${Math.round(progress * 100)}%`}`}</ThemedText>{(progress !== null || phase.startsWith('Reading pages')) && <ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelPdfJob(job.current); } }} />}</> : <>
        {source && <ThemedText accessibilityLiveRegion="polite" style={styles.caption}>{changed ? `${changed} pages in a new position - all ${pages.length} pages kept` : 'Move a page to get started.'}</ThemedText>}
        <View style={responsiveToolbarStyles.row}>
          <EditorOption label="Options" compact selected={fileOptions} icon={{ ios: 'slider.horizontal.3', android: 'tune' }} onPress={() => setFileOptions(true)} />
          {source ? <>
            <EditorOption label="Reverse" compact icon={{ ios: 'arrow.up.arrow.down', android: 'swap-vert' }} disabled={pages.length < 2} onPress={() => setPages(current => [...current].reverse())} />
            <EditorOption label="Reset" compact disabled={!changed} onPress={() => { setPages(originalPages(source.pageCount)); setError(''); }} />
          </> : <EditorOption label="Choose PDF" compact disabled={!available} icon={{ ios: 'doc.badge.plus', android: 'note-add' }} onPress={() => void choose()} />}
          <View style={[responsiveToolbarStyles.primary, { minWidth: 120 }]}><ToolButton title="Save PDF" disabled={!available || !changed} onPress={save} /></View>
        </View>
      </>}
    </PdfPreviewFooter>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1, minWidth: 0 }, list: { padding: s.lg, gap: s.md }, form: { gap: s.md, paddingBottom: s.md },
  heading: { ...t.heading }, label: { ...t.label }, body: { ...t.body }, actions: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  card: { padding: s.md, gap: s.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md }, icon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.3 },
  thumb: { width: 96, height: 128 },
  rotationLandscape: { flexDirection: 'row' }, rotationSide: { width: 280, flexGrow: 0 },
  liveActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: s.sm },
  saveAction: { flexGrow: 1, minWidth: 110 },
  caption: { ...t.caption },
  input: { minHeight: 48, borderRadius: radius.sm, padding: s.md, ...t.body }, footer: { padding: s.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: s.sm }, result: { flexGrow: 1, padding: s.xl, gap: s.lg, justifyContent: 'center' },
});

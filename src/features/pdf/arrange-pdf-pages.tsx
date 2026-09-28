import { EditorOption } from '@/components/editor-option';
import { PdfPreviewFooter } from './pdf-preview';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { useVisibleListItems } from '@/hooks/use-visible-list-items';
import { rememberPdfResults } from '../files/recent-files';
import { toast } from '@/components/toast';
import type { InitialSelection } from './pdf-tool-session';
import { useInitialFiles } from './use-initial-files';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { File } from 'expo-file-system';
import { PdfEngine, type PdfResult } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, savedPdfDirectory, shareFile, type LocalFile } from '../files/file-storage';
import { savePdfResult } from '../files/save-file';
import { FileThumbnail } from '@/components/file-thumbnail';
import { useScreenActive } from '@/hooks/use-screen-active';
import { openPdfResult } from './open-pdf-screen';
import { PdfDocumentPreview } from './pdf-document-preview';

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
  const [moving, setMoving] = useState<number | null>(null);
  const [position, setPosition] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [allPages, setAllPages] = useState(false);
  const [fileOptions, setFileOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Output | null>(null);

  const moveRow = useStableCallback(movePage);
  const rotateRow = useStableCallback(rotate);
  const startMove = useCallback((original: number, index: number) => { setMoving(original); setPosition(String(index + 1)); }, []);
  const cancelMove = useCallback(() => { setMoving(null); Keyboard.dismiss(); }, []);
  const sourceUri = source?.uri ?? '';
  const count = pages.length;
  const renderPage = useCallback(({ item, index }: { item: Page; index: number }) => <ArrangePageRow
    item={item} index={index} uri={sourceUri} active={active && visibleKeys.has(String(item.original))} busy={busy} reorder={reorder} count={count}
    moving={moving === item.original} position={moving === item.original ? position : ''} onPosition={setPosition}
    onMove={moveRow} onRotate={rotateRow} onStartMove={startMove} onCancelMove={cancelMove} onPreview={setPreviewPage} />,
  [sourceUri, active, visibleKeys, busy, reorder, count, moving, position, moveRow, rotateRow, startMove, cancelMove]);

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
      setPages(originalPages(details[0].pageCount)); setMoving(null); setPosition('');
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
    Keyboard.dismiss(); setError(''); setMoving(null);
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
    <ToolButton title="Edit another PDF" secondary disabled={busy} onPress={() => { setResult(null); setSource(null); setPages([]); setMoving(null); setError(''); }} />
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    {busy && <AppLoader />}
  </ScrollView>;

  if (source && !reorder) return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.screen, landscape && styles.rotationLandscape]}>
    <PdfDocumentPreview key={source.uri} uri={source.uri} count={source.pageCount} embedded
      page={currentPage} onPageChange={setCurrentPage} rotation={pages[currentPage - 1]?.rotation ?? 0} disabled={busy} onClose={() => {}} />
    <ScrollView style={landscape ? styles.rotationSide : styles.rotationDock} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
    {fileOptions && <View style={styles.fileOptions}>
      <ThemedText style={styles.label}>New PDF name</ThemedText>
      <TextInput accessibilityLabel="New PDF name" value={name} onChangeText={setName} editable={!busy} maxLength={100}
        style={[styles.input, { color: colors.label, backgroundColor: colors.fieldSurface }]} />
      <ToolButton title="Choose another PDF" secondary disabled={busy} onPress={choose} />
    </View>}
    <PdfPreviewFooter>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy ? <View style={styles.liveActions}><AppLoader /><ThemedText style={styles.grow} accessibilityLiveRegion="polite">{cancelling ? 'Cancelling...' : phase}{progress !== null ? ' ' + Math.round(progress * 100) + '%' : ''}</ThemedText>
        <ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelPdfJob(job.current); } }} />
      </View> : <>
        <View style={styles.liveActions}>
          <EditorOption label="This page" compact selected={!allPages} onPress={() => setAllPages(false)} icon={{ ios: 'doc', android: 'description' }} />
          <EditorOption label="All pages" compact selected={allPages} onPress={() => setAllPages(true)} icon={{ ios: 'doc.on.doc', android: 'library-books' }} />
          <EditorOption label="File options" compact selected={fileOptions} onPress={() => setFileOptions(value => !value)} icon={{ ios: 'doc.badge.gearshape', android: 'drive-file-rename-outline' }} />
          <EditorOption label="Reset" compact disabled={!changed} onPress={() => setPages(originalPages(source.pageCount))} />
        </View>
        <View style={styles.liveActions}>
          <EditorOption label="Left 90°" icon={{ ios: 'rotate.left', android: 'rotate-left' }} onPress={() => rotate(allPages ? null : currentPage, -90)} />
          <EditorOption label="Right 90°" icon={{ ios: 'rotate.right', android: 'rotate-right' }} onPress={() => rotate(allPages ? null : currentPage, 90)} />
          <View style={styles.saveAction}><ToolButton title="Save PDF" disabled={!available || !changed} onPress={save} /></View>
        </View>
        <ThemedText accessibilityLiveRegion="polite" style={styles.caption}>{changed ? changed + (changed === 1 ? ' page changed' : ' pages changed') : 'Turn a page to get started.'}</ThemedText>
      </>}
    </PdfPreviewFooter>
    </ScrollView>
  </KeyboardAvoidingView>;

  return <View style={styles.screen}>
    <FlatList onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig} data={pages} keyExtractor={page => String(page.original)} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" initialNumToRender={4} maxToRenderPerBatch={3} windowSize={3}
      ListHeaderComponent={<View style={styles.form}>
        <ThemedText style={styles.heading}>1. Choose a PDF</ThemedText>
        <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{reorder ? 'Put your pages in the right order, then save a new copy.' : 'Turn sideways or upside-down pages the right way up.'}</ThemedText>
        {!available && <ThemedText accessibilityRole="alert">Install a new development build to use this tool.</ThemedText>}
        <ToolButton title={source ? 'Change PDF' : 'Choose PDF'} disabled={busy || !available} onPress={choose} />
        {source && <>
          <ThemedText numberOfLines={2} style={styles.label}>{source.name} · {source.pageCount} pages</ThemedText>
          <ThemedText style={styles.label}>New PDF name</ThemedText>
          <TextInput accessibilityLabel="New PDF name" value={name} onChangeText={setName} editable={!busy} maxLength={100} style={[styles.input, { color: colors.label, backgroundColor: colors.accentSurface }]} />
          <ThemedText style={styles.heading}>2. {reorder ? 'Arrange your pages' : 'Rotate your pages'}</ThemedText>
          <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{reorder ? 'Use the arrows or choose Move to for an exact position. Preview opens the original page.' : 'Each tap turns a page by 90°. Preview opens the original; open the saved PDF to see your changes.'}</ThemedText>
          {reorder && source.pageCount === 1 && <ThemedText>This PDF has one page, so there is nothing to reorder.</ThemedText>}
          <View style={styles.actions}>
            {reorder ? <View style={styles.grow}><ToolButton title="Reverse order" secondary disabled={busy || pages.length < 2} onPress={() => { setPages(current => [...current].reverse()); setMoving(null); }} /></View> : <><View style={styles.grow}><ToolButton title="All left 90°" secondary disabled={busy} onPress={() => rotate(null, -90)} /></View><View style={styles.grow}><ToolButton title="All right 90°" secondary disabled={busy} onPress={() => rotate(null, 90)} /></View></>}
          </View>
          <ToolButton title="Reset changes" secondary disabled={busy || !changed} onPress={() => { setPages(originalPages(source.pageCount)); setMoving(null); setError(''); }} />
        </>}
      </View>}
      renderItem={renderPage}
    />
    {(!!source || busy || !!error) && <View style={[styles.footer, { borderColor: colors.separator }]}>
      {!!error && <ThemedText accessibilityRole="alert" style={styles.body}>{error}</ThemedText>}
      {busy ? <><AppLoader /><ThemedText accessibilityLiveRegion="polite">{cancelling ? 'Cancelling…' : progress === 1 ? 'Saving your PDF…' : `${phase}${progress === null ? '' : ` ${Math.round(progress * 100)}%`}`}</ThemedText>{(progress !== null || phase.startsWith('Reading pages')) && <ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelPdfJob(job.current); } }} />}</> : <>
        <ThemedText accessibilityLiveRegion="polite" style={styles.body}>{changed ? `${changed} ${changed === 1 ? 'page' : 'pages'} ${reorder ? 'in a new position' : 'to rotate'} · All ${pages.length} pages kept` : reorder ? 'Move a page to get started.' : 'Turn a page to get started.'}</ThemedText>
        <ToolButton title={reorder ? 'Save new page order' : 'Save rotated PDF'} disabled={!available || !changed} onPress={save} />
      </>}
    </View>}
  </View>;
}

const ArrangePageRow = memo(function ArrangePageRow({ item, index, uri, active, busy, reorder, count, moving, position, onPosition, onMove, onRotate, onStartMove, onCancelMove, onPreview }: {
  item: Page; index: number; uri: string; active: boolean; busy: boolean; reorder: boolean; count: number; moving: boolean; position: string;
  onPosition: (value: string) => void; onMove: (original: number, destination: number) => void; onRotate: (original: number | null, degrees: number) => void;
  onStartMove: (original: number, index: number) => void; onCancelMove: () => void; onPreview: (page: number) => void;
}) {
  const colors = usePalette();
  return <View style={[styles.card, { backgroundColor: colors.accentSurface, borderColor: colors.separator }]}>
        <View style={styles.actions}>
          <View style={styles.thumb}><FileThumbnail uri={uri} kind="pdf" page={item.original - 1} active={active} /></View>
          <View style={styles.grow}><ThemedText style={styles.label}>{reorder ? `${index + 1}. Original page ${item.original}` : `Page ${item.original}`}</ThemedText><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{reorder ? `Position ${index + 1} in the new PDF` : item.rotation === 0 ? 'No change' : item.rotation === 270 ? 'Turn left 90°' : `Turn right ${item.rotation}°`}</ThemedText></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Preview original page ${item.original}`} disabled={busy} onPress={() => onPreview(item.original)} style={styles.icon}><UniversalIcon ios="eye" android="visibility" size={22} color={colors.systemBlue} /></Pressable>
        </View>
        <View style={styles.actions}>
          {reorder ? <>
            <Pressable accessibilityRole="button" accessibilityLabel={`Move original page ${item.original} up`} disabled={busy || index === 0} onPress={() => onMove(item.original, index - 1)} style={[styles.icon, (busy || index === 0) && styles.disabled]}><UniversalIcon ios="arrow.up" android="arrow-upward" size={22} color={colors.systemBlue} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Move original page ${item.original} down`} disabled={busy || index === count - 1} onPress={() => onMove(item.original, index + 1)} style={[styles.icon, (busy || index === count - 1) && styles.disabled]}><UniversalIcon ios="arrow.down" android="arrow-downward" size={22} color={colors.systemBlue} /></Pressable>
            <View style={styles.grow}><ToolButton title="Move to…" secondary disabled={busy || count < 2} onPress={() => { onStartMove(item.original, index); }} /></View>
          </> : <>
            <View style={styles.grow}><ToolButton title="Left 90°" secondary disabled={busy} onPress={() => onRotate(item.original, -90)} /></View>
            <View style={styles.grow}><ToolButton title="Right 90°" secondary disabled={busy} onPress={() => onRotate(item.original, 90)} /></View>
          </>}
        </View>
        {reorder && moving && <View style={styles.actions}><TextInput accessibilityLabel={`New position for original page ${item.original}`} keyboardType="number-pad" value={position} onChangeText={onPosition} maxLength={4} editable={!busy} style={[styles.input, styles.grow, { color: colors.label, backgroundColor: colors.systemBackground }]} /><ToolButton title="Move" disabled={busy} onPress={() => onMove(item.original, Number(position) - 1)} /><ToolButton title="Cancel" secondary disabled={busy} onPress={() => { onCancelMove(); }} /></View>}
      </View>;
});

const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1, minWidth: 0 }, list: { padding: s.lg, gap: s.md }, form: { gap: s.md, paddingBottom: s.md },
  heading: { ...t.heading }, label: { ...t.label }, body: { ...t.body }, actions: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  card: { padding: s.md, gap: s.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md }, icon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.3 },
  thumb: { width: 96, height: 128 },
  rotationLandscape: { flexDirection: 'row' }, rotationSide: { width: 280, flexGrow: 0 }, rotationDock: { maxHeight: '48%', flexGrow: 0 },
  liveActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: s.sm },
  saveAction: { flexGrow: 1, minWidth: 110 },
  fileOptions: { padding: s.sm, gap: s.sm },
  caption: { ...t.caption },
  input: { minHeight: 48, borderRadius: radius.sm, padding: s.md, ...t.body }, footer: { padding: s.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: s.sm }, result: { flexGrow: 1, padding: s.xl, gap: s.lg, justifyContent: 'center' },
});

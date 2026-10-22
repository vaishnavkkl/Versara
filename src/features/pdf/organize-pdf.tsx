import { EditorActionBar } from '@/components/editor-action-bar';
import { forgetRecentUri } from '../files/recent-files';
import { toast } from '@/components/toast';
import type { InitialSelection } from './pdf-tool-session';
import { useInitialFiles } from './use-initial-files';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { HelpSheetTextInput as BottomSheetTextInput } from '@/components/help-text-input';
import { AppLoader } from '@/components/app-loader';
import { File } from 'expo-file-system';
import { PdfEngine, type PdfRange, type PdfResult } from '../../../modules/pdf-engine';
import { HandoffScreen } from '@/components/handoff-screen';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, toolChrome, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, formatSize, savedPdfDirectory, shareFile, shareNamedFile, type LocalFile } from '../files/file-storage';
import { usePublishHeaderShare } from '@/components/header-share';
import { copyPdf, usePublishPdfHandoff } from './pdf-handoff';
import { saveEditedOutput, savePdfResult } from '../files/save-file';
import { useScreenActive } from '@/hooks/use-screen-active';
import { openPdfScreen, showSavedPdf } from './open-pdf-screen';
import { PdfDocumentPreview } from './pdf-document-preview';
import { splitRanges, type SplitMode } from './pdf-ranges';
import { EditorOption } from '@/components/editor-option';
import { PdfPreviewFooter } from './pdf-preview';
import { PdfFileOptionsSheet } from './pdf-file-options-sheet';
import { PdfSourceCard } from './pdf-source-card';
import { useVisibleListItems } from '@/hooks/use-visible-list-items';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { SortableGrid } from '@/components/sortable-grid';

type Source = LocalFile & { pageCount: number };
type Result = PdfResult & { name: string; part: number; location?: string };
const jobId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function OrganizePdf({ operation, initialSelection }: { operation: 'merge' | 'split'; initialSelection?: InitialSelection }) {
  const colors = usePalette();
  const active = useScreenActive();
  const { width, fontScale } = useWindowDimensions();
  const columns = width < 340 || fontScale > 1.5 ? 1 : 2;
  const merge = operation === 'merge';
  const available = !!PdfEngine?.organizePdfs && !!PdfEngine?.inspectPdfs;
  const [directory] = useState(() => initialSelection?.directory ?? createImportDirectory());
  const [sources, setSources] = useState<Source[]>([]);
  const [previewSource, setPreviewSource] = useState<Source | null>(null);
  const [card, setCard] = useState<{ width: number; height: number } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const { visibleKeys, onViewableItemsChanged, viewabilityConfig } = useVisibleListItems();
  const [name, setName] = useState(merge ? 'Merged document' : 'Split document');
  const [splitMode, setSplitMode] = useState<SplitMode>('each');
  const [groupSize, setGroupSize] = useState('10');
  const [customRanges, setCustomRanges] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  // The saved PDF opens by itself; until then the result screen stays hidden.
  const [leaving, setLeaving] = useState(false);

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
    job.current = null; locked.current = false;
    if (mounted.current) { setBusy(false); setPhase(''); setProgress(null); setCancelling(false); }
    else disposeImports(directory);
  }
  function fail(cause: unknown) {
    if (!mounted.current) return;
    const failure = cause as { code?: string; message?: string };
    setError(failure.code === 'PDF_CANCELLED' ? 'Operation cancelled. Your source PDFs are unchanged.' : failure.message ?? 'Could not process these PDFs. Please try again.');
  }
  useInitialFiles(initialSelection, available, choose);
  const shareTarget = results.length === 1 ? results[0] : !results.length && sources.length === 1 ? sources[0] : null;
  async function choose(initialFiles?: LocalFile[]) {
    if (locked.current || !PdfEngine?.inspectPdfs) return;
    locked.current = true; setBusy(true); setError(''); setPhase('Opening file browser…');
    let picked: LocalFile[] = [];
    let accepted = false;
    try {
      picked = Array.isArray(initialFiles) ? initialFiles : await browseFiles(directory, false, merge ? 30 - sources.length : 1, true);
      if (!picked.length || !mounted.current) return;
      const id = jobId(); job.current = id;
      setPhase('Reading PDF details…');
      const info = await PdfEngine.inspectPdfs(id, picked.map(file => file.uri));
      if (!mounted.current) return;
      const next = picked.map((file, index) => ({ ...file, pageCount: info[index].pageCount }));
      if (merge && sources.reduce((sum, file) => sum + file.pageCount, 0) + next.reduce((sum, file) => sum + file.pageCount, 0) > 2000) throw new Error('Merge up to 2,000 pages at a time. Choose fewer PDFs.');
      if (!merge && next[0].pageCount < 2) toast('This PDF has only one page — nothing to split. Choose a PDF with at least two pages.');
      if (merge && sources.length + next.length < 2) toast('Add at least two PDFs to merge.');
      setSources(current => merge ? [...current, ...next] : next);
      if (!merge) {
        setCustomRanges('');
        setSplitMode(next[0].pageCount > 100 ? 'groups' : 'each');
        const pages = next[0].pageCount;
        // Prefer groups that actually create more than one output when the PDF is large enough.
        setGroupSize(String(pages < 2 ? 1 : Math.max(1, Math.min(10, Math.ceil(pages / Math.min(100, pages))))));
      }
      accepted = true;
    } catch (cause) { fail(cause); }
    finally {
      if (!accepted && Array.isArray(picked)) {
        for (const file of picked) { try { const local = new File(file.uri); if (local.exists) local.delete(); } catch { /* Session cleanup retries. */ } }
      }
      finish();
    }
  }

  let ranges: PdfRange[] = [];
  let rangeError = '';
  if (!merge && sources[0]) {
    try { ranges = splitRanges(sources[0].pageCount, splitMode, groupSize, customRanges); }
    catch (cause) { rangeError = (cause as Error).message; }
  }
  const pageCount = sources.reduce((sum, source) => sum + source.pageCount, 0);
  const canRun = available && !busy && !rangeError && (merge ? sources.length >= 2 : ranges.length > 0);
  usePublishHeaderShare({ active: !!(results.length || sources.length), disabled: busy || !shareTarget,
    label: results.length > 1 ? 'Share each PDF from its card' : results.length ? 'Share new PDF' : shareTarget ? 'Share original PDF' : 'Share is available after merging',
    onShare: () => shareTarget && shareNamedFile({ uri: shareTarget.uri, name: shareTarget.name, size: shareTarget.size, mimeType: 'application/pdf' }),
    save: { disabled: busy || (results.length ? results.length > 1 || !!results[0].location : !canRun), label: results.length && results.every(result => result.location) ? 'PDFs saved' : 'Save',
      onSave: () => results.length === 1 ? saveResult(results[0]) : results.length ? undefined : process() } });
  usePublishPdfHandoff(!!(results.length || sources.length), {
    changed: results.length === 1 && !results[0].location,
    saved: results.length === 1 && results[0].location ? { uri: results[0].uri, name: results[0].name } : undefined,
    blocked: busy ? 'Wait for the current task to finish, then choose another tool.'
      : results.length > 1 ? 'This created several PDFs. Open one of them to continue with another tool.'
      : !results.length && sources.length > 1 ? 'Merge these PDFs first, then choose another tool.' : undefined,
    switched: !results.length && sources.length === 1 && sources[0].uri !== initialSelection?.files[0]?.uri ? { file: sources[0] } : undefined,
    write: outputUri => shareTarget ? copyPdf(shareTarget.uri, outputUri) : Promise.reject(new Error('Choose a PDF first.')),
  });

  async function process() {
    if (!PdfEngine?.organizePdfs || locked.current) return;
    if (!canRun) {
      if (merge && sources.length < 2) toast('Add at least two PDFs to merge.');
      else if (!merge && sources[0] && sources[0].pageCount < 2) toast('This PDF has only one page — nothing to split.');
      else if (rangeError) toast(rangeError);
      else toast(merge ? 'Choose PDFs to merge first.' : 'Choose a split option that creates more than one PDF.');
      return;
    }
    locked.current = true; setBusy(true); setError(''); setProgress(0); setCancelling(false); setPhase(merge ? 'Merging PDFs…' : 'Splitting PDF…');
    toast(merge ? 'Merging PDFs…' : 'Splitting PDF…');
    const id = jobId(); job.current = id;
    const safeName = name.trim().replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 60) || (merge ? 'Merged' : 'Split');
    const stamp = new Date().toISOString().replace(/[T:.]/g, '-').replace(/Z$/, '');
    const names = merge ? [`${safeName}-${stamp}.pdf`] : ranges.map((range, index) => `${safeName}-${stamp}-part-${index + 1}-pages-${range.start}-${range.end}.pdf`);
    try {
      const outputs = await PdfEngine.organizePdfs({ jobId: id, operation, uris: sources.map(source => source.uri), outputUris: names.map(filename => new File(savedPdfDirectory(), filename).uri), ranges: merge ? [] : ranges });
      if (mounted.current) { setLeaving(merge && outputs.length === 1); setResults(outputs.map((output, index) => ({ ...output, name: names[index], part: index + 1 }))); }
      let merged: { uri: string; name: string } | undefined;
      for (let index = 0; index < outputs.length; index++) {
        setPhase(`Saving ${index + 1} of ${outputs.length}…`);
        const saved = await saveEditedOutput({ output: outputs[index].uri, name: names[index], mimeType: 'application/pdf', kind: 'pdf', mode: 'new' });
        if (mounted.current) setResults(current => current.map(item => item.part === index + 1 ? { ...item, uri: saved.file.uri, name: saved.file.name, location: saved.device.location } : item));
        merged = saved.file;
      }
      toast(merge ? 'Merged PDF saved' : `Split into ${outputs.length} PDFs`);
      // A merged PDF opens straight away; split parts stay listed so each can be opened.
      if (merge && merged && outputs.length === 1 && mounted.current && showSavedPdf(merged)) return;
      if (mounted.current) setLeaving(false);
    } catch (cause) { if (mounted.current) setLeaving(false); fail(cause); }
    finally { finish(); }
  }
  async function saveResult(result: Result) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const saved = await savePdfResult(result);
      if (saved && mounted.current) setResults(current => current.map(item => item.uri === result.uri ? { ...item, uri: saved.file.uri, name: saved.file.name, location: saved.device.location } : item));
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  async function share(result: Result) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setPhase('Opening share menu…');
    try { await shareFile({ uri: result.uri, mimeType: 'application/pdf' }); }
    catch (cause) { fail(cause); }
    finally { finish(); }
  }
  function removeSource(index: number) { setSources(current => current.filter((_, i) => i !== index)); }
  function move(index: number, direction: number) { setSources(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); }
  const reorder = useStableCallback((from: number, to: number) => setSources(current => {
    const next = [...current];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    return next;
  }));
  // Cards share one size; 12 is the card's bottom margin.
  const geometry = card ? { columns, itemWidth: card.width, itemHeight: card.height, rowGap: 12 + s.md, padX: s.lg, top: s.lg + s.md } : null;
  const inputStyle = [styles.input, { color: colors.label, backgroundColor: colors.accentSurface }];

  if (previewSource) return <PdfDocumentPreview uri={previewSource.uri} count={previewSource.pageCount} onClose={() => setPreviewSource(null)} />;

  if (leaving) return <HandoffScreen label="Saving and opening your PDF…" />;
  if (results.length) return <View style={styles.screen}>
    <FlatList data={results} keyExtractor={result => result.uri} contentContainerStyle={styles.list} ListHeaderComponent={<View style={styles.form}><ThemedText style={styles.heading}>{merge ? 'Your merged PDF is ready' : `${results.length} PDFs are ready`}</ThemedText><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{results.every(result => result.location) ? `Saved to ${results[0].location}` : 'Saving your PDFs. Any unfinished save can be retried below.'}</ThemedText>{!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}</View>} renderItem={({ item, index }) => <View style={[styles.resultCard, { backgroundColor: colors.accentSurface }]}>
      <ThemedText numberOfLines={2} style={styles.label}>{merge ? 'Merged document' : `Part ${item.part}`}</ThemedText>
      <ThemedText numberOfLines={2} style={styles.body}>{item.name}</ThemedText>
      <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{item.pageCount} pages · {formatSize(item.size)}</ThemedText>
      <View style={styles.actions}><View style={styles.grow}><ToolButton title="Open PDF" onPress={() => openPdfScreen(item)} disabled={busy} /></View>{item.location ? <ThemedText selectable style={styles.grow}>Saved to {item.location}</ThemedText> : <View style={styles.grow}><ToolButton title="Save" onPress={() => saveResult(item)} disabled={busy} /></View>}<View style={styles.grow}><ToolButton title="Share" secondary onPress={() => share(item)} disabled={busy} /></View></View>
      <ToolButton title="Delete output" secondary disabled={busy} onPress={() => { try { new File(item.uri).delete(); void forgetRecentUri(item.uri).catch(() => {}); setResults(current => current.filter(file => file.uri !== item.uri)); } catch { setError('Could not delete this PDF. Try again.'); } }} />
    </View>} />
    <View style={styles.footer}>{busy && <AppLoader />}<ToolButton title={merge ? 'Merge more PDFs' : 'Split another PDF'} secondary disabled={busy} onPress={() => { setResults([]); setError(''); }} /></View>
  </View>;

  const splitModes: { id: SplitMode; label: string }[] = [
    { id: 'each', label: 'Every page' }, { id: 'groups', label: 'Page groups' }, { id: 'ranges', label: 'Ranges' },
  ];
  return <View style={styles.screen}>
    <PdfFileOptionsSheet visible={optionsOpen} onClose={() => setOptionsOpen(false)} name={name} onName={setName} disabled={busy}
      description={merge ? 'Choose 2 to 30 PDFs, then long-press and drag the cards to arrange their order. Up to 2,000 pages per merge. Tap a card to preview its pages.' : 'Split a PDF with at least two pages into individual pages, equal groups, or custom ranges. Up to 100 output PDFs per operation.'}>
      {!merge && splitMode === 'groups' && <><ThemedText>Pages per PDF</ThemedText><BottomSheetTextInput accessibilityLabel="Pages per PDF" keyboardType="number-pad" value={groupSize} onChangeText={setGroupSize} editable={!busy} maxLength={4} style={inputStyle} /></>}
      {!merge && splitMode === 'ranges' && <><ThemedText>Each range creates a PDF. Example: 1-3, 4, 5-8. Unlisted pages are excluded.</ThemedText><BottomSheetTextInput accessibilityLabel="Page ranges" placeholder="1-3, 4-8" placeholderTextColor={colors.secondaryLabel} value={customRanges} onChangeText={setCustomRanges} editable={!busy} maxLength={1400} style={inputStyle} /></>}
      {!merge && !!rangeError && <ThemedText accessibilityRole="alert">{rangeError}</ThemedText>}
    </PdfFileOptionsSheet>
    {!merge && sources[0] ? <PdfDocumentPreview key={sources[0].uri} uri={sources[0].uri} count={sources[0].pageCount} embedded disabled={busy} onClose={() => {}} />
      : <SortableGrid data={sources} geometry={geometry} enabled={!busy} onMove={reorder} keyExtractor={file => file.uri}
        contentContainerStyle={styles.list} columnWrapperStyle={styles.columns} extraData={visibleKeys}
        initialNumToRender={6} maxToRenderPerBatch={4} windowSize={5} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
        header={<View style={styles.form}>
          <ThemedText style={styles.label}>{sources.length ? `Merge order · ${sources.length} PDFs · ${pageCount} pages` : 'Choose PDFs to get started.'}</ThemedText>
          {sources.length > 0 && <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Tap a card to preview. Long-press and drag a card, or use the arrows, to change the order.</ThemedText>}
          {!available && <ThemedText accessibilityRole="alert">Install a new development build to use native PDF {operation}.</ThemedText>}
        </View>}
        renderItem={({ item, index, dragging }) => <PdfSourceCard uri={item.uri} name={item.name} label={`PDF ${index + 1}`} detail={`${item.pageCount} pages · ${formatSize(item.size)}`} kind="pdf" active={active && visibleKeys.has(item.uri)} disabled={busy} fullWidth={columns === 1}
          lifted={dragging} onLayout={index === 0 ? event => { const { width: w, height: h } = event.nativeEvent.layout; setCard(current => current?.width === w && current.height === h ? current : { width: w, height: h }); } : undefined}
          onPreview={() => setPreviewSource(item)} onMove={direction => move(index, direction)} onRemove={() => removeSource(index)} canMoveBack={index > 0} canMoveForward={index + 1 < sources.length} />}
        renderGhost={(item, index) => <PdfSourceCard uri={item.uri} name={item.name} label={`PDF ${index + 1}`} detail={`${item.pageCount} pages · ${formatSize(item.size)}`} kind="pdf" active={active} disabled fullWidth
          onPreview={() => {}} onMove={() => {}} onRemove={() => {}} canMoveBack={false} canMoveForward={false} />} />}
    <PdfPreviewFooter>
      {!!error && <ThemedText accessibilityRole="alert" style={styles.body}>{error}</ThemedText>}
      {busy ? <><AppLoader /><ThemedText accessibilityLiveRegion="polite" style={styles.body}>{cancelling ? 'Cancelling...' : progress === 1 ? 'Saving and verifying PDFs...' : `${phase}${progress !== null ? ` ${Math.round(progress * 100)}%` : ''}`}</ThemedText>
        {(progress !== null || phase.startsWith('Reading PDF details')) && <ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelPdfJob(job.current); } }} />}
      </> : <>
        {merge && sources.length === 1 && <ThemedText accessibilityLiveRegion="polite" style={styles.caption}>Add at least one more PDF to merge.</ThemedText>}
        {!merge && sources.length > 0 && <ThemedText accessibilityLiveRegion="polite" accessibilityRole={rangeError ? 'alert' : undefined} style={styles.caption}>{rangeError || (sources[0].pageCount < 2 ? 'This PDF has only one page — nothing to split.' : `${ranges.length} output PDFs · ${ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0)} pages`)}</ThemedText>}
        <EditorActionBar>
          {!merge && sources.length > 0 && splitModes.map(item => (
            <EditorOption key={item.id} compact label={item.label} selected={splitMode === item.id} disabled={sources[0].pageCount < 2}
              icon={item.id === 'each' ? { ios: 'doc.on.doc', android: 'library-books' } : item.id === 'groups' ? { ios: 'square.grid.2x2', android: 'grid-view' } : { ios: 'list.number', android: 'format-list-numbered' }}
              onPress={() => { setSplitMode(item.id); if (item.id !== 'each') setOptionsOpen(true); }} />
          ))}
          <EditorOption compact label="Options" icon={{ ios: 'slider.horizontal.3', android: 'tune' }} selected={optionsOpen} onPress={() => setOptionsOpen(true)} />
          <EditorOption compact label={sources.length ? merge ? 'Add PDFs' : 'Change PDF' : 'Choose PDF'} icon={{ ios: 'doc.badge.plus', android: 'note-add' }} disabled={!available || (merge && sources.length >= 30)} onPress={() => void choose()} />
          <ToolButton title={merge ? 'Merge PDFs' : 'Split PDF'} onPress={() => void process()} disabled={!canRun}
            icon={merge ? { ios: 'arrow.triangle.merge', android: 'mdi:call-merge' } : { ios: 'arrow.triangle.branch', android: 'mdi:call-split' }} />
        </EditorActionBar>
      </>}
    </PdfPreviewFooter>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1, minWidth: 0 }, list: { padding: s.lg, gap: s.md }, form: { gap: s.md, paddingBottom: s.md },
  heading: { ...t.heading }, label: { ...t.label }, body: { ...t.body }, caption: { ...t.caption },
  input: { minHeight: 48, borderRadius: radius.sm, paddingHorizontal: s.lg, paddingVertical: s.md, ...t.body },
  columns: { justifyContent: 'space-between' },
  footer: { paddingHorizontal: toolChrome.paddingHorizontal, paddingVertical: toolChrome.paddingVertical, gap: toolChrome.gap, borderTopWidth: StyleSheet.hairlineWidth },
  resultCard: { padding: s.lg, gap: s.md, borderRadius: radius.md }, actions: { gap: s.sm },
});

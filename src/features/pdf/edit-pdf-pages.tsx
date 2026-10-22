import { EditorActionBar } from '@/components/editor-action-bar';
import { useVisibleListItems } from '@/hooks/use-visible-list-items';
import { toast } from '@/components/toast';
import type { InitialSelection } from './pdf-tool-session';
import { useInitialFiles } from './use-initial-files';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { HelpSheetTextInput as BottomSheetTextInput } from '@/components/help-text-input';
import { AppLoader } from '@/components/app-loader';
import { File } from 'expo-file-system';
import { PdfEngine, type PdfResult } from '../../../modules/pdf-engine';
import { HandoffScreen } from '@/components/handoff-screen';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, savedPdfDirectory, shareFile, shareNamedFile, type LocalFile } from '../files/file-storage';
import { usePublishHeaderShare } from '@/components/header-share';
import { copyPdf, usePublishPdfHandoff } from './pdf-handoff';
import { savePdfResult } from '../files/save-file';
import { FileThumbnail } from '@/components/file-thumbnail';
import { useScreenActive } from '@/hooks/use-screen-active';
import { openPdfResult, showSavedPdf } from './open-pdf-screen';
import { PdfDocumentPreview } from './pdf-document-preview';
import { PdfPreviewFooter } from './pdf-preview';
import { PdfFileOptionsSheet } from './pdf-file-options-sheet';
import { EditorOption } from '@/components/editor-option';

type Source = LocalFile & { pageCount: number };
type Output = PdfResult & { name: string; location?: string };
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function EditPdfPages({ operation, initialSelection }: { operation: 'extract' | 'delete'; initialSelection?: InitialSelection }) {
  const colors = usePalette();
  const active = useScreenActive();
  const { visibleKeys, onViewableItemsChanged, viewabilityConfig } = useVisibleListItems();
  const extracting = operation === 'extract';
  const available = !!PdfEngine?.organizePdfs && !!PdfEngine?.inspectPdfs;
  const [directory] = useState(() => initialSelection?.directory ?? createImportDirectory());
  const [source, setSource] = useState<Source | null>(null);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rangeText, setRangeText] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Output | null>(null);
  // The saved PDF opens by itself; until then the result screen stays hidden.
  const [leaving, setLeaving] = useState(false);

  const pageCount = source?.pageCount ?? 0;
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount]);
  const togglePage = useCallback((page: number) => setSelected(current => {
    const next = new Set(current); if (next.has(page)) next.delete(page); else next.add(page); return next;
  }), []);
  const sourceUri = source?.uri ?? '';
  const renderPage = useCallback(({ item }: { item: number }) => <SelectablePage item={item} uri={sourceUri} active={active && visibleKeys.has(String(item))} selected={selected.has(item)} busy={busy} extracting={extracting} onToggle={togglePage} onPreview={setPreviewPage} />, [sourceUri, active, visibleKeys, selected, busy, extracting, togglePage]);

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
    setError(failure.code === 'PDF_CANCELLED' ? 'Cancelled. Your original PDF is unchanged.' : failure.message ?? 'Something went wrong. Please try again.');
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
      const details = await PdfEngine.inspectPdfs(id, [picked[0].uri]);
      if (!mounted.current) return;
      const count = details[0].pageCount;
      setSource({ ...picked[0], pageCount: count });
      setSelected(new Set()); setRangeText(''); setOptionsOpen(false);
      setName(`${picked[0].name.replace(/\.pdf$/i, '')}${extracting ? ' - selected pages' : ' - edited'}`);
      if (!extracting && count < 2) toast('This PDF has only one page. Deleting it would leave nothing — keep at least one page.');
      accepted = true;
    } catch (cause) { fail(cause); }
    finally {
      if (!accepted) for (const file of picked) { try { new File(file.uri).delete(); } catch { /* Session cleanup retries. */ } }
      finish();
    }
  }

  function applyRanges() {
    if (!source) return;
    try {
      const next = new Set<number>();
      for (const entry of rangeText.split(',')) {
        const match = entry.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!match) throw new Error('Use page numbers like 1, 3, 5-8.');
        const start = Number(match[1]); const end = Number(match[2] ?? match[1]);
        if (start < 1 || end < start || end > source.pageCount) throw new Error(`Choose pages between 1 and ${source.pageCount}.`);
        for (let page = start; page <= end; page++) next.add(page);
      }
      setSelected(next); setError(''); setOptionsOpen(false); Keyboard.dismiss();
    } catch (cause) { fail(cause); }
  }
  const outputCount = source ? extracting ? selected.size : source.pageCount - selected.size : 0;
  const canSave = available && !busy && selected.size > 0 && outputCount > 0;
  const extractLabel = extracting
    ? (selected.size === 0 ? 'Extract pages' : selected.size === 1 ? 'Extract 1 page' : `Extract ${selected.size} pages`)
    : 'Delete pages';
  usePublishHeaderShare({ active: !!shareTarget, disabled: busy, label: result ? 'Share new PDF' : 'Share original PDF',
    onShare: () => shareTarget && shareNamedFile({ uri: shareTarget.uri, name: shareTarget.name, size: shareTarget.size, mimeType: 'application/pdf' }),
    save: { disabled: busy || !!result?.location || (!result && !canSave), label: result?.location ? 'PDF saved' : extracting ? 'Save PDF with selected pages' : 'Save PDF without selected pages',
      onSave: () => result ? saveResult() : save() } });
  usePublishPdfHandoff(!!shareTarget, {
    changed: !!result && !result.location,
    saved: result?.location ? { uri: result.uri, name: result.name } : undefined,
    blocked: busy ? 'Wait for the current task to finish, then choose another tool.' : undefined,
    pending: !result && selected.size > 0 ? (extracting ? 'The pages you selected are not extracted yet. Save PDF creates the new PDF.' : 'The pages you selected are not deleted yet. Save PDF removes them.') : undefined,
    switched: !result && source && source.uri !== initialSelection?.files[0]?.uri ? { file: source } : undefined,
    write: outputUri => shareTarget ? copyPdf(shareTarget.uri, outputUri) : Promise.reject(new Error('Choose a PDF first.')),
  });
  async function save() {
    if (locked.current || !source || !PdfEngine) return;
    if (selected.size === 0) { toast('Select a page to get started.'); return; }
    if (outputCount === 0) { toast('Keep at least one page in the new PDF.'); return; }
    if (extracting && selected.size === source.pageCount) toast('Every page is selected — saving a full copy of the original.');
    Keyboard.dismiss();
    locked.current = true; setBusy(true); setError(''); setProgress(0); setPhase('Creating your PDF…');
    toast('Creating your PDF…');
    const id = newId(); job.current = id;
    const filename = `${name.trim().replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9 _-]+/g, '_').slice(0, 80) || 'Edited PDF'}-${id}.pdf`;
    try {
      const outputs = await PdfEngine.organizePdfs({ jobId: id, operation, uris: [source.uri], outputUris: [new File(savedPdfDirectory(), filename).uri], ranges: [], pages: [...selected].sort((a, b) => a - b) });
      if (mounted.current) { setResult({ ...outputs[0], name: filename }); setLeaving(true); }
      const saved = await savePdfResult({ ...outputs[0], name: filename }, initialSelection?.origin, initialSelection?.origin ? undefined : { mode: 'new', name: filename }, false);
      if (saved) toast(`Saved to ${saved.device.location}`);
      if (saved && mounted.current && showSavedPdf(saved.file, initialSelection?.returnRoute)) return;
      if (mounted.current) { setLeaving(false); if (saved) setResult({ ...outputs[0], uri: saved.file.uri, name: saved.file.name, location: saved.device.location }); }
    } catch (cause) { if (mounted.current) setLeaving(false); fail(cause); }
    finally { finish(); }
  }
  async function saveResult() {
    if (!result || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const saved = await savePdfResult(result, initialSelection?.origin, undefined, false);
      if (saved) toast(`Saved to ${saved.device.location}`);
      if (saved && mounted.current && showSavedPdf(saved.file, initialSelection?.returnRoute)) { setLeaving(true); return; }
      if (saved && mounted.current) setResult(current => current && { ...current, uri: saved.file.uri, name: saved.file.name, location: saved.device.location });
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

  if (leaving) return <HandoffScreen label="Saving and opening your PDF…" />;
  if (result) return <ScrollView contentContainerStyle={styles.result}>
    <UniversalIcon ios="checkmark.circle.fill" android="check-circle" size={48} color={colors.systemBlue} />
    <ThemedText style={styles.heading}>Your PDF is ready</ThemedText>
    <ThemedText style={styles.body}>{result.pageCount} {result.pageCount === 1 ? 'page' : 'pages'} included.{!result.location ? ' Save to finish.' : ''}</ThemedText>
    <ThemedText numberOfLines={3} style={[styles.body, { color: colors.secondaryLabel }]}>{result.name}</ThemedText>
    <ToolButton title="Open PDF" disabled={busy} onPress={() => openPdfResult(result, initialSelection?.returnRoute)} />
    {result.location ? <ThemedText>Saved to {result.location}</ThemedText> : <ToolButton title="Save" disabled={busy} onPress={saveResult} />}
    <ToolButton title="Share" secondary disabled={busy} onPress={exportResult} />
    <ToolButton title="Edit another PDF" secondary disabled={busy} onPress={() => { setResult(null); setSource(null); setSelected(new Set()); setError(''); }} />
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    {busy && <AppLoader />}
  </ScrollView>;

  if (!source) {
    return <View style={styles.screen}>
      <View style={styles.empty}>
        <UniversalIcon ios={extracting ? 'doc.badge.arrow.up' : 'trash'} android={extracting ? 'mdi:file-export-outline' : 'delete-outline'} size={44} color={colors.systemBlue} />
        <ThemedText style={styles.heading}>{extracting ? 'Extract pages' : 'Delete pages'}</ThemedText>
        <ThemedText style={[styles.body, styles.emptyBody, { color: colors.secondaryLabel }]}>
          {extracting
            ? 'Choose a PDF, tap the pages to keep, then create a new PDF. Your original stays unchanged.'
            : 'Choose a PDF, tap the pages to remove, then create a new copy. Your original stays unchanged.'}
        </ThemedText>
        {!available && <ThemedText accessibilityRole="alert">Install a new development build to use this tool.</ThemedText>}
        {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        {busy
          ? <><AppLoader /><ThemedText accessibilityLiveRegion="polite">{phase || 'Opening your PDF…'}</ThemedText></>
          : <ToolButton title="Choose PDF" disabled={!available} onPress={() => void choose()} />}
      </View>
    </View>;
  }

  return <View style={styles.screen}>
    <FlatList onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig} data={pages} numColumns={3} extraData={selected} keyExtractor={page => String(page)} contentContainerStyle={styles.list} columnWrapperStyle={styles.row} keyboardShouldPersistTaps="handled" initialNumToRender={9} maxToRenderPerBatch={3} windowSize={3}
      ListHeaderComponent={<View style={styles.form}>
        <ThemedText numberOfLines={2} style={styles.label}>{source.name} · {source.pageCount} {source.pageCount === 1 ? 'page' : 'pages'}</ThemedText>
        <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>
          {extracting
            ? 'Tap pages to keep in the new PDF. Your original is unchanged.'
            : 'Tap pages to remove from the new copy. Your original is unchanged.'}
          {' '}Tap the eye to preview a page.
        </ThemedText>
      </View>}
      renderItem={renderPage}
    />
    <PdfFileOptionsSheet visible={optionsOpen} onClose={() => setOptionsOpen(false)} name={name} onName={setName} disabled={busy} onChoose={available ? () => void choose() : undefined}
      description={extracting ? 'Selected pages are saved in a new PDF. Your original is kept.' : 'Selected pages are removed from a new copy. Your original is kept.'}>
      <ThemedText>Page numbers or ranges</ThemedText>
      <BottomSheetTextInput accessibilityLabel="Page numbers or ranges" placeholder="For example: 1, 3, 5-8" placeholderTextColor={colors.secondaryLabel} value={rangeText} onChangeText={setRangeText} editable={!busy} maxLength={1400} style={[styles.input, { color: colors.label, backgroundColor: colors.fieldSurface }]} />
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <ToolButton title="Select these pages" secondary onPress={applyRanges} disabled={busy || !rangeText.trim()} />
    </PdfFileOptionsSheet>
    <PdfPreviewFooter>
      {!!error && <ThemedText accessibilityRole="alert" style={styles.body}>{error}</ThemedText>}
      {busy ? <><AppLoader /><ThemedText accessibilityLiveRegion="polite">{cancelling ? 'Cancelling...' : progress === 1 ? 'Saving your PDF...' : `${phase}${progress === null ? '' : ` ${Math.round(progress * 100)}%`}`}</ThemedText>{progress !== null && <ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelPdfJob(job.current); } }} />}</> : <>
        <ThemedText accessibilityLiveRegion="polite" style={styles.caption}>{selected.size === 0 ? 'Select a page to get started.'
          : outputCount === 0 ? 'Keep at least one page in the new PDF.'
          : extracting && selected.size === source.pageCount ? `Every page is selected — the new PDF will match the original (${outputCount} pages).`
          : `${selected.size} ${extracting ? 'selected' : 'to remove'} · ${outputCount} ${outputCount === 1 ? 'page' : 'pages'} in the new PDF`}</ThemedText>
        <EditorActionBar>
          <EditorOption compact label="Page numbers" accessibilityLabel="Page numbers, ranges, and output name" icon={{ ios: 'list.number', android: 'format-list-numbered' }} selected={optionsOpen} onPress={() => setOptionsOpen(true)} />
          <EditorOption compact label={selected.size === source.pageCount ? 'Clear' : 'Select all'} icon={{ ios: selected.size === source.pageCount ? 'xmark.circle' : 'checkmark.circle', android: selected.size === source.pageCount ? 'deselect' : 'select-all' }} onPress={() => setSelected(selected.size === source.pageCount ? new Set() : new Set(pages))} />
          <ToolButton
            title={extractLabel}
            icon={extracting
              ? { ios: 'doc.badge.arrow.up', android: 'mdi:file-export-outline' }
              : { ios: 'trash', android: 'delete-outline' }}
            disabled={!canSave}
            onPress={save}
          />
        </EditorActionBar>
      </>}
    </PdfPreviewFooter>
  </View>;
}

const SelectablePage = memo(function SelectablePage({ item, uri, active, selected, busy, extracting, onToggle, onPreview }: {
  item: number; uri: string; active: boolean; selected: boolean; busy: boolean; extracting: boolean;
  onToggle: (page: number) => void; onPreview: (page: number) => void;
}) {
  const colors = usePalette();
  return <View style={[styles.page, { backgroundColor: colors.accentSurface, borderColor: selected ? colors.systemBlue : colors.separator }]}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={`Page ${item}, ${extracting ? 'keep in new PDF' : 'remove from new PDF'}`} accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} onPress={() => onToggle(item)} style={styles.select}>
      <View style={styles.pageThumb}>
        <FileThumbnail uri={uri} kind="pdf" page={item - 1} active={active} />
        {selected && <View style={[styles.checkBadge, { backgroundColor: colors.systemBlue }]}>
          <UniversalIcon ios="checkmark" android="check" size={12} color="#FFFFFF" />
        </View>}
        <Pressable accessibilityRole="button" accessibilityLabel={`Preview page ${item}`} disabled={busy} onPress={() => onPreview(item)} hitSlop={4} style={[styles.eyeCorner, { backgroundColor: colors.systemBackground }]}>
          <UniversalIcon ios="eye" android="visibility" size={16} color={colors.systemBlue} />
        </Pressable>
      </View>
      <View style={styles.pageMeta}>
        <ThemedText style={styles.caption}>Page {item}</ThemedText>
      </View>
    </Pressable>
  </View>;
});

const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1 }, list: { padding: s.lg, gap: s.md, flexGrow: 1 }, form: { gap: s.md, paddingVertical: s.md }, row: { flexDirection: 'row', gap: s.sm, alignItems: 'stretch' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.xl, gap: s.lg },
  emptyBody: { textAlign: 'center', maxWidth: 320 },
  heading: { ...t.heading, textAlign: 'center' }, label: { ...t.label }, body: { ...t.body }, caption: { ...t.caption },
  page: { flex: 1, minWidth: 0, borderWidth: 2, borderRadius: radius.md, overflow: 'hidden' },
  select: { flex: 1, alignItems: 'stretch', gap: s.xs, padding: s.xs },
  pageThumb: { width: '100%', aspectRatio: 3 / 4, minHeight: 88, borderRadius: 8, overflow: 'hidden' },
  checkBadge: { position: 'absolute', left: 6, top: 6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  eyeCorner: { position: 'absolute', right: 4, top: 4, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pageMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 28 },
  input: { minHeight: 48, borderRadius: radius.sm, padding: s.md, ...t.body }, result: { flexGrow: 1, padding: s.xl, gap: s.lg, justifyContent: 'center' },
});

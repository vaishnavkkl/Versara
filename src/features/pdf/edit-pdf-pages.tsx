import { rememberPdfResults } from '../files/recent-files';
import type { InitialSelection } from './pdf-tool-session';
import { useInitialFiles } from './use-initial-files';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import { PdfEngine, type PdfResult } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, savedPdfDirectory, shareFile, type LocalFile } from '../files/file-storage';
import { PdfViewer } from './pdf-viewer';

type Source = LocalFile & { pageCount: number };
type Output = PdfResult & { name: string };
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function EditPdfPages({ operation, initialSelection }: { operation: 'extract' | 'delete'; initialSelection?: InitialSelection }) {
  const colors = usePalette();
  const extracting = operation === 'extract';
  const available = !!PdfEngine?.organizePdfs && !!PdfEngine?.inspectPdfs;
  const [directory] = useState(() => initialSelection?.directory ?? createImportDirectory());
  const [source, setSource] = useState<Source | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rangeText, setRangeText] = useState('');
  const [showRanges, setShowRanges] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Output | null>(null);
  const [preview, setPreview] = useState<{ uri: string; name: string; page: number } | null>(null);
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

  async function choose(initialFiles?: LocalFile[]) {
    if (locked.current || !PdfEngine) return;
    locked.current = true; setBusy(true); setError(''); setPhase('Opening your PDF…');
    let picked: LocalFile[] = [];
    let accepted = false;
    try {
      picked = initialFiles ?? await browseFiles(directory, false, 1, true);
      if (!picked.length || !mounted.current) return;
      const id = newId(); job.current = id;
      const details = await PdfEngine.inspectPdfs(id, [picked[0].uri]);
      if (!mounted.current) return;
      setSource({ ...picked[0], pageCount: details[0].pageCount });
      setSelected(new Set()); setRangeText(''); setShowRanges(false);
      setName(`${picked[0].name.replace(/\.pdf$/i, '')}${extracting ? ' - selected pages' : ' - edited'}`);
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
      setSelected(next); setError('');
    } catch (cause) { fail(cause); }
  }
  const outputCount = source ? extracting ? selected.size : source.pageCount - selected.size : 0;
  const canSave = available && !busy && selected.size > 0 && outputCount > 0;
  async function save() {
    if (!canSave || locked.current || !source || !PdfEngine) return;
    Keyboard.dismiss();
    locked.current = true; setBusy(true); setError(''); setProgress(0); setPhase('Creating your PDF…');
    const id = newId(); job.current = id;
    const filename = `${name.trim().replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 80) || 'Edited PDF'}-${id}.pdf`;
    try {
      const outputs = await PdfEngine.organizePdfs({ jobId: id, operation, uris: [source.uri], outputUris: [new File(savedPdfDirectory(), filename).uri], ranges: [], pages: [...selected].sort((a, b) => a - b) });
      if (mounted.current) setResult({ ...outputs[0], name: filename });
      // History failure must not discard an otherwise successful native export.
      void rememberPdfResults([{ ...outputs[0], name: filename }]).catch(() => {});
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
  if (preview) return <PdfViewer initialDocument={preview} initialPage={preview.page} onBack={() => setPreview(null)} />;
  if (result) return <ScrollView contentContainerStyle={styles.result}>
    <UniversalIcon ios="checkmark.circle.fill" android="check-circle" size={48} color={colors.systemBlue} />
    <ThemedText style={styles.heading}>Your PDF is ready</ThemedText>
    <ThemedText style={styles.body}>{result.pageCount} {result.pageCount === 1 ? 'page' : 'pages'} saved in a new PDF. Your original is unchanged.</ThemedText>
    <ThemedText numberOfLines={3} style={[styles.body, { color: colors.secondaryLabel }]}>{result.name}</ThemedText>
    <ToolButton title="Open PDF" disabled={busy} onPress={() => setPreview({ ...result, page: 0 })} />
    <ToolButton title="Save to device / share" disabled={busy} onPress={exportResult} />
    <ToolButton title="Edit another PDF" secondary disabled={busy} onPress={() => { setResult(null); setSource(null); setSelected(new Set()); setError(''); }} />
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    {busy && <ActivityIndicator color={colors.systemBlue} />}
  </ScrollView>;

  return <View style={styles.screen}>
    <FlatList data={source ? Array.from({ length: source.pageCount }, (_, index) => index + 1) : []} numColumns={3} extraData={selected} keyExtractor={page => String(page)} contentContainerStyle={styles.list} columnWrapperStyle={styles.row} keyboardShouldPersistTaps="handled" initialNumToRender={18} windowSize={5}
      ListHeaderComponent={<View style={styles.form}>
        <ThemedText style={styles.heading}>1. Choose a PDF</ThemedText>
        <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{extracting ? 'Pick the pages you want to keep in a new PDF.' : 'Pick the pages you want to remove. We’ll save a new copy.'}</ThemedText>
        {!available && <ThemedText accessibilityRole="alert">Install a new development build to use this tool.</ThemedText>}
        <ToolButton title={source ? 'Change PDF' : 'Choose PDF'} disabled={busy || !available} onPress={choose} />
        {source && <>
          <ThemedText numberOfLines={2} style={styles.label}>{source.name} · {source.pageCount} pages</ThemedText>
          <ThemedText style={styles.label}>New PDF name</ThemedText>
          <TextInput accessibilityLabel="New PDF name" value={name} onChangeText={setName} editable={!busy} maxLength={100} style={[styles.input, { color: colors.label, backgroundColor: colors.accentSurface }]} />
          <ThemedText style={styles.heading}>2. {extracting ? 'Select pages to keep' : 'Select pages to remove'}</ThemedText>
          <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Tap a page number to select it. Tap its eye icon to read that page.</ThemedText>
          <View style={styles.row}><View style={styles.grow}><ToolButton title={selected.size === source.pageCount ? 'Clear selection' : 'Select all'} secondary disabled={busy} onPress={() => setSelected(selected.size === source.pageCount ? new Set() : new Set(Array.from({ length: source.pageCount }, (_, index) => index + 1)))} /></View><View style={styles.grow}><ToolButton title={showRanges ? 'Hide ranges' : 'Enter ranges'} secondary disabled={busy} onPress={() => setShowRanges(value => !value)} /></View></View>
          {showRanges && <><TextInput accessibilityLabel="Page numbers or ranges" placeholder="For example: 1, 3, 5-8" placeholderTextColor={colors.secondaryLabel} value={rangeText} onChangeText={setRangeText} editable={!busy} maxLength={1400} style={[styles.input, { color: colors.label, backgroundColor: colors.accentSurface }]} /><ToolButton title="Select these pages" secondary onPress={applyRanges} disabled={busy || !rangeText.trim()} /></>}
        </>}
      </View>}
      renderItem={({ item }) => <View style={[styles.page, { backgroundColor: colors.accentSurface, borderColor: selected.has(item) ? colors.systemBlue : colors.separator }]}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`Page ${item}, ${extracting ? 'keep in new PDF' : 'remove from new PDF'}`} accessibilityState={{ checked: selected.has(item), disabled: busy }} disabled={busy} onPress={() => setSelected(current => { const next = new Set(current); if (next.has(item)) next.delete(item); else next.add(item); return next; })} style={styles.select}>
          <UniversalIcon ios={selected.has(item) ? 'checkmark.circle.fill' : 'circle'} android={selected.has(item) ? 'check-circle' : 'radio-button-unchecked'} size={22} color={colors.systemBlue} />
          <ThemedText style={styles.label}>Page {item}</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Preview page ${item}`} disabled={busy} onPress={() => source && setPreview({ ...source, page: item - 1 })} style={styles.eye}><UniversalIcon ios="eye" android="visibility" size={20} color={colors.systemBlue} /></Pressable>
      </View>}
    />
    {(!!source || busy || !!error) && <View style={[styles.footer, { borderColor: colors.separator }]}>
      {!!error && <ThemedText accessibilityRole="alert" style={styles.body}>{error}</ThemedText>}
      {busy ? <><ActivityIndicator color={colors.systemBlue} /><ThemedText accessibilityLiveRegion="polite">{cancelling ? 'Cancelling…' : progress === 1 ? 'Saving your PDF…' : `${phase}${progress === null ? '' : ` ${Math.round(progress * 100)}%`}`}</ThemedText>{progress !== null && <ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelPdfJob(job.current); } }} />}</> : <>
        <ThemedText accessibilityLiveRegion="polite" style={styles.body}>{selected.size === 0 ? 'Select a page to get started.' : outputCount === 0 ? 'Keep at least one page. Unselect a page to continue.' : `${selected.size} ${extracting ? 'selected' : 'to remove'} · ${outputCount} ${outputCount === 1 ? 'page' : 'pages'} in your new PDF`}</ThemedText>
        <ToolButton title={extracting ? 'Create PDF with selected pages' : 'Save PDF without selected pages'} disabled={!canSave} onPress={save} />
      </>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1 }, list: { padding: s.lg, gap: s.md }, form: { gap: s.md, paddingVertical: s.md }, row: { flexDirection: 'row', gap: s.sm },
  heading: { ...t.heading }, label: { ...t.label }, body: { ...t.body },
  page: { flex: 1 / 3, borderWidth: 2, borderRadius: radius.md, overflow: 'hidden' }, select: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: s.sm, padding: s.xs }, eye: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderRadius: radius.sm, padding: s.md, ...t.body }, footer: { padding: s.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: s.sm }, result: { flexGrow: 1, padding: s.xl, gap: s.lg, justifyContent: 'center' },
});

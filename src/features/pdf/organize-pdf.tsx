import { rememberPdfResults, forgetRecentUri } from '../files/recent-files';
import type { InitialSelection } from './pdf-tool-session';
import { useInitialFiles } from './use-initial-files';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import { Host, Picker } from '@expo/ui';
import { PdfEngine, type PdfRange, type PdfResult } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { useAppearance, usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, formatSize, savedPdfDirectory, shareFile, type LocalFile } from '../files/file-storage';
import { PdfViewer } from './pdf-viewer';
import { splitRanges, type SplitMode } from './pdf-ranges';

type Source = LocalFile & { pageCount: number };
type Result = PdfResult & { name: string; part: number };
const jobId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function OrganizePdf({ operation, initialSelection }: { operation: 'merge' | 'split'; initialSelection?: InitialSelection }) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const merge = operation === 'merge';
  const available = !!PdfEngine?.organizePdfs && !!PdfEngine?.inspectPdfs;
  const [directory] = useState(() => initialSelection?.directory ?? createImportDirectory());
  const [sources, setSources] = useState<Source[]>([]);
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
  const [preview, setPreview] = useState<Result | null>(null);
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

  async function choose(initialFiles?: LocalFile[]) {
    if (locked.current || !PdfEngine?.inspectPdfs) return;
    locked.current = true; setBusy(true); setError(''); setPhase('Opening file browser…');
    let picked: LocalFile[] = [];
    let accepted = false;
    try {
      picked = initialFiles ?? await browseFiles(directory, false, merge ? 30 - sources.length : 1, true);
      if (!picked.length || !mounted.current) return;
      const id = jobId(); job.current = id;
      setPhase('Reading PDF details…');
      const info = await PdfEngine.inspectPdfs(id, picked.map(file => file.uri));
      if (!mounted.current) return;
      const next = picked.map((file, index) => ({ ...file, pageCount: info[index].pageCount }));
      if (merge && sources.reduce((sum, file) => sum + file.pageCount, 0) + next.reduce((sum, file) => sum + file.pageCount, 0) > 2000) throw new Error('Merge up to 2,000 pages at a time. Choose fewer PDFs.');
      setSources(current => merge ? [...current, ...next] : next);
      if (!merge) { setCustomRanges(''); setSplitMode(next[0].pageCount > 100 ? 'groups' : 'each'); setGroupSize(String(Math.max(Math.min(10, next[0].pageCount), Math.ceil(next[0].pageCount / 100)))); }
      accepted = true;
    } catch (cause) { fail(cause); }
    finally {
      if (!accepted) for (const file of picked) { try { const local = new File(file.uri); if (local.exists) local.delete(); } catch { /* Session cleanup retries. */ } }
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
  const canRun = available && !busy && (merge ? sources.length >= 2 : ranges.length > 0);

  async function process() {
    if (!PdfEngine?.organizePdfs || locked.current || !canRun) return;
    locked.current = true; setBusy(true); setError(''); setProgress(0); setCancelling(false); setPhase(merge ? 'Merging PDFs…' : 'Splitting PDF…');
    const id = jobId(); job.current = id;
    const safeName = name.trim().replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 60) || (merge ? 'Merged' : 'Split');
    const stamp = new Date().toISOString().replace(/[T:.]/g, '-').replace(/Z$/, '');
    const names = merge ? [`${safeName}-${stamp}.pdf`] : ranges.map((range, index) => `${safeName}-${stamp}-part-${index + 1}-pages-${range.start}-${range.end}.pdf`);
    try {
      const outputs = await PdfEngine.organizePdfs({ jobId: id, operation, uris: sources.map(source => source.uri), outputUris: names.map(filename => new File(savedPdfDirectory(), filename).uri), ranges: merge ? [] : ranges });
      if (mounted.current) setResults(outputs.map((output, index) => ({ ...output, name: names[index], part: index + 1 })));
      // History failure must not discard an otherwise successful native export.
      void rememberPdfResults(outputs.map((output, index) => ({ ...output, name: names[index] }))).catch(() => {});
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
  const inputStyle = [styles.input, { color: colors.label, backgroundColor: colors.accentSurface }];

  if (preview) return <PdfViewer key={preview.uri} initialDocument={preview} onBack={() => setPreview(null)} />;
  if (results.length) return <View style={styles.screen}>
    <FlatList data={results} keyExtractor={result => result.uri} contentContainerStyle={styles.list} ListHeaderComponent={<View style={styles.form}><ThemedText style={styles.heading}>{merge ? 'Your merged PDF is ready' : `${results.length} PDFs are ready`}</ThemedText><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Save or share the PDFs you want to keep in your preferred folder.</ThemedText>{!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}</View>} renderItem={({ item, index }) => <View style={[styles.resultCard, { backgroundColor: colors.accentSurface }]}>
      <ThemedText numberOfLines={2} style={styles.label}>{merge ? 'Merged document' : `Part ${item.part}`}</ThemedText>
      <ThemedText numberOfLines={2} style={styles.body}>{item.name}</ThemedText>
      <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{item.pageCount} pages · {formatSize(item.size)}</ThemedText>
      <View style={styles.actions}><View style={styles.grow}><ToolButton title="Open" onPress={() => setPreview(item)} disabled={busy} /></View><View style={styles.grow}><ToolButton title="Save / share" onPress={() => share(item)} disabled={busy} /></View></View>
      <ToolButton title="Delete output" secondary disabled={busy} onPress={() => { try { new File(item.uri).delete(); void forgetRecentUri(item.uri).catch(() => {}); setResults(current => current.filter(file => file.uri !== item.uri)); } catch { setError('Could not delete this PDF. Try again.'); } }} />
    </View>} />
    <View style={styles.footer}>{busy && <ActivityIndicator color={colors.systemBlue} />}<ToolButton title={merge ? 'Merge more PDFs' : 'Split another PDF'} secondary disabled={busy} onPress={() => { setResults([]); setError(''); }} /></View>
  </View>;

  return <View style={styles.screen}>
    <FlatList data={sources} keyExtractor={file => file.uri} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" ListHeaderComponent={<View style={styles.form}>
      <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{merge ? 'Choose 2–30 PDFs and arrange their order. Up to 2,000 pages per merge.' : 'Choose a PDF, then split it into individual pages, equal groups, or custom ranges. Up to 100 output PDFs per operation.'}</ThemedText>
      {!available && <ThemedText accessibilityRole="alert">Install a new development build to use native PDF {operation}.</ThemedText>}
      <ToolButton title={sources.length ? merge ? 'Add PDFs' : 'Change PDF' : 'Browse PDFs'} onPress={choose} disabled={busy || !available || (merge && sources.length >= 30)} />
      <ThemedText style={styles.label}>Output name</ThemedText><TextInput accessibilityLabel="Output PDF name" value={name} onChangeText={setName} editable={!busy} maxLength={64} style={inputStyle} />
      {!merge && sources.length > 0 && <>
        <View style={styles.options}><ThemedText style={styles.label}>Split by</ThemedText><Host colorScheme={mode} seedColor={colors.accent} matchContents><Picker selectedValue={splitMode} onValueChange={setSplitMode} enabled={!busy}><Picker.Item label="Every page" value="each" /><Picker.Item label="Page groups" value="groups" /><Picker.Item label="Custom ranges" value="ranges" /></Picker></Host></View>
        {splitMode === 'groups' && <TextInput accessibilityLabel="Pages per PDF" placeholder="Pages per PDF" placeholderTextColor={colors.secondaryLabel} keyboardType="number-pad" value={groupSize} onChangeText={setGroupSize} editable={!busy} maxLength={4} style={inputStyle} />}
        {splitMode === 'ranges' && <><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Each comma-separated range creates a separate PDF. Example: 1-3, 4, 5-8. Unlisted pages are not included.</ThemedText><TextInput accessibilityLabel="Page ranges" placeholder="1-3, 4-8" placeholderTextColor={colors.secondaryLabel} value={customRanges} onChangeText={setCustomRanges} editable={!busy} maxLength={1400} style={inputStyle} /></>}
        <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{rangeError || `${ranges.length} output PDFs · ${ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0)} pages`}</ThemedText>
      </>}
      {!!sources.length && <ThemedText style={styles.label}>{merge ? `Merge order · ${pageCount} pages` : 'Source document'}</ThemedText>}
    </View>} renderItem={({ item, index }) => <View style={[styles.sourceRow, { backgroundColor: colors.accentSurface }]}>
      <View style={styles.grow}><ThemedText numberOfLines={2} style={styles.label}>{merge ? `${index + 1}. ` : ''}{item.name}</ThemedText><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{item.pageCount} pages · {formatSize(item.size)}</ThemedText></View>
      {merge && ([-1, 1] as const).map(direction => <Pressable key={direction} accessibilityRole="button" accessibilityLabel={`Move PDF ${index + 1} ${direction < 0 ? 'up' : 'down'}`} disabled={busy || index + direction < 0 || index + direction >= sources.length} style={[styles.iconButton, (busy || index + direction < 0 || index + direction >= sources.length) && styles.disabled]} onPress={() => move(index, direction)}><UniversalIcon ios={direction < 0 ? 'chevron.up' : 'chevron.down'} android={direction < 0 ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color={colors.systemBlue} /></Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} disabled={busy} style={styles.iconButton} onPress={() => removeSource(index)}><UniversalIcon ios="xmark" android="close" size={20} color={colors.systemBlue} /></Pressable>
    </View>} />
    <View style={[styles.footer, { borderColor: colors.separator }]}>
      {!!error && <ThemedText accessibilityRole="alert" style={styles.body}>{error}</ThemedText>}
      {busy && <><ActivityIndicator color={colors.systemBlue} /><ThemedText accessibilityLiveRegion="polite" style={styles.body}>{cancelling ? 'Cancelling…' : progress === 1 ? 'Saving and verifying PDFs…' : `${phase}${progress !== null ? ` ${Math.round(progress * 100)}%` : ''}`}</ThemedText></>}
      {busy && (progress !== null || phase === 'Reading PDF details…') ? <ToolButton title="Cancel" secondary disabled={cancelling} onPress={() => { if (job.current) { setCancelling(true); PdfEngine?.cancelPdfJob(job.current); } }} /> : <ToolButton title={merge ? 'Merge PDFs' : 'Split PDF'} onPress={process} disabled={!canRun} />}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1, minWidth: 0 }, list: { padding: s.lg, gap: s.md }, form: { gap: s.md, paddingBottom: s.md },
  heading: { ...t.heading }, label: { ...t.label }, body: { ...t.body },
  input: { minHeight: 48, borderRadius: radius.sm, paddingHorizontal: s.lg, paddingVertical: s.md, ...t.body },
  options: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' },
  sourceRow: { flexDirection: 'row', alignItems: 'center', padding: s.sm, borderRadius: radius.sm },
  iconButton: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.3 },
  footer: { padding: s.lg, gap: s.sm, borderTopWidth: StyleSheet.hairlineWidth },
  resultCard: { padding: s.lg, gap: s.md, borderRadius: radius.md }, actions: { flexDirection: 'row', gap: s.sm },
});

import { rememberPdfResults } from '../files/recent-files';
import { toast } from '@/components/toast';
import type { InitialSelection } from './pdf-tool-session';
import { useInitialFiles } from './use-initial-files';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
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
import { openPdfScreen } from './open-pdf-screen';

type Source = LocalFile & { pageCount: number };
type Output = PdfResult & { name: string };
type Page = { original: number; rotation: number };
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const originalPages = (count: number): Page[] => Array.from({ length: count }, (_, index) => ({ original: index + 1, rotation: 0 }));

export function ArrangePdfPages({ operation, initialSelection }: { operation: 'reorder' | 'rotate'; initialSelection?: InitialSelection }) {
  const colors = usePalette();
  const active = useScreenActive();
  const reorder = operation === 'reorder';
  const available = !!PdfEngine?.organizePdfs && !!PdfEngine?.inspectPdfs;
  const [directory] = useState(() => initialSelection?.directory ?? createImportDirectory());
  const [source, setSource] = useState<Source | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [name, setName] = useState('');
  const [moving, setMoving] = useState<number | null>(null);
  const [position, setPosition] = useState('');
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

  if (result) return <ScrollView contentContainerStyle={styles.result}>
    <UniversalIcon ios="checkmark.circle.fill" android="check-circle" size={48} color={colors.systemBlue} />
    <ThemedText style={styles.heading}>Your PDF is ready</ThemedText>
    <ThemedText style={styles.body}>{reorder ? 'Your new page order is saved.' : 'Your page rotations are saved.'} All {result.pageCount} pages are included. Your original is unchanged.</ThemedText>
    <ThemedText numberOfLines={3} style={[styles.body, { color: colors.secondaryLabel }]}>{result.name}</ThemedText>
    <ToolButton title="Open PDF" disabled={busy} onPress={() => openPdfScreen(result)} />
    <ToolButton title="Save to device" disabled={busy} onPress={saveResult} />
    <ToolButton title="Share" secondary disabled={busy} onPress={exportResult} />
    <ToolButton title="Edit another PDF" secondary disabled={busy} onPress={() => { setResult(null); setSource(null); setPages([]); setMoving(null); setError(''); }} />
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    {busy && <AppLoader />}
  </ScrollView>;

  return <View style={styles.screen}>
    <FlatList data={pages} keyExtractor={page => String(page.original)} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" initialNumToRender={10} windowSize={5}
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
      renderItem={({ item, index }) => <View style={[styles.card, { backgroundColor: colors.accentSurface, borderColor: colors.separator }]}>
        <View style={styles.actions}>
          <View style={styles.thumb}><FileThumbnail uri={source!.uri} kind="pdf" page={item.original - 1} active={active} /></View>
          <View style={styles.grow}><ThemedText style={styles.label}>{reorder ? `${index + 1}. Original page ${item.original}` : `Page ${item.original}`}</ThemedText><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{reorder ? `Position ${index + 1} in the new PDF` : item.rotation === 0 ? 'No change' : item.rotation === 270 ? 'Turn left 90°' : `Turn right ${item.rotation}°`}</ThemedText></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Preview original page ${item.original}`} disabled={busy} onPress={() => source && openPdfScreen(source, item.original - 1)} style={styles.icon}><UniversalIcon ios="eye" android="visibility" size={22} color={colors.systemBlue} /></Pressable>
        </View>
        <View style={styles.actions}>
          {reorder ? <>
            <Pressable accessibilityRole="button" accessibilityLabel={`Move original page ${item.original} up`} disabled={busy || index === 0} onPress={() => movePage(item.original, index - 1)} style={[styles.icon, (busy || index === 0) && styles.disabled]}><UniversalIcon ios="arrow.up" android="arrow-upward" size={22} color={colors.systemBlue} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Move original page ${item.original} down`} disabled={busy || index === pages.length - 1} onPress={() => movePage(item.original, index + 1)} style={[styles.icon, (busy || index === pages.length - 1) && styles.disabled]}><UniversalIcon ios="arrow.down" android="arrow-downward" size={22} color={colors.systemBlue} /></Pressable>
            <View style={styles.grow}><ToolButton title="Move to…" secondary disabled={busy || pages.length < 2} onPress={() => { setMoving(item.original); setPosition(String(index + 1)); }} /></View>
          </> : <>
            <View style={styles.grow}><ToolButton title="Left 90°" secondary disabled={busy} onPress={() => rotate(item.original, -90)} /></View>
            <View style={styles.grow}><ToolButton title="Right 90°" secondary disabled={busy} onPress={() => rotate(item.original, 90)} /></View>
          </>}
        </View>
        {reorder && moving === item.original && <View style={styles.actions}><TextInput accessibilityLabel={`New position for original page ${item.original}`} keyboardType="number-pad" value={position} onChangeText={setPosition} maxLength={4} editable={!busy} style={[styles.input, styles.grow, { color: colors.label, backgroundColor: colors.systemBackground }]} /><ToolButton title="Move" disabled={busy} onPress={() => movePage(item.original, Number(position) - 1)} /><ToolButton title="Cancel" secondary disabled={busy} onPress={() => { setMoving(null); Keyboard.dismiss(); }} /></View>}
      </View>}
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

const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1, minWidth: 0 }, list: { padding: s.lg, gap: s.md }, form: { gap: s.md, paddingBottom: s.md },
  heading: { ...t.heading }, label: { ...t.label }, body: { ...t.body }, actions: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  card: { padding: s.md, gap: s.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md }, icon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.3 },
  thumb: { width: 52, height: 68 },
  input: { minHeight: 48, borderRadius: radius.sm, padding: s.md, ...t.body }, footer: { padding: s.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: s.sm }, result: { flexGrow: 1, padding: s.xl, gap: s.lg, justifyContent: 'center' },
});

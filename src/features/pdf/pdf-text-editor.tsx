import { askSaveMode, saveEditedOutput, type SaveMode } from '../files/save-file';
import { toast } from '@/components/toast';
import { showDialog } from '@/components/app-dialog';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { ColorSwatches } from '@/components/color-swatches';
import { DEFAULT_TEXT_STYLE, fontName, styleFromFont, TextStyleControls, type TextStyle } from '@/components/text-style-controls';
import { PdfEditCanvas, type PdfTextObject } from './pdf-edit-canvas';
import NativeEditCanvas from '../../../modules/pdf-engine/src/PdfEditCanvasView';
import { useInitialFiles } from './use-initial-files';
import type { InitialSelection } from './pdf-tool-session';
import { UniversalIcon } from '@/components/universal-icon';
import { File } from 'expo-file-system';
import { PdfEngine, type PdfResult } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, savedPdfDirectory, shareFile, type LocalFile } from '../files/file-storage';
import { openPdfScreen } from './open-pdf-screen';
import { PdfPreviewQueue, type PagePreview } from './pdf-preview-queue';
import { useScreenActive } from '@/hooks/use-screen-active';

type TextObject = PdfTextObject;
/** `font` is a standard PDF font name (Helvetica-Bold, Times-Italic, …) or 'original'. */
type Edit = { page: number; kind: 'replace' | 'delete' | 'add'; objectId?: number; original?: string; text?: string; font?: string; size?: number; x?: number; y?: number; color?: number; underline?: boolean; indent?: number };
type Draft = { text: string; style: TextStyle; size: string; indent: number; color: number | null };
const DEFAULT_INK = 0x101020;
const INDENT_STEP = 18;
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const roundSize = (size: number) => Math.round(size * 2) / 2;

function textIssue(text: string, keepsOriginalFont: boolean) {
  if (/[\r\t]/.test(text)) return 'Tabs are not supported. Use Indent instead.';
  const lines = text.split('\n');
  if (lines.length > 50) return 'Use up to 50 lines in one text box.';
  if (keepsOriginalFont && !lines[0].trim() && text.trim()) return 'Start the text on the first line.';
  return '';
}
/** The engine command for the open text box, or null when nothing differs from the saved state. */
function commandFor(page: number, selected: TextObject | null, placement: { x: number; y: number } | null, draft: Draft): Edit | string {
  const font = fontName(draft.style);
  const issue = textIssue(draft.text, !!selected && font === 'original');
  if (issue) return issue;
  const points = Number(draft.size);
  if (!Number.isFinite(points) || points < 4 || points > 200) return 'Choose a font size from 4 to 200.';
  const underline = draft.style.underline ? { underline: true } : {};
  if (selected) {
    const sized = Math.abs(points - roundSize(selected.size)) > 0.01 ? { size: points } : {};
    return { kind: draft.text.trim() ? 'replace' : 'delete', page, objectId: selected.id, original: selected.text, text: draft.text, font, ...sized, ...underline, ...(draft.indent ? { indent: draft.indent } : {}), ...(draft.color !== null ? { color: draft.color } : {}) };
  }
  return { kind: 'add', page, ...placement!, text: draft.text, size: points, font: font === 'original' ? 'Helvetica' : font, color: draft.color ?? DEFAULT_INK, ...underline };
}
const sameEdit = (a: Edit | undefined, b: Edit) => !!a && a.kind === b.kind && a.text === b.text && (a.font ?? 'original') === (b.font ?? 'original') && a.size === b.size && a.color === b.color && !!a.underline === !!b.underline && (a.indent ?? 0) === (b.indent ?? 0);

function makeDraft(edits: Edit[], page: number, selected: TextObject | null, placement: { x: number; y: number } | null, addition: number | null, draft: Draft, pendingOnPage = false): { changes: Edit[]; error?: string } {
  if (!selected && !placement) return { changes: edits };
  if (!selected && !draft.text.trim()) return { changes: addition === null ? edits : edits.filter((_, index) => index !== addition) };
  const command = commandFor(page, selected, placement, draft);
  if (typeof command === 'string') return { changes: edits, error: command };
  if (selected) {
    const existing = edits.find(edit => edit.page === page && edit.objectId === selected.id);
    const unchanged = existing ? sameEdit(existing, command) : command.kind === 'replace' && command.text === selected.text && command.font === 'original' && command.size === undefined && command.color === undefined && !command.underline && !command.indent;
    if (unchanged) return { changes: edits };
  } else if (pendingOnPage) {
    // The on-page text field already shows this text; rendering it too would draw it twice.
    return { changes: addition === null ? edits : edits.filter((_, index) => index !== addition) };
  }
  const changes = command.kind === 'add'
    ? addition === null ? [...edits, command] : edits.map((edit, index) => index === addition ? command : edit)
    : [...edits.filter(edit => !(edit.page === page && edit.objectId === selected?.id)), command];
  return changes.length > 500 ? { changes: edits, error: 'Save these changes before adding more.' } : { changes };
}

/** `onUnsavedChange` lets the screen confirm before leaving with edits that are not saved. */
export function PdfTextEditor({ initialMode = 'edit', initialSelection, onUnsavedChange }: { initialMode?: 'edit' | 'add' | 'delete'; initialSelection?: InitialSelection; onUnsavedChange?: (unsaved: boolean) => void }) {
  const colors = usePalette();
  const screenActive = useScreenActive();
  const available = !!PdfEngine?.editPdfText;
  const [directory] = useState(() => initialSelection?.directory ?? createImportDirectory());
  const [previewQueue] = useState(() => new PdfPreviewQueue(directory));
  const [source, setSource] = useState<LocalFile | null>(null);
  const [page, setPage] = useState(0);
  const [pageInput, setPageInput] = useState('1');
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [savedEdits, setSavedEdits] = useState<Edit[] | null>(null);
  const [history, setHistory] = useState<Edit[][]>([]);
  const [selected, setSelected] = useState<TextObject | null>(null);
  const [fragmentPage, setFragmentPage] = useState(0);
  const [editingAddition, setEditingAddition] = useState<number | null>(null);
  const [placement, setPlacement] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(initialMode === 'add');
  const [text, setText] = useState('');
  const [textStyle, setTextStyle] = useState<TextStyle>(DEFAULT_TEXT_STYLE);
  const [size, setSize] = useState('16');
  const [indent, setIndent] = useState(0);
  const [ink, setInk] = useState<number | null>(DEFAULT_INK);
  const [future, setFuture] = useState<Edit[][]>([]);
  const [name, setName] = useState('Edited PDF');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [previewStatus, setPreviewStatus] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [draftRevision, setDraftRevision] = useState(0);
  const [result, setResult] = useState<(PdfResult & { name: string; location: string }) | null>(null);

  const [showTextList, setShowTextList] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const job = useRef<string | null>(null);
  const obsoleteImages = useRef<{ uri: string; expires: number }[]>([]);
  const displayedPreview = useRef<PagePreview | null>(null);
  const renderedKey = useRef('');

  useEffect(() => {
    mounted.current = true;
    const subscription = available ? PdfEngine?.addListener('onConversionProgress', event => {
      if (mounted.current && event.jobId === job.current) setProgress(event.completed / event.total);
    }) : undefined;
    return () => {
      mounted.current = false; subscription?.remove();
      queueMicrotask(() => {
        if (mounted.current) return;
        previewQueue.cancel();
        if (job.current) PdfEngine?.cancelTextEdit(job.current);
        if (!locked.current) void previewQueue.settle().then(() => { if (!mounted.current && !locked.current) disposeImports(directory); });
      });
    };
  }, [directory, available, previewQueue]);

  function begin(label: string) {
    previewQueue.cancel();
    locked.current = true; setBusy(true); setPhase(label); setError(''); setProgress(null);
    Keyboard.dismiss();
  }
  function finish() {
    locked.current = false; job.current = null;
    if (mounted.current) { setBusy(false); setProgress(null); }
    else void previewQueue.settle().then(() => disposeImports(directory));
  }
  function fail(cause: unknown) {
    if (mounted.current) setError((cause as { message?: string }).message ?? 'Could not edit this PDF. Please try again.');
  }
  async function loadPage(file: LocalFile, target: number, changes: Edit[]) {
    const response = await previewQueue.render(file.uri, target, JSON.stringify(changes.filter(edit => edit.page === target)));
    return mounted.current ? response : null;
  }
  function showPreview(next: PagePreview) {
    renderedKey.current = '';
    // Keep the last image until its replacement has reached the native image view.
    if (displayedPreview.current?.imageUri === next.imageUri) return;
    if (displayedPreview.current) obsoleteImages.current.push({ uri: displayedPreview.current.imageUri, expires: Date.now() + 1000 });
    displayedPreview.current = next;
    setPreview(next);
  }
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const expired = obsoleteImages.current.filter(image => image.expires <= now);
      obsoleteImages.current = obsoleteImages.current.filter(image => image.expires > now);
      for (const { uri } of expired) {
        try { const file = new File(uri); if (file.exists) file.delete(); }
        catch { /* Session cleanup retries. */ }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Drafts use the same commands as Apply/Save. PDF pixels and text changes still
  // come from the native engine; JS only schedules work and displays its image.
  const nativeTextBox = !!NativeEditCanvas && adding && !!placement && !selected;
  const draft = makeDraft(edits, page, selected, placement, editingAddition, { text, style: textStyle, size, indent, color: ink }, nativeTextBox);
  const draftJson = JSON.stringify(draft.changes.filter(edit => edit.page === page));
  const draftIssue = draft.error;
  const unsaved = (edits.length > 0 && edits !== savedEdits) || draft.changes !== edits || (!!placement && !!text.trim());
  useEffect(() => { onUnsavedChange?.(unsaved); }, [unsaved, onUnsavedChange]);
  const sourceUri = source?.uri;
  const publishLivePreview = useEffectEvent((next: PagePreview) => showPreview(next));
  useEffect(() => {
    if (!screenActive) { if (!locked.current) previewQueue.cancel(); return; }
    if (!sourceUri || busy || result) return;
    let current = true;
    const timer = setTimeout(() => {
      if (locked.current || !mounted.current) return;
      if (draftIssue) { setPreviewError(draftIssue); setPreviewStatus('Preview paused'); return; }
      const key = `${sourceUri}\n${page}\n${draftJson}`;
      if (renderedKey.current === key) { setPreviewError(''); setPreviewStatus('Live preview'); return; }
      setPreviewError(''); setPreviewStatus('Updating preview...');
      void previewQueue.render(sourceUri, page, draftJson).then(next => {
        if (!current || !mounted.current || locked.current || !next) return;
        publishLivePreview(next); renderedKey.current = key; setPreviewStatus('Live preview');
      }).catch(cause => {
        if (!current || !mounted.current) return;
        setPreviewError((cause as Error).message || 'Could not preview this change.');
        setPreviewStatus('Preview unavailable');
      });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [sourceUri, page, draftJson, draftIssue, draftRevision, busy, result, previewQueue, screenActive]);

  // Cancel immediately when input changes, before the next debounce. Foreground
  // actions cancel explicitly in begin(), so effect cleanup cannot cancel them.
  const invalidateDraft = useCallback(() => {
    previewQueue.cancel(); setDraftRevision(value => value + 1);
    setPreviewStatus('Updating preview...'); setPreviewError('');
  }, [previewQueue]);
  const removedIds = useMemo(() => edits.filter(edit => edit.page === page && edit.kind === 'delete').map(edit => edit.objectId!), [edits, page]);
  const previewObjects = preview?.objects;
  const objectsJson = useMemo(() => JSON.stringify((previewObjects ?? [])
    .filter(object => object.bounds && (object.id === selected?.id || !removedIds.includes(object.id)))
    .map(object => ({ id: object.id, ...object.bounds }))), [previewObjects, removedIds, selected?.id]);
  const focusBounds = selected?.bounds ?? (editingAddition !== null && placement ? { x: Math.max(0, placement.x - 0.02), y: Math.max(0, placement.y - 0.04), width: 0.35, height: 0.05 } : null);
  const focusJson = focusBounds ? JSON.stringify(focusBounds) : '';
  const placeText = useCallback((point: { x: number; y: number }) => {
    invalidateDraft(); setPlacement(point); setShowTextList(false); setShowOptions(false);
    if (editingAddition === null && !placement) { setTextStyle(current => current.family === 'original' ? DEFAULT_TEXT_STYLE : current); setText(''); setIndent(0); setInk(current => current ?? DEFAULT_INK); }
  }, [editingAddition, placement, invalidateDraft]);

  function changeIndent(next: number) {
    const value = Math.max(0, Math.min(INDENT_STEP * 20, next));
    invalidateDraft();
    if (!selected && placement) {
      const pageWidth = preview?.pointWidth || 612;
      setPlacement({ ...placement, x: Math.max(0, Math.min(1, placement.x + (value - indent) / pageWidth)) });
    }
    setIndent(value);
  }

  useInitialFiles(initialSelection, available, choose);

  async function choose(initialFiles?: LocalFile[]) {
    if (locked.current || !available) return;
    begin('Opening your PDF...');
    let picked: LocalFile | undefined;
    let accepted = false;
    try {
      [picked] = Array.isArray(initialFiles) ? initialFiles : await browseFiles(directory, false, 1, true);
      if (!picked || !mounted.current) return;
      // Opened from the reader: start on the page the user was looking at.
      const requested = Array.isArray(initialFiles) ? initialSelection?.initialPage ?? 0 : 0;
      let start = requested;
      let next = await loadPage(picked, start, []);
      if (next && start >= next.pageCount) { start = 0; next = await loadPage(picked, 0, []); }
      if (!next) return;
      if (source) { try { new File(source.uri).delete(); } catch { /* Session cleanup retries. */ } }
      setSource(picked); setPage(start); setPageInput(String(start + 1)); setFragmentPage(0); setEditingAddition(null); showPreview(next);
      setEdits([]); setHistory([]); setFuture([]); setSelected(null); setPlacement(null);
      setAdding(initialMode === 'add'); setName(`${picked.name.replace(/\.pdf$/i, '')} - edited`);
      accepted = true;
    } catch (cause) { fail(cause); }
    finally {
      if (picked && !accepted) try { new File(picked.uri).delete(); } catch { /* Session cleanup retries. */ }
      finish();
    }
  }
  async function navigate(target: number) {
    if (!source || !preview || locked.current) return;
    if (!Number.isInteger(target) || target < 0 || target >= preview.pageCount) { setError(`Enter a page from 1 to ${preview.pageCount}.`); return; }
    begin('Reading page...');
    try {
      const next = await loadPage(source, target, edits);
      if (next) { showPreview(next); setPage(target); setPageInput(String(target + 1)); setSelected(null); setPlacement(null); setFragmentPage(0); setEditingAddition(null); }
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  const select = useCallback((object: TextObject) => {
    if (locked.current) return;
    if (!object.editable) { setError('This text also clips page graphics and cannot be changed safely. You can still add text to this page.'); return; }
    invalidateDraft();
    const existing = edits.find(edit => edit.page === page && edit.objectId === object.id);
    setShowTextList(false); setShowOptions(false); setAdding(false); setPlacement(null); setEditingAddition(null); setSelected(object); setText(existing?.text ?? object.text); setTextStyle(styleFromFont(existing?.font, existing?.underline)); setSize(String(existing?.size ?? roundSize(object.size))); setIndent(existing?.indent ?? 0); setInk(existing?.color ?? null); setError('');
  }, [edits, page, invalidateDraft]);
  async function change(next: Edit[], step: 'edit' | 'undo' | 'redo' = 'edit') {
    if (!source || locked.current) return;
    begin('Updating preview...');
    try {
      const nextPreview = await loadPage(source, page, next);
      if (nextPreview) {
        showPreview(nextPreview);
        if (step === 'undo') { setHistory(current => current.slice(0, -1)); setFuture(current => [...current, edits].slice(-30)); }
        else if (step === 'redo') { setFuture(current => current.slice(0, -1)); setHistory(current => [...current, edits].slice(-30)); }
        else { setHistory(current => [...current, edits].slice(-30)); setFuture([]); }
        setEdits(next); setSelected(null); setPlacement(null); setEditingAddition(null); setText('');
      }
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  function apply(kind: 'replace' | 'delete' | 'add', value = text) {
    if (locked.current) return;
    if (kind !== 'delete' && !value.trim()) { setError('Enter some text.'); return; }
    if (kind === 'add' ? !placement : !selected) return;
    let command: Edit;
    if (kind === 'delete') command = { kind, page, objectId: selected!.id, original: selected!.text };
    else {
      const built = commandFor(page, kind === 'add' ? null : selected, placement, { text: value, style: textStyle, size, indent, color: ink });
      if (typeof built === 'string') { setError(built); return; }
      command = built;
    }
    const next = kind === 'add'
      ? editingAddition === null ? [...edits, command] : edits.map((edit, index) => index === editingAddition ? command : edit)
      : [...edits.filter(edit => !(edit.page === page && edit.objectId === selected?.id)), command];
    if (next.length > 500) { setError('Save these changes before adding more.'); return; }
    void change(next);
  }
  const origin = initialSelection?.origin ?? (source ? { uri: source.uri, name: source.name } : null);
  async function save(mode: SaveMode) {
    if (!source || !PdfEngine || locked.current || !edits.length) return;
    begin('Saving your PDF...'); setProgress(0);
    const id = newId(); job.current = id;
    const base = name.trim().replace(/\.pdf$/i, '').slice(0, 80) || 'Edited PDF';
    const filename = `${base.replace(/[^a-zA-Z0-9 _-]/g, '_')}-${id}.pdf`;
    try {
      await previewQueue.settle();
      if (!mounted.current) return;
      const outputUri = new File(savedPdfDirectory(), filename).uri;
      const output: PdfResult = JSON.parse(await PdfEngine.editPdfText(id, JSON.stringify({ action: 'save', uri: source.uri, outputUri, edits })));
      const saved = await saveEditedOutput({ output: output.uri, mimeType: 'application/pdf', kind: 'pdf', mode, origin, name: `${base}.pdf` });
      if (mounted.current) { setResult({ ...output, uri: saved.file.uri, name: saved.file.name, location: saved.device.location }); setSavedEdits(edits); }
      toast(`Saved to ${saved.device.location}`);
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  async function requestSave() {
    if (selected || placement) {
      showDialog('Text box still open', 'Apply or cancel this text box before saving the PDF.', undefined, { ios: 'character.textbox', android: 'text-fields' }); return;
    }
    const mode = await askSaveMode(origin?.name ?? 'this PDF', 'application/pdf');
    if (mode) void save(mode);
  }
  async function exportResult() {
    if (!result || locked.current) return;
    begin('Opening share menu...');
    try { await shareFile({ ...result, mimeType: 'application/pdf' }); }
    catch (cause) { fail(cause); }
    finally { finish(); }
  }

  if (result) return <ScrollView contentContainerStyle={styles.form}>
    <ThemedText style={styles.heading}>Your PDF is saved</ThemedText>
    <ThemedText>{result.name}</ThemedText>
    <ThemedText style={{ color: colors.secondaryLabel }}>Saved to {result.location}. You can also find it in Edited files on the home screen.</ThemedText>
    <ToolButton title="Open PDF" disabled={busy} onPress={() => result && openPdfScreen(result)} />
    <ToolButton title="Share" secondary disabled={busy} onPress={exportResult} />
    <ToolButton title="Return to edits" secondary disabled={busy} onPress={() => setResult(null)} />
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
  </ScrollView>;
  const inputStyle = [styles.input, { color: colors.label, backgroundColor: colors.accentSurface }];
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {source && preview ? <>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous page" disabled={busy || page === 0} onPress={() => navigate(page - 1)} style={styles.icon}><UniversalIcon ios="chevron.left" android="chevron-left" size={24} color={colors.systemBlue} /></Pressable>
        <TextInput accessibilityLabel="Page number" keyboardType="number-pad" value={pageInput} onChangeText={setPageInput} editable={!busy} onSubmitEditing={() => navigate(Number(pageInput) - 1)} onEndEditing={() => { if (Number(pageInput) !== page + 1) void navigate(Number(pageInput) - 1); }} style={[inputStyle, styles.pageNumber]} />
        <ThemedText>of {preview.pageCount}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel="Next page" disabled={busy || page >= preview.pageCount - 1} onPress={() => navigate(page + 1)} style={styles.icon}><UniversalIcon ios="chevron.right" android="chevron-right" size={24} color={colors.systemBlue} /></Pressable>
        <View style={styles.grow} />
        <Pressable accessibilityRole="button" accessibilityLabel={adding ? 'Select existing text' : 'Add text'} disabled={busy} onPress={() => { invalidateDraft(); setAdding(!adding); setSelected(null); setPlacement(null); setEditingAddition(null); setText(''); setIndent(0); setTextStyle(current => current.family === 'original' ? DEFAULT_TEXT_STYLE : current); setShowTextList(false); }} style={[styles.icon, { backgroundColor: adding ? colors.accentSurface : 'transparent' }]}><UniversalIcon ios="text.badge.plus" android="text-fields" size={24} color={colors.systemBlue} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="PDF options" disabled={busy} onPress={() => { setShowOptions(!showOptions); setShowTextList(false); }} style={styles.icon}><UniversalIcon ios="ellipsis" android="more-horiz" size={24} color={colors.systemBlue} /></Pressable>
      </View>
      {screenActive && NativeEditCanvas ? <NativeEditCanvas key={source.uri + ':' + page} style={styles.canvas} source={preview.imageUri}
        pageLayout={JSON.stringify({ width: preview.width, height: preview.height, pointWidth: preview.pointWidth ?? 0 })}
        objects={objectsJson} selectedId={selected?.id ?? -1} adding={adding} disabled={busy} placement={placement ? JSON.stringify(placement) : ''}
        textBox={JSON.stringify({ visible: nativeTextBox, text, font: textStyle.family === 'original' ? 'Helvetica' : fontName(textStyle), size: Number(size) || 16, color: ink ?? DEFAULT_INK, underline: textStyle.underline })}
        focus={focusJson}
        onSelectObject={({ nativeEvent }) => { const object = preview.objects.find(item => item.id === nativeEvent.id); if (object) select(object); }}
        onPlace={({ nativeEvent }) => placeText(nativeEvent)}
        onTextChange={({ nativeEvent }) => setText(nativeEvent.text)}
        onSubmitText={({ nativeEvent }) => { if (nativeEvent.text.trim()) apply('add', nativeEvent.text); }} />
      : screenActive ? <PdfEditCanvas key={source.uri + ':' + page} uri={preview.imageUri} width={preview.width} height={preview.height} objects={preview.objects} selectedId={selected?.id} adding={adding} disabled={busy} placement={placement}
        removedIds={removedIds} onSelect={select} onPlace={placeText} /> : <View style={styles.grow} />}
      <ThemedText numberOfLines={1} style={[styles.hint, { color: colors.secondaryLabel }]}>{nativeTextBox ? 'Type in the box on the page. Drag the blue handle to move it.' : adding ? 'Tap the page where the text should start. Pinch to zoom.' : 'Pinch to zoom. Tap text to edit.'}</ThemedText>
      {(selected || placement || showTextList || showOptions) && <ScrollView style={styles.dock} contentContainerStyle={styles.dockContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {(selected || placement) && <View style={[styles.editPanel, { backgroundColor: colors.secondarySystemBackground }]}>
          <View style={styles.row}><ThemedText style={[styles.label, styles.grow]}>{selected ? 'Selected text' : 'New text'}</ThemedText><ThemedText style={{ color: colors.secondaryLabel, fontSize: 12 }}>{previewStatus}</ThemedText></View>
          {!nativeTextBox && <TextInput accessibilityLabel="PDF text" value={text} onChangeText={value => { invalidateDraft(); setText(value); }} editable={!busy} maxLength={4000} multiline placeholder="Enter text. Return starts a new line." placeholderTextColor={colors.secondaryLabel} style={[inputStyle, styles.multiline]} />}
          {!!previewError && <View style={[styles.notice, { backgroundColor: colors.accentSurface }]}>
            <ThemedText accessibilityRole="alert" style={styles.grow}>{previewError}</ThemedText>
            <ToolButton title="Try again" secondary disabled={busy} onPress={invalidateDraft} />
          </View>}
          {!previewError && !!selected && !!preview.fontFallbacks && textStyle.family === 'original' && <ThemedText style={{ color: colors.secondaryLabel, fontSize: 12 }}>
            The original font is missing some of these characters, so the closest standard font is used for this text.
          </ThemedText>}
          <TextStyleControls style={textStyle} onChange={next => { invalidateDraft(); setTextStyle(next); }} size={size} onSizeChange={value => { invalidateDraft(); setSize(value); }}
            sizeUnit="pt" minSize={4} maxSize={200} allowOriginal={!!selected} disabled={busy} indent={indent} indentStep={INDENT_STEP} onIndentChange={changeIndent} />
          <ColorSwatches value={ink} disabled={busy} original={selected ? { label: 'Original', value: null } : undefined} onChange={value => { invalidateDraft(); setInk(value ?? (selected ? null : DEFAULT_INK)); }} />
          {selected && <ThemedText style={{ color: colors.secondaryLabel }}>Replacement keeps the text position. Longer text does not reflow the document. New lines go below this one. If the original font is missing characters, choose Arial.</ThemedText>}
          <ToolButton title={selected || editingAddition !== null ? 'Apply text change' : 'Add text'} disabled={busy || !text.trim()} onPress={() => apply(selected ? 'replace' : 'add')} />
          {selected && <ToolButton title="Delete selected text" secondary disabled={busy} onPress={() => apply('delete')} />}
          {editingAddition !== null && <ToolButton title="Remove added text" secondary disabled={busy} onPress={() => change(edits.filter((_, index) => index !== editingAddition))} />}
          <ToolButton title="Cancel selection" secondary disabled={busy} onPress={() => { invalidateDraft(); setSelected(null); setPlacement(null); setEditingAddition(null); }} />
        </View>}
        {showTextList && !selected && !placement && <View style={styles.editPanel}>
          <ThemedText style={styles.label}>Text on this page</ThemedText>
          <ThemedText style={{ color: colors.secondaryLabel }}>PDFs may store a sentence as several separate fragments.</ThemedText>
          <ScrollView style={styles.textList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {preview.objects.slice(fragmentPage * 50, fragmentPage * 50 + 50).map(object => <Pressable key={object.id} accessibilityRole="button" accessibilityLabel={`Select ${object.text}`} disabled={busy} onPress={() => select(object)} style={[styles.textRow, { borderColor: colors.separator }]}><ThemedText numberOfLines={2}>{edits.find(edit => edit.page === page && edit.objectId === object.id)?.kind === 'delete' ? '[Removed] ' : ''}{edits.find(edit => edit.page === page && edit.objectId === object.id && edit.kind === 'replace')?.text ?? object.text}</ThemedText></Pressable>)}
          </ScrollView>
          {preview.objects.length > 50 && <><ThemedText>Text {fragmentPage * 50 + 1}–{Math.min(fragmentPage * 50 + 50, preview.objects.length)} of {preview.objects.length}</ThemedText><View style={styles.row}><View style={styles.grow}><ToolButton title="Earlier text" secondary disabled={busy || fragmentPage === 0} onPress={() => setFragmentPage(current => current - 1)} /></View><View style={styles.grow}><ToolButton title="More text" secondary disabled={busy || (fragmentPage + 1) * 50 >= preview.objects.length} onPress={() => setFragmentPage(current => current + 1)} /></View></View></>}
        </View>}
        {showTextList && edits.some(edit => edit.kind === 'add' && edit.page === page) && <View style={styles.editPanel}><ThemedText style={styles.label}>Text you added</ThemedText>{edits.map((edit, index) => edit.kind === 'add' && edit.page === page && <Pressable key={index} accessibilityRole="button" accessibilityLabel={`Edit added text: ${edit.text}`} disabled={busy} style={[styles.textRow, { borderColor: colors.separator }]} onPress={() => { invalidateDraft(); setAdding(true); setSelected(null); setEditingAddition(index); setPlacement({ x: edit.x ?? 0, y: edit.y ?? 0 }); setText(edit.text ?? ''); setSize(String(edit.size ?? 16)); setTextStyle(styleFromFont(edit.font ?? 'Helvetica', edit.underline)); setIndent(0); setInk(edit.color ?? 0x101020); }}><ThemedText numberOfLines={2}>{edit.text}</ThemedText></Pressable>)}</View>}

        {showOptions && <View style={styles.editPanel}>
          <ThemedText numberOfLines={2}>{source.name}</ThemedText>
          <ThemedText style={styles.label}>New PDF name</ThemedText>
          <TextInput accessibilityLabel="New PDF name" value={name} onChangeText={setName} editable={!busy} maxLength={100} style={inputStyle} />
          <ToolButton title="Choose another PDF" secondary disabled={busy} onPress={() => {
            if (edits.length) showDialog('Choose another PDF?', 'Your unsaved changes will be discarded.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { void choose(); } }]);
            else void choose();
          }} />
          <ThemedText style={{ color: colors.secondaryLabel }}>Scans and text inside embedded groups cannot be edited. Delete removes page text; it is not secure redaction.</ThemedText>
        </View>}
      </ScrollView>}
    </> : <View style={styles.empty}>
      {busy ? <AppLoader size="large" /> : <>
        <ThemedText>{available ? 'Choose a PDF to start editing.' : 'Install a new development build to use the native editor.'}</ThemedText>
        <ToolButton title="Choose PDF" disabled={!available} onPress={() => choose()} />
      </>}
    </View>}
    <View style={[styles.footer, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy ? <View style={styles.row}><AppLoader /><ThemedText style={styles.grow} accessibilityLiveRegion="polite">{phase}{progress !== null ? ' ' + Math.round(progress * 100) + '%' : ''}</ThemedText><ToolButton title="Cancel" secondary onPress={() => { previewQueue.cancel(); if (job.current) PdfEngine?.cancelTextEdit(job.current); }} /></View> : source && <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Undo" disabled={!history.length} onPress={() => change(history[history.length - 1], 'undo')} style={[styles.icon, !history.length && styles.dim]}><UniversalIcon ios="arrow.uturn.backward" android="undo" size={22} color={colors.systemBlue} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Redo" disabled={!future.length} onPress={() => change(future[future.length - 1], 'redo')} style={[styles.icon, !future.length && styles.dim]}><UniversalIcon ios="arrow.uturn.forward" android="redo" size={22} color={colors.systemBlue} /></Pressable>
        <ToolButton title="Text list" secondary onPress={() => { invalidateDraft(); setShowTextList(!showTextList); setShowOptions(false); setSelected(null); setPlacement(null); setAdding(false); }} />
        <View style={styles.grow}><ToolButton title={'Save (' + edits.length + ')'} disabled={!edits.length} onPress={requestSave} /></View>
      </View>}
    </View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, canvas: { flex: 1, minHeight: 120 }, form: { padding: s.lg, gap: s.md }, heading: { ...t.heading }, label: { ...t.label },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.sm }, grow: { flex: 1, minWidth: 0 },
  input: { minHeight: 48, padding: s.md, borderRadius: radius.sm, ...t.body }, pageNumber: { width: 54, textAlign: 'center', paddingHorizontal: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }, icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  dock: { maxHeight: '44%', flexGrow: 0 }, dockContent: { gap: 8 }, hint: { fontSize: 12, textAlign: 'center', paddingVertical: 4 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16 },
  placement: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#1565ff', transform: [{ translateX: -7 }, { translateY: -7 }] },
  editPanel: { gap: s.md, padding: s.md, borderRadius: radius.md }, textList: { maxHeight: 180 }, textRow: { paddingVertical: s.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  footer: { padding: s.sm, gap: s.sm, borderTopWidth: StyleSheet.hairlineWidth },
  multiline: { maxHeight: 140, textAlignVertical: 'top' }, notice: { flexDirection: 'row', alignItems: 'center', gap: s.sm, padding: s.sm, borderRadius: radius.sm }, dim: { opacity: 0.35 },
});

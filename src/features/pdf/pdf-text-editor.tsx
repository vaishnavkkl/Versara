import { useResponsiveEditorToolbar, responsiveToolbarStyles } from '../editor/responsive-editor-toolbar';
import { retainPdfEditingSource } from './pdf-tool-session';
import { useEditorDraft } from '../editor/use-editor-draft';
import { pdfDraftId } from '../editor/editor-drafts';
import { askSaveOptions, saveEditedOutput, type SaveMode } from '../files/save-file';
import { toast } from '@/components/toast';
import { showDialog } from '@/components/app-dialog';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { ColorSwatches } from '@/components/color-swatches';
import { DEFAULT_TEXT_STYLE, fontName, styleFromFont, TextStyleControls, TextStyleMenu, type TextStyle } from '@/components/text-style-controls';
import { PdfEditCanvas, type PdfTextObject } from './pdf-edit-canvas';
import NativeEditCanvas from '../../../modules/pdf-engine/src/PdfEditCanvasView';
import { useInitialFiles } from './use-initial-files';
import type { InitialSelection } from './pdf-tool-session';
import { UniversalIcon } from '@/components/universal-icon';
import { File } from 'expo-file-system';
import { PdfEngine, type PdfResult } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { EditorOption } from '@/components/editor-option';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { browseFiles, createImportDirectory, disposeImports, savedPdfDirectory, shareFile, type LocalFile } from '../files/file-storage';
import { openPdfResult } from './open-pdf-screen';
import { PdfPreviewQueue, type PagePreview } from './pdf-preview-queue';
import { usePdfScreenActive } from './use-pdf-screen-active';
import { PdfPreviewToolbar, PdfPreviewStage } from './pdf-preview';
import { PublishHeaderHistory } from '@/components/header-history';
import { usePdfToolLayout } from './pdf-tool-layout';

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
type TextRecovery = { edits: Edit[]; history: Edit[][]; future: Edit[][]; page: number };
function validTextRecovery(value: unknown): value is TextRecovery {
  if (!value || typeof value !== 'object') return false;
  const draft = value as TextRecovery;
  const changes = (list: unknown): list is Edit[] => Array.isArray(list) && list.length <= 500 && list.every(item => item && ['replace','delete','add'].includes(item.kind) && Number.isInteger(item.page) && item.page >= 0 && (item.text === undefined || typeof item.text === 'string' && item.text.length <= 10000));
  return Number.isInteger(draft.page) && draft.page >= 0 && changes(draft.edits) && [draft.history,draft.future].every(list => Array.isArray(list) && list.length <= 30 && list.every(changes));
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
export function PdfTextEditor({ initialMode = 'edit', initialSelection, onUnsavedChange, onDiscardReady }: { initialMode?: 'edit' | 'add' | 'delete'; initialSelection?: InitialSelection; onUnsavedChange?: (unsaved: boolean) => void; onDiscardReady?: (action: () => Promise<void>) => void }) {
  const colors = usePalette();
  const landscape = usePdfToolLayout()?.landscape ?? false;
  const screenActive = usePdfScreenActive();
  const available = !!PdfEngine?.editPdfText;
  const [directory] = useState(() => initialSelection?.directory ?? createImportDirectory());
  const [previewQueue] = useState(() => new PdfPreviewQueue(directory));
  const [source, setSource] = useState<LocalFile | null>(null);
  const [sourceOrigin, setSourceOrigin] = useState(initialSelection?.origin);
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [savedEdits, setSavedEdits] = useState<Edit[] | null>(null);
  const [history, setHistory] = useState<Edit[][]>([]);
  const [selected, setSelected] = useState<TextObject | null>(null);
  const [fragmentPage, setFragmentPage] = useState(0);
  const [editingAddition, setEditingAddition] = useState<number | null>(null);
  const [placement, setPlacement] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(initialMode === 'add');
  const [marked, setMarked] = useState<number[]>([]);
  const multiDelete = initialMode === 'delete' && !adding;
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
  const [showFormatting, setShowFormatting] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const toolbar = useResponsiveEditorToolbar([44, 44], ['Text list', 'Save (' + edits.length + ')'], 2);
  const mounted = useRef(true);
  const locked = useRef(false);
  const job = useRef<string | null>(null);
  const obsoleteImages = useRef<{ uri: string; expires: number }[]>([]);
  const displayedPreview = useRef<PagePreview | null>(null);
  const liveSession = useRef({ active: false });

  useEffect(() => {
    mounted.current = true;
    const subscription = available ? PdfEngine?.addListener('onConversionProgress', event => {
      if (mounted.current && event.jobId === job.current) setProgress(event.completed / event.total);
    }) : undefined;
    return () => {
      mounted.current = false; subscription?.remove();
      queueMicrotask(() => {
        if (mounted.current) return;
        previewQueue.release();
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
    // Keep the last image until its replacement has reached the native image view.
    if (displayedPreview.current?.imageUri === next.imageUri) return;
    if (displayedPreview.current) obsoleteImages.current.push({ uri: displayedPreview.current.imageUri, expires: Date.now() + 1000 });
    displayedPreview.current = next;
    setPreview(next);
  }
  useEffect(() => {
    if (!screenActive || result) return;
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
  }, [screenActive, result]);

  // Drafts use the same commands as Apply/Save. PDF pixels and text changes still
  // come from the native engine; JS only schedules work and displays its image.
  const nativeTextBox = !!NativeEditCanvas && adding && !!placement && !selected;
  const draft = makeDraft(edits, page, selected, placement, editingAddition, { text, style: textStyle, size, indent, color: ink }, nativeTextBox);
  const draftJson = JSON.stringify(draft.changes.filter(edit => edit.page === page));
  const draftIssue = draft.error;
  const unsaved = (edits.length > 0 && edits !== savedEdits) || draft.changes !== edits || (!!placement && !!text.trim());
  useEffect(() => { onUnsavedChange?.(unsaved); }, [unsaved, onUnsavedChange]);
  const recoveryOrigin = sourceOrigin?.uri;
  const recovery = useEditorDraft({ id: recoveryOrigin ? pdfDraftId(recoveryOrigin, 'text') : null, uri: source ? recoveryOrigin : undefined,
    value: { edits: makeDraft(edits, page, selected, placement, editingAddition, { text, style: textStyle, size, indent, color: ink }).changes, history, future, page }, dirty: unsaved,
    validate: validTextRecovery, restore: value => { setEdits(value.edits); setHistory(value.history); setFuture(value.future); setPage(Math.min(value.page, Math.max(0, (preview?.pageCount ?? 1) - 1))); } });
  useEffect(() => { onDiscardReady?.(recovery.discard); }, [onDiscardReady, recovery.discard]);
  const sourceUri = source?.uri;
  const publishLivePreview = useEffectEvent((next: PagePreview, key: string) => {
    showPreview(next);
    setPreviewError('');
    setPreviewStatus(key === `${sourceUri}\n${page}\n${draftJson}` ? 'Live preview' : 'Updating preview...');
  });
  // Change the session only when the editing context changes, not on every key.
  // Foreground actions cancel in begin(); cleanup must never cancel their render.
  useEffect(() => {
    const session = { active: true };
    liveSession.current = session;
    if (!locked.current) {
      if (!screenActive || result) previewQueue.release();
      else previewQueue.cancel();
    }
    return () => { session.active = false; };
  }, [sourceUri, page, selected?.id, editingAddition, adding, busy, result, screenActive, previewQueue]);
  useEffect(() => {
    if (!screenActive || !sourceUri || busy || !recovery.ready || result || locked.current) return;
    if (draftIssue) { previewQueue.cancel(); return; }
    const session = liveSession.current;
    const key = `${sourceUri}\n${page}\n${draftJson}`;
    // Still enqueue an unchanged draft: an older in-flight render may need to be
    // followed by this frame when the user types, then immediately deletes.
    void previewQueue.render(sourceUri, page, draftJson).then(next => {
      if (!next) return;
      if (!session.active || !mounted.current || locked.current) {
        if (displayedPreview.current?.imageUri !== next.imageUri) previewQueue.discard(next);
        return;
      }
      publishLivePreview(next, key);
    }).catch(cause => {
      if (!session.active || !mounted.current) return;
      setPreviewError((cause as Error).message || 'Could not preview this change.');
      setPreviewStatus('Preview unavailable');
    });
  }, [sourceUri, page, draftJson, draftIssue, draftRevision, selected?.id, editingAddition, adding, busy, result, previewQueue, screenActive, recovery.ready]);

  // Keep the running render; the queue replaces only the waiting draft.
  const invalidateDraft = useCallback(() => {
    setDraftRevision(value => value + 1);
    setPreviewStatus('Updating preview...'); setPreviewError('');
  }, []);
  const removedIds = useMemo(() => edits.filter(edit => edit.page === page && edit.kind === 'delete').map(edit => edit.objectId!), [edits, page]);
  const previewObjects = preview?.objects;
  const objectsJson = useMemo(() => JSON.stringify((previewObjects ?? [])
    .filter(object => object.bounds && (object.id === selected?.id || !removedIds.includes(object.id)))
    .map(object => ({ id: object.id, ...object.bounds }))), [previewObjects, removedIds, selected?.id]);
  const focusBounds = selected?.bounds ?? (placement ? { x: Math.max(0, placement.x - 0.02), y: Math.max(0, placement.y - 0.04), width: 0.35, height: 0.05 } : null);
  const focusJson = focusBounds ? JSON.stringify(focusBounds) : '';
  const placeText = useCallback((point: { x: number; y: number }) => {
    invalidateDraft(); setShowFormatting(false); setPlacement(point); setShowTextList(false); setShowOptions(false);
    if (editingAddition === null && !placement) {
      const nearest = (previewObjects ?? []).filter(object => object.bounds && object.text.trim()).reduce<TextObject | undefined>((best, object) => {
        const distance = (item: TextObject) => Math.hypot(point.x - item.bounds!.x, point.y - item.bounds!.y);
        return !best || distance(object) < distance(best) ? object : best;
      }, undefined);
      setTextStyle(nearest?.font ? styleFromFont(nearest.font) : DEFAULT_TEXT_STYLE);
      setSize(String(nearest ? Math.max(4, Math.min(200, roundSize(nearest.size))) : 16));
      setText(''); setIndent(0); setInk(nearest?.color ?? DEFAULT_INK);
    }
  }, [editingAddition, placement, invalidateDraft, previewObjects]);

  function changeIndent(next: number) {
    const value = Math.max(0, Math.min(INDENT_STEP * 20, next));
    invalidateDraft();
    if (!selected && placement) {
      const pageWidth = preview?.pointWidth || 612;
      setPlacement({ ...placement, x: Math.max(0, Math.min(1, placement.x + (value - indent) / pageWidth)) });
    }
    setIndent(value);
  }

  useInitialFiles(initialSelection, available && screenActive, choose);

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
      const origin = Array.isArray(initialFiles) && initialSelection?.origin ? initialSelection.origin : await retainPdfEditingSource(picked);
      if (!mounted.current) return;
      if (source) await recovery.discard();
      setSourceOrigin(origin);
      if (source) { try { new File(source.uri).delete(); } catch { /* Session cleanup retries. */ } }
      setSource(picked); setPage(start); setFragmentPage(0); setEditingAddition(null); showPreview(next);
      setEdits([]); setHistory([]); setFuture([]); setSelected(null); setPlacement(null); setMarked([]);
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
      if (next) { showPreview(next); setPage(target); setSelected(null); setPlacement(null); setMarked([]); setFragmentPage(0); setEditingAddition(null); }
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  const select = useCallback((object: TextObject) => {
    if (locked.current) return;
    if (!object.editable) { setError('This text also clips page graphics and cannot be changed safely. You can still add text to this page.'); return; }
    if (multiDelete) {
      setError('');
      setMarked(current => current.includes(object.id) ? current.filter(id => id !== object.id) : [...current, object.id]);
      return;
    }
    invalidateDraft();
    const existing = edits.find(edit => edit.page === page && edit.objectId === object.id);
    setShowFormatting(false); setShowTextList(false); setShowOptions(false); setAdding(false); setPlacement(null); setEditingAddition(null); setSelected(object); setText(existing?.text ?? object.text); setTextStyle(styleFromFont(existing?.font, existing?.underline)); setSize(String(existing?.size ?? roundSize(object.size))); setIndent(existing?.indent ?? 0); setInk(existing?.color ?? null); setError('');
  }, [edits, page, invalidateDraft, multiDelete]);
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
        setEdits(next); setSelected(null); setPlacement(null); setEditingAddition(null); setText(''); setMarked([]);
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
  const selectable = (preview?.objects ?? []).filter(object => object.editable && object.bounds && !removedIds.includes(object.id));
  function deleteMarked() {
    if (locked.current || !marked.length) return;
    const ids = new Set(marked);
    const commands: Edit[] = selectable.filter(object => ids.has(object.id)).map(object => ({ kind: 'delete', page, objectId: object.id, original: object.text }));
    const next = [...edits.filter(edit => !(edit.page === page && edit.objectId !== undefined && ids.has(edit.objectId))), ...commands];
    if (next.length > 500) { setError('Save these changes before deleting more.'); return; }
    void change(next);
  }
  const origin = sourceOrigin ?? (source ? { uri: source.uri, name: source.name } : null);
  async function save(mode: SaveMode, chosenName: string) {
    if (!source || !PdfEngine || locked.current || !edits.length) return;
    begin('Saving your PDF...'); setProgress(0);
    const id = newId(); job.current = id;
    const base = chosenName.trim().replace(/\.pdf$/i, '').slice(0, 100) || 'Edited PDF';
    const filename = `${base.replace(/[^a-zA-Z0-9 _-]/g, '_')}-${id}.pdf`;
    try {
      await previewQueue.settle();
      if (!mounted.current) return;
      const outputUri = new File(savedPdfDirectory(), filename).uri;
      const output: PdfResult = JSON.parse(await PdfEngine.editPdfText(id, JSON.stringify({ action: 'save', uri: source.uri, outputUri, edits })));
      const saved = await saveEditedOutput({ output: output.uri, mimeType: 'application/pdf', kind: 'pdf', mode, origin, name: `${base}.pdf` });
      await recovery.clear();
      if (mounted.current) { setResult({ ...output, uri: saved.file.uri, name: saved.file.name, location: saved.device.location }); setSavedEdits(edits); }
      toast(`Saved to ${saved.device.location}`);
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  async function requestSave() {
    if (!recovery.ready) return;
    if (selected || placement) {
      showDialog('Text box still open', 'Apply or cancel this text box before saving the PDF.', undefined, { ios: 'character.textbox', android: 'text-fields' }); return;
    }
    if (locked.current || !mounted.current) return;
    const options = await askSaveOptions(origin?.name ?? 'this PDF', 'application/pdf', `${name.replace(/\.pdf$/i, '')}.pdf`);
    if (options && mounted.current) void save(options.mode, options.name);
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
    <ToolButton title="Open PDF" disabled={busy} onPress={() => result && openPdfResult(result, initialSelection?.returnRoute)} />
    <ToolButton title="Share" secondary disabled={busy} onPress={exportResult} />
    <ToolButton title="Return to edits" secondary disabled={busy} onPress={() => setResult(null)} />
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
  </ScrollView>;
  const toolActions = <View style={responsiveToolbarStyles.tools}>
        <EditorOption compact label="Options" selected={showOptions} disabled={busy} icon={{ ios: 'slider.horizontal.3', android: 'tune' }} onPress={() => { setShowOptions(!showOptions); setShowTextList(false); }} />
  </View>;
  const inputStyle = [styles.input, { color: colors.label, backgroundColor: colors.accentSurface }];
  return <KeyboardAvoidingView style={[styles.screen, landscape && styles.landscapeRow]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <PublishHeaderHistory active={!!source && !result} canUndo={history.length > 0 && !busy} canRedo={future.length > 0 && !busy} onUndo={() => change(history[history.length - 1], 'undo')} onRedo={() => change(future[future.length - 1], 'redo')} />
    {toolbar.measurements}
    {source && preview ? <View style={styles.grow}>
      <PdfPreviewToolbar page={page + 1} count={preview.pageCount} disabled={busy} onPageChange={target => void navigate(target - 1)}>
        {(keyboardOpen || !toolbar.atBottom) && toolActions}
      </PdfPreviewToolbar>
      <PdfPreviewStage actions={(selected || placement) && <TextStyleMenu style={textStyle} onChange={next => { invalidateDraft(); setTextStyle(next); }} disabled={busy} allowOriginal={!!selected} />} status={draftIssue ? 'Preview paused' : previewStatus} hint={nativeTextBox ? 'Type on the page. Drag the blue handle to move text.' : adding ? 'Tap to place text. Pinch to zoom.' : multiDelete ? 'Tap text boxes to select them, then delete them together.' : 'Pinch to zoom. Tap text to edit.'}>
      {screenActive && NativeEditCanvas ? <NativeEditCanvas key={source.uri + ':' + page} style={styles.canvas} source={preview.imageUri}
        pageLayout={JSON.stringify({ width: preview.width, height: preview.height, pointWidth: preview.pointWidth ?? 0 })}
        objects={objectsJson} selectedId={selected?.id ?? -1} markedIds={marked.join(',')} adding={adding} disabled={busy} placement={placement ? JSON.stringify(placement) : ''}
        textBox={JSON.stringify({ visible: nativeTextBox, submitOnReturn: true, text, font: textStyle.family === 'original' ? 'Helvetica' : fontName(textStyle), size: Number(size) || 16, color: ink ?? DEFAULT_INK, underline: textStyle.underline })}
        focus={focusJson}
        onSelectObject={({ nativeEvent }) => { const object = preview.objects.find(item => item.id === nativeEvent.id); if (object) select(object); }}
        onPlace={({ nativeEvent }) => placeText(nativeEvent)}
        onTextChange={({ nativeEvent }) => setText(nativeEvent.text)}
        onSubmitText={({ nativeEvent }) => { if (nativeEvent.text.trim()) apply('add', nativeEvent.text); }} />
      : screenActive ? <PdfEditCanvas key={source.uri + ':' + page} uri={preview.imageUri} width={preview.width} height={preview.height} objects={preview.objects} selectedId={selected?.id} markedIds={marked} adding={adding} disabled={busy} placement={placement}
        removedIds={removedIds} onSelect={select} onPlace={placeText} /> : <View style={styles.grow} />}
      </PdfPreviewStage>
      {multiDelete && !selected && !placement && <View style={[styles.row, styles.editorBar, { backgroundColor: colors.secondarySystemBackground }]}>
        <ThemedText style={[styles.grow, styles.markCount]} numberOfLines={1} accessibilityLiveRegion="polite">{marked.length ? `${marked.length} selected` : 'Tap text to select'}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel="Select all text on this page" disabled={busy || !selectable.length || marked.length === selectable.length} style={[styles.icon, (!selectable.length || marked.length === selectable.length) && styles.dim]} onPress={() => setMarked(selectable.map(object => object.id))}><UniversalIcon ios="checklist" android="select-all" size={22} color={colors.systemBlue} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Clear selection" disabled={busy || !marked.length} style={[styles.icon, !marked.length && styles.dim]} onPress={() => setMarked([])}><UniversalIcon ios="xmark" android="close" size={20} color={colors.secondaryLabel} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${marked.length} selected text boxes`} disabled={busy || !marked.length} style={[styles.deleteButton, { backgroundColor: colors.destructive }, !marked.length && styles.dim]} onPress={deleteMarked}>
          <UniversalIcon ios="trash" android="delete-outline" size={18} color="#fff" />
          <ThemedText style={styles.deleteLabel}>Delete{marked.length ? ` (${marked.length})` : ''}</ThemedText>
        </Pressable>
      </View>}
      {(selected || placement) && <View style={[styles.row, styles.editorBar, { backgroundColor: colors.secondarySystemBackground }]}>
        {!nativeTextBox && <TextInput accessibilityLabel="PDF text" onFocus={() => { setShowFormatting(false); setShowTextList(false); setShowOptions(false); }} value={text} onChangeText={value => { invalidateDraft(); setText(value); }} editable={!busy} maxLength={4000} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => { if (text.trim()) apply(selected ? 'replace' : 'add'); }} placeholder="Edit text on the page" style={[inputStyle, styles.grow]} />}
        {nativeTextBox && <ThemedText style={styles.grow} numberOfLines={1}>Editing on the page</ThemedText>}
        <Pressable accessibilityRole="button" accessibilityLabel="Text formatting" accessibilityState={{ expanded: showFormatting }} style={styles.icon} onPress={() => { Keyboard.dismiss(); setShowFormatting(value => !value); }}><UniversalIcon ios="textformat" android="text-format" size={24} color={colors.systemBlue} /></Pressable>
        {selected && <Pressable accessibilityRole="button" accessibilityLabel="Delete selected text" disabled={busy} style={styles.icon} onPress={() => apply('delete')}><UniversalIcon ios="trash" android="delete-outline" size={22} color={colors.destructive} /></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Apply text" disabled={busy || !text.trim()} style={styles.icon} onPress={() => apply(selected ? 'replace' : 'add')}><UniversalIcon ios="checkmark" android="check" size={24} color={colors.systemBlue} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel selection" style={styles.icon} onPress={() => { Keyboard.dismiss(); invalidateDraft(); setSelected(null); setPlacement(null); setEditingAddition(null); }}><UniversalIcon ios="xmark" android="close" size={20} color={colors.secondaryLabel} /></Pressable>
      </View>}
      {!!(draftIssue || previewError || recovery.error) && <ThemedText accessibilityRole="alert" style={styles.hint}>{draftIssue || previewError || recovery.error}</ThemedText>}
      {(((selected || placement) && showFormatting) || showTextList || showOptions) && <ScrollView style={styles.dock} contentContainerStyle={styles.dockContent} keyboardShouldPersistTaps="handled">
        {(selected || placement) && showFormatting && <View style={[styles.editPanel, { backgroundColor: colors.secondarySystemBackground }]}>
          <ThemedText style={styles.label}>Text style</ThemedText>
          <TextStyleControls style={textStyle} onChange={next => { invalidateDraft(); setTextStyle(next); }} size={size} onSizeChange={value => { invalidateDraft(); setSize(value); }} sizeUnit="pt" minSize={4} maxSize={200} allowOriginal={!!selected} disabled={busy} indent={indent} indentStep={INDENT_STEP} onIndentChange={changeIndent} />
          <ColorSwatches value={ink} disabled={busy} original={selected ? { label: 'Original', value: null } : undefined} onChange={value => { invalidateDraft(); setInk(value ?? (selected ? null : DEFAULT_INK)); }} />
          {!!preview.fontFallbacks && textStyle.family === 'original' && <ThemedText>The closest standard font is used for characters missing from the original font.</ThemedText>}
          {editingAddition !== null && <ToolButton title="Remove added text" secondary disabled={busy} onPress={() => change(edits.filter((_, index) => index !== editingAddition))} />}
        </View>}
        {showTextList && !selected && !placement && <View style={styles.editPanel}>
          <ThemedText style={styles.label}>Text on this page</ThemedText>
          <ThemedText style={{ color: colors.secondaryLabel }}>PDFs may store a sentence as several separate fragments.</ThemedText>
          <ScrollView style={styles.textList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {preview.objects.slice(fragmentPage * 50, fragmentPage * 50 + 50).map(object => <Pressable key={object.id} accessibilityRole="button" accessibilityLabel={`Select ${object.text}`} disabled={busy} onPress={() => select(object)} accessibilityState={{ selected: marked.includes(object.id) }} style={[styles.textRow, { borderColor: colors.separator }, marked.includes(object.id) && styles.markedRow]}><ThemedText numberOfLines={2}>{marked.includes(object.id) ? '✓ ' : ''}{edits.find(edit => edit.page === page && edit.objectId === object.id)?.kind === 'delete' ? '[Removed] ' : ''}{edits.find(edit => edit.page === page && edit.objectId === object.id && edit.kind === 'replace')?.text ?? object.text}</ThemedText></Pressable>)}
          </ScrollView>
          {preview.objects.length > 50 && <><ThemedText>Text {fragmentPage * 50 + 1}–{Math.min(fragmentPage * 50 + 50, preview.objects.length)} of {preview.objects.length}</ThemedText><View style={styles.row}><View style={styles.grow}><ToolButton title="Earlier text" secondary disabled={busy || fragmentPage === 0} onPress={() => setFragmentPage(current => current - 1)} /></View><View style={styles.grow}><ToolButton title="More text" secondary disabled={busy || (fragmentPage + 1) * 50 >= preview.objects.length} onPress={() => setFragmentPage(current => current + 1)} /></View></View></>}
        </View>}
        {showTextList && edits.some(edit => edit.kind === 'add' && edit.page === page) && <View style={styles.editPanel}><ThemedText style={styles.label}>Text you added</ThemedText>{edits.map((edit, index) => edit.kind === 'add' && edit.page === page && <Pressable key={index} accessibilityRole="button" accessibilityLabel={`Edit added text: ${edit.text}`} disabled={busy} style={[styles.textRow, { borderColor: colors.separator }]} onPress={() => { invalidateDraft(); setAdding(true); setSelected(null); setEditingAddition(index); setPlacement({ x: edit.x ?? 0, y: edit.y ?? 0 }); setText(edit.text ?? ''); setSize(String(edit.size ?? 16)); setTextStyle(styleFromFont(edit.font ?? 'Helvetica', edit.underline)); setIndent(0); setInk(edit.color ?? 0x101020); }}><ThemedText numberOfLines={2}>{edit.text}</ThemedText></Pressable>)}</View>}

        {showOptions && <View style={styles.editPanel}>
          <ThemedText numberOfLines={2}>{source.name}</ThemedText>
          <ThemedText style={styles.label}>New PDF name</ThemedText>
          <TextInput accessibilityLabel="New PDF name" value={name} onChangeText={setName} editable={!busy} maxLength={100} style={inputStyle} />
          <ToolButton title="Choose another PDF" secondary disabled={busy} onPress={() => {
            if (unsaved) showDialog('Choose another PDF?', 'Your unsaved changes will be discarded.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { void choose(); } }]);
            else void choose();
          }} />
          <ThemedText style={{ color: colors.secondaryLabel }}>Scans and text inside embedded groups cannot be edited. Delete removes page text; it is not secure redaction.</ThemedText>
        </View>}
      </ScrollView>}
    </View> : <View style={styles.empty}>
      {busy ? <AppLoader size="large" /> : <>
        <ThemedText>{available ? 'Choose a PDF to start editing.' : 'Install a new development build to use the native editor.'}</ThemedText>
        <ToolButton title="Choose PDF" disabled={!available} onPress={() => choose()} />
      </>}
    </View>}
    {!keyboardOpen && <View style={[styles.footer, landscape && styles.landscapeSide, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy ? <View style={styles.row}><AppLoader /><ThemedText style={styles.grow} accessibilityLiveRegion="polite">{phase}{progress !== null ? ' ' + Math.round(progress * 100) + '%' : ''}</ThemedText><ToolButton title="Cancel" secondary onPress={() => { previewQueue.cancel(); if (job.current) PdfEngine?.cancelTextEdit(job.current); }} /></View> : source && <View onLayout={toolbar.onBottomLayout} style={responsiveToolbarStyles.row}>
        {toolbar.atBottom && toolActions}
        <EditorOption compact label={adding ? 'Select text' : 'Add text'} selected={adding} disabled={busy} icon={{ ios: adding ? 'cursorarrow' : 'text.badge.plus', android: adding ? 'touch-app' : 'text-fields' }} onPress={() => { invalidateDraft(); setAdding(!adding); setSelected(null); setPlacement(null); setEditingAddition(null); setText(''); setIndent(0); setTextStyle(current => current.family === 'original' ? DEFAULT_TEXT_STYLE : current); setShowTextList(false); }} />
        <ToolButton title="Text list" secondary onPress={() => { invalidateDraft(); setShowTextList(!showTextList); setShowOptions(false); setSelected(null); setPlacement(null); setAdding(false); }} />
        <View style={[responsiveToolbarStyles.primary, { minWidth: toolbar.primaryMinWidth }]}><ToolButton title={'Save (' + edits.length + ')'} disabled={!edits.length || !recovery.ready} onPress={requestSave} /></View>
      </View>}
    </View>}
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  markedRow: { backgroundColor: '#ff5a5f40', borderRadius: 8, paddingHorizontal: 8 },
  editorBar: { padding: 4, gap: 0 }, markCount: { paddingHorizontal: s.sm, fontWeight: '600' },
  deleteButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 12, marginLeft: 4 }, deleteLabel: { color: '#fff', fontWeight: '600' }, screen: { flex: 1 }, canvas: { flex: 1, minHeight: 120 }, form: { padding: s.lg, gap: s.md }, heading: { ...t.heading }, label: { ...t.label },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.sm }, grow: { flex: 1, minWidth: 0 },
  input: { minHeight: 48, padding: s.md, borderRadius: radius.sm, ...t.body }, pageNumber: { width: 54, textAlign: 'center', paddingHorizontal: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }, icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  dock: { maxHeight: '44%', flexGrow: 0 }, dockContent: { gap: 8 }, hint: { fontSize: 12, textAlign: 'center', paddingVertical: 4 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16 },
  landscapeRow: { flexDirection: 'row' }, landscapeSide: { width: 280, flexGrow: 0 },
  placement: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#1565ff', transform: [{ translateX: -7 }, { translateY: -7 }] },
  editPanel: { gap: s.md, padding: s.md, borderRadius: radius.md }, textList: { maxHeight: 180 }, textRow: { paddingVertical: s.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  footer: { padding: s.sm, gap: s.sm, borderTopWidth: StyleSheet.hairlineWidth },
  multiline: { maxHeight: 140, textAlignVertical: 'top' }, notice: { flexDirection: 'row', alignItems: 'center', gap: s.sm, padding: s.sm, borderRadius: radius.sm }, dim: { opacity: 0.35 },
});

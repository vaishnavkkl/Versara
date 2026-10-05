import { useResponsiveEditorToolbar, responsiveToolbarStyles } from '../editor/responsive-editor-toolbar';
import { retainPdfEditingSource } from './pdf-tool-session';
import { useEditorDraft } from '../editor/use-editor-draft';
import { pdfDraftId } from '../editor/editor-drafts';
import { askSaveOptions, saveEditedOutput, type SaveMode } from '../files/save-file';
import { toast } from '@/components/toast';
import { showDialog } from '@/components/app-dialog';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInput as NativeTextInput } from 'react-native';
import { HelpTextInput as TextInput } from '@/components/help-text-input';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { AppLoader } from '@/components/app-loader';
import { ColorSwatches } from '@/components/color-swatches';
import { DEFAULT_TEXT_STYLE, fontName, styleFromFont, TextStyleControls, type TextStyle } from '@/components/text-style-controls';
import { fontFile, useEditFonts, withFontFiles } from '@/constants/edit-fonts';
import { OptionCard, OptionSheet } from '@/components/option-sheet';
import { ToolRowButton } from '@/components/tool-action-row';
import { usePublishHeaderShare } from '@/components/header-share';
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
import { browseFiles, createImportDirectory, disposeImports, savedPdfDirectory, shareFile, shareNamedFile, shareRenderedPdf, type LocalFile } from '../files/file-storage';
import { openPdfResult } from './open-pdf-screen';
import { PdfPreviewQueue, type PagePreview } from './pdf-preview-queue';
import { usePdfScreenActive } from './use-pdf-screen-active';
import { PdfPreviewBody, PdfPreviewToolbar, PdfPreviewStage } from './pdf-preview';
import { PublishHeaderHistory } from '@/components/header-history';
import { useControlHelp } from '@/components/control-help';
import { usePdfToolLayout } from './pdf-tool-layout';

type TextObject = PdfTextObject;
/** `font` is a standard PDF font name (Helvetica-Bold, Times-Italic, …) or 'original'. */
type Edit = { page: number; kind: 'replace' | 'delete' | 'add'; objectId?: number; original?: string; text?: string; font?: string; size?: number; x?: number; y?: number; color?: number; underline?: boolean; indent?: number };
type Draft = { text: string; style: TextStyle; size: string; indent: number; color: number | null };
const DEFAULT_INK = 0x101020;
const INDENT_STEP = 18;
const TEXT_ACTION_MIN_WIDTH = 112;
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
type FoundText = { page: number; id: number; text: string };
type FindResult = { query: string; matchCase: boolean; found: FoundText[]; truncated: boolean; locked: number };
const findPattern = (query: string, matchCase: boolean) => new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
/** Current text of every found fragment (including earlier edits) that still contains the query. */
function findMatches(result: FindResult, edits: Edit[]) {
  const pattern = findPattern(result.query, result.matchCase);
  const seen = new Set<string>();
  const matches: { page: number; id: number; original: string; text: string; count: number }[] = [];
  const add = (page: number, id: number, original: string, text: string) => {
    const count = text.match(pattern)?.length ?? 0;
    if (count) matches.push({ page, id, original, text, count });
  };
  for (const item of result.found) {
    const existing = edits.find(edit => edit.page === item.page && edit.objectId === item.id);
    seen.add(`${item.page}:${item.id}`);
    if (existing?.kind !== 'delete') add(item.page, item.id, item.text, existing?.kind === 'replace' ? existing.text ?? '' : item.text);
  }
  for (const edit of edits) if (edit.kind === 'replace' && edit.objectId !== undefined && !seen.has(`${edit.page}:${edit.objectId}`)) add(edit.page, edit.objectId, edit.original ?? '', edit.text ?? '');
  return matches;
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
export function PdfTextEditor({ initialMode = 'edit', initialSelection, onUnsavedChange, onDiscardReady }: { initialMode?: 'edit' | 'add' | 'delete' | 'replace'; initialSelection?: InitialSelection; onUnsavedChange?: (unsaved: boolean) => void; onDiscardReady?: (action: () => Promise<void>) => void }) {
  const colors = usePalette();
  const controlHelp = useControlHelp();
  const layout = usePdfToolLayout();
  const landscape = layout?.landscape ?? false;
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
  useEditFonts();
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
  // Find & Replace opens straight into its sheet; the other text tools search to jump to text.
  const replacing = initialMode === 'replace';
  const [showSearch, setShowSearch] = useState(replacing);
  const [findQuery, setFindQuery] = useState(initialSelection?.initialQuery ?? '');
  const [replaceWith, setReplaceWith] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [findResult, setFindResult] = useState<FindResult | null>(null);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchVersion = useRef(0);
  const inlineSearch = showSearch && !replacing && !selected && !placement;
  const searchMatches = useMemo(() => findResult ? findMatches(findResult, edits) : [], [findResult, edits]);
  const searchMatch = inlineSearch ? searchMatches[Math.min(searchIndex, Math.max(0, searchMatches.length - 1))] : undefined;
  const replaceAvailable = !!PdfEngine?.nativeFindReplaceVersion;
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const toolbar = useResponsiveEditorToolbar(
    [{ label: 'Options', minWidth: TEXT_ACTION_MIN_WIDTH }],
    [{ label: adding ? 'Select text' : 'Add text', compact: true, minWidth: TEXT_ACTION_MIN_WIDTH }, { label: 'Text list', compact: true, minWidth: TEXT_ACTION_MIN_WIDTH }, 'Save (' + edits.length + ')'],
  );
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
    const response = await previewQueue.render(file.uri, target, JSON.stringify(withFontFiles(changes.filter(edit => edit.page === target))));
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
  // Every change, including a valid open text box; used for recovery and the header share.
  const shareChanges = makeDraft(edits, page, selected, placement, editingAddition, { text, style: textStyle, size, indent, color: ink }).changes;
  const recovery = useEditorDraft({ id: recoveryOrigin ? pdfDraftId(recoveryOrigin, 'text') : null, uri: source ? recoveryOrigin : undefined,
    value: { edits: shareChanges, history, future, page }, dirty: unsaved,
    validate: validTextRecovery, restore: value => { setEdits(value.edits); setHistory(value.history); setFuture(value.future); setPage(Math.min(value.page, Math.max(0, (preview?.pageCount ?? 1) - 1))); } });
  useEffect(() => { onDiscardReady?.(recovery.discard); }, [onDiscardReady, recovery.discard]);
  usePublishHeaderShare({ active: !!source, disabled: busy || !recovery.ready, label: result ? 'Share saved PDF' : shareChanges.length ? 'Share edited PDF' : 'Share PDF', onShare: sharePdf,
    save: { disabled: busy || !edits.length || !recovery.ready, label: `Save PDF (${edits.length} edits)`, onSave: requestSave } });
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
  // Rendered fragments carry no link to the "add" edit that produced them; match by line text and position.
  const addedObjects = useMemo(() => {
    const found = new Map<number, number>();
    if (!previewObjects || !preview) return found;
    const pageHeight = (preview.pointWidth || 612) * preview.height / Math.max(1, preview.width);
    edits.forEach((edit, index) => {
      if (edit.kind !== 'add' || edit.page !== page || index === editingAddition) return;
      const lines = (edit.text ?? '').split('\n').map(line => line.trim()).filter(Boolean);
      const lineHeight = (edit.size ?? 16) * 1.4 / pageHeight;
      for (const object of previewObjects) {
        if (!object.bounds || found.has(object.id) || !lines.includes(object.text.trim())) continue;
        const baseline = object.bounds.y + object.bounds.height;
        if (Math.abs(object.bounds.x - (edit.x ?? 0)) < 0.05 && baseline > (edit.y ?? 0) - 0.03 && baseline < (edit.y ?? 0) + lines.length * lineHeight + 0.03) found.set(object.id, index);
      }
    });
    return found;
  }, [previewObjects, preview, edits, page, editingAddition]);
  const pageObjects = useMemo(() => (previewObjects ?? []).filter(object => !addedObjects.has(object.id)), [previewObjects, addedObjects]);
  const objectsJson = useMemo(() => JSON.stringify((previewObjects ?? [])
    .filter(object => object.bounds && (object.id === selected?.id || !removedIds.includes(object.id)))
    .map(object => ({ id: object.id, ...object.bounds }))), [previewObjects, removedIds, selected?.id]);
  const searchObject = searchMatch?.page === page ? previewObjects?.find(object => object.id === searchMatch.id) : undefined;
  const focusBounds = selected?.bounds ?? searchObject?.bounds ?? (placement ? { x: Math.max(0, placement.x - 0.02), y: Math.max(0, placement.y - 0.04), width: 0.35, height: 0.05 } : null);
  const focusJson = focusBounds ? JSON.stringify(focusBounds) : '';
  const textField = useRef<NativeTextInput>(null);
  const selectedId = selected?.id;
  // Tapping text on the page goes straight to typing; the field shows what is typed.
  useEffect(() => {
    if (selectedId === undefined || multiDelete) return;
    const timer = setTimeout(() => textField.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [selectedId, multiDelete]);
  const highlightBounds = searchObject && searchObject.id !== selected?.id ? searchObject.bounds : null;
  const openAddition = useCallback((index: number) => {
    const edit = edits[index];
    if (!edit) return;
    invalidateDraft();
    setShowFormatting(false); setShowTextList(false); setShowOptions(false); setShowSearch(false); setError('');
    setAdding(true); setSelected(null); setEditingAddition(index); setPlacement({ x: edit.x ?? 0, y: edit.y ?? 0 });
    setText(edit.text ?? ''); setSize(String(edit.size ?? 16)); setTextStyle(styleFromFont(edit.font ?? 'Helvetica', edit.underline)); setIndent(0); setInk(edit.color ?? DEFAULT_INK);
  }, [edits, invalidateDraft]);
  const placeText = useCallback((point: { x: number; y: number }) => {
    if (editingAddition === null && !placement) {
      const hit = (previewObjects ?? []).find(object => object.bounds && addedObjects.has(object.id)
        && point.x >= object.bounds.x - 0.01 && point.x <= object.bounds.x + object.bounds.width + 0.01
        && point.y >= object.bounds.y - 0.01 && point.y <= object.bounds.y + object.bounds.height + 0.01);
      if (hit) { openAddition(addedObjects.get(hit.id)!); return; }
    }
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
  }, [editingAddition, placement, invalidateDraft, previewObjects, addedObjects, openAddition]);

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
      setEdits([]); setHistory([]); setFuture([]); setSelected(null); setPlacement(null); setMarked([]); setFindResult(null);
      setAdding(initialMode === 'add'); setName(`${picked.name.replace(/\.pdf$/i, '')} - edited`);
      accepted = true;
    } catch (cause) { fail(cause); }
    finally {
      if (picked && !accepted) try { new File(picked.uri).delete(); } catch { /* Session cleanup retries. */ }
      finish();
    }
  }
  /** `openId` opens that text on the new page, e.g. a search result. */
  async function navigate(target: number, openId?: number) {
    if (!source || !preview || locked.current) return;
    if (!Number.isInteger(target) || target < 0 || target >= preview.pageCount) { setError(`Enter a page from 1 to ${preview.pageCount}.`); return; }
    begin('Reading page...');
    try {
      const next = await loadPage(source, target, edits);
      if (next) {
        showPreview(next); setPage(target); setSelected(null); setPlacement(null); setMarked([]); setFragmentPage(0); setEditingAddition(null);
        const found = openId === undefined ? undefined : next.objects.find(object => object.id === openId);
        if (found) openText(found, target);
      }
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  function openText(object: TextObject, onPage: number) {
    if (!object.editable) { setError('This text also clips page graphics and cannot be changed safely. You can still add text to this page.'); return; }
    if (multiDelete) {
      setError(''); setShowSearch(false);
      setMarked(current => current.includes(object.id) ? current.filter(id => id !== object.id) : [...current, object.id]);
      return;
    }
    invalidateDraft();
    const existing = edits.find(edit => edit.page === onPage && edit.objectId === object.id);
    setShowFormatting(false); setShowTextList(false); setShowOptions(false); setShowSearch(false); setAdding(false); setPlacement(null); setEditingAddition(null); setSelected(object); setText(existing?.text ?? object.text); setTextStyle(styleFromFont(existing?.font, existing?.underline)); setSize(String(existing?.size ?? roundSize(object.size))); setIndent(existing?.indent ?? 0); setInk(existing?.color ?? null); setError('');
  }
  function select(object: TextObject) {
    if (locked.current) return;
    const added = addedObjects.get(object.id);
    if (added === undefined) { openText(object, page); return; }
    if (multiDelete) { setError('Text you added is removed from its own editor. Turn off multi-select and tap it.'); return; }
    openAddition(added);
  }
  function openMatch(match: { page: number; id: number }) {
    if (locked.current) return;
    if (match.page !== page) { void navigate(match.page, match.id); return; }
    const found = preview?.objects.find(object => object.id === match.id);
    if (found) openText(found, page);
  }
  async function change(next: Edit[], step: 'edit' | 'undo' | 'redo' = 'edit') {
    if (!source || locked.current) return false;
    begin('Updating preview...');
    try {
      const nextPreview = await loadPage(source, page, next);
      if (nextPreview) {
        showPreview(nextPreview);
        if (step === 'undo') { setHistory(current => current.slice(0, -1)); setFuture(current => [...current, edits].slice(-30)); }
        else if (step === 'redo') { setFuture(current => current.slice(0, -1)); setHistory(current => [...current, edits].slice(-30)); }
        else { setHistory(current => [...current, edits].slice(-30)); setFuture([]); }
        setEdits(next); setSelected(null); setPlacement(null); setEditingAddition(null); setText(''); setMarked([]);
        return true;
      }
    } catch (cause) { fail(cause); }
    finally { finish(); }
    return false;
  }
  async function findText() {
    const query = findQuery;
    const version = searchVersion.current;
    let firstMatch: FoundText | undefined;
    if (!source || !PdfEngine || locked.current || !query.trim()) return;
    Keyboard.dismiss();
    begin('Finding text...'); setProgress(0);
    const id = newId(); job.current = id;
    try {
      await previewQueue.settle();
      if (!mounted.current) return;
      const response = JSON.parse(await PdfEngine.editPdfText(id, JSON.stringify({ action: 'find_text', uri: source.uri, query, matchCase }))) as { pages: { page: number; objects: { id: number; text: string }[] }[]; truncated: boolean; locked: number };
      if (mounted.current && version === searchVersion.current) {
        const found = { query, matchCase, truncated: response.truncated, locked: response.locked, found: response.pages.flatMap(item => item.objects.map(object => ({ page: item.page, ...object }))) };
        setSearchIndex(0);
        setFindResult(found);
        firstMatch = findMatches(found, edits)[0];
      }
    } catch (cause) { fail(cause); }
    finally { finish(); }
    if (!replacing && firstMatch && firstMatch.page !== page && mounted.current && version === searchVersion.current) void navigate(firstMatch.page);
  }
  // Opened from the reader's search: look for that text as soon as the PDF is ready.
  const initialFind = useRef(replacing && !!initialSelection?.initialQuery?.trim());
  const runInitialFind = useEffectEvent(() => { void findText(); });
  useEffect(() => {
    if (!sourceUri || busy || !initialFind.current || !replaceAvailable) return;
    initialFind.current = false;
    runInitialFind();
  }, [sourceUri, busy, replaceAvailable]);
  async function replaceAll() {
    if (!findResult || locked.current) return;
    if (selected || placement) {
      showDialog('Text box still open', 'Apply or cancel this text box before replacing text.', undefined, { ios: 'character.textbox', android: 'text-fields' }); return;
    }
    const pattern = findPattern(findResult.query, findResult.matchCase);
    const replacement = replaceWith.replace(/[\r\n\t]/g, ' ');
    const matches = findMatches(findResult, edits);
    let next = edits;
    for (const match of matches) {
      const existing = edits.find(edit => edit.page === match.page && edit.objectId === match.id);
      const value = match.text.replace(pattern, () => replacement);
      const command: Edit = value.trim()
        ? { ...existing, kind: 'replace', page: match.page, objectId: match.id, original: match.original, text: value, font: existing?.font ?? 'original' }
        : { kind: 'delete', page: match.page, objectId: match.id, original: match.original };
      next = [...next.filter(edit => !(edit.page === match.page && edit.objectId === match.id)), command];
    }
    if (next.length > 500) { setError('Save these changes before replacing more text.'); return; }
    const places = matches.reduce((sum, match) => sum + match.count, 0);
    if (await change(next)) { setShowSearch(false); setFindResult(null); toast(`Replaced ${places} ${places === 1 ? 'match' : 'matches'}`); }
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
  const selectable = pageObjects.filter(object => object.editable && object.bounds && !removedIds.includes(object.id));
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
      const output: PdfResult = JSON.parse(await PdfEngine.editPdfText(id, JSON.stringify({ action: 'save', uri: source.uri, outputUri, edits: withFontFiles(edits) })));
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
  /** Shares the saved result, otherwise a fresh copy with every current change, otherwise the original. */
  async function sharePdf() {
    if (result) { await exportResult(); return; }
    if (!source || !PdfEngine || locked.current) return;
    const base = name.trim().replace(/\.pdf$/i, '').slice(0, 100) || 'Edited PDF';
    if (!shareChanges.length) {
      begin('Opening share menu...');
      try { await shareNamedFile({ ...source, mimeType: 'application/pdf' }); }
      catch (cause) { fail(cause); }
      finally { finish(); }
      return;
    }
    const changes = shareChanges;
    begin('Preparing the edited PDF...'); setProgress(0);
    const id = newId(); job.current = id;
    try {
      await previewQueue.settle();
      if (!mounted.current) return;
      await shareRenderedPdf(`${base}.pdf`, outputUri => PdfEngine!.editPdfText(id, JSON.stringify({ action: 'save', uri: source.uri, outputUri, edits: withFontFiles(changes) })));
    } catch (cause) { fail(cause); }
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
  const openOptions = () => { Keyboard.dismiss(); setShowOptions(true); setShowTextList(false); setShowFormatting(false); setShowSearch(false); };
  const openSearch = () => { Keyboard.dismiss(); setShowSearch(true); setShowOptions(false); setShowTextList(false); setShowFormatting(false); };
  const closeSearch = () => { searchVersion.current++; setShowSearch(false); setFindQuery(''); setFindResult(null); setSearchIndex(0); Keyboard.dismiss(); };
  const updateQuery = (value: string) => { searchVersion.current++; setFindQuery(value); setFindResult(null); setSearchIndex(0); };
  const stepSearch = (direction: number) => {
    if (locked.current || !searchMatches.length) return;
    Keyboard.dismiss();
    const index = (Math.min(searchIndex, searchMatches.length - 1) + direction + searchMatches.length) % searchMatches.length;
    setSearchIndex(index);
    if (searchMatches[index].page !== page) void navigate(searchMatches[index].page);
  };
  const replaceMatches = searchMatches;
  const replacePlaces = replaceMatches.reduce((sum, match) => sum + match.count, 0);
  const replacePages = new Set(replaceMatches.map(match => match.page)).size;
  const toolActions = <View style={responsiveToolbarStyles.tools}>
        <EditorOption compact label="Options" style={styles.textAction} selected={showOptions} disabled={busy} icon={{ ios: 'slider.horizontal.3', android: 'tune' }} onPress={openOptions} />
  </View>;
  const editingText = !!(selected || placement);
  const optionsInRow = keyboardOpen || !toolbar.atBottom;
  const inputStyle = [styles.input, { color: colors.label, backgroundColor: colors.fieldSurface }];
  const changeStyle = (next: TextStyle) => { invalidateDraft(); setTextStyle(next); };
  const stepSize = (delta: number) => { invalidateDraft(); setSize(value => String(Math.max(4, Math.min(200, Math.round(Number(value) || 16) + delta)))); };
  return <KeyboardAvoidingView style={[styles.screen, landscape && styles.landscapeRow]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <PublishHeaderHistory active={!!source && !result} canUndo={history.length > 0 && !busy} canRedo={future.length > 0 && !busy} onUndo={() => change(history[history.length - 1], 'undo')} onRedo={() => change(future[future.length - 1], 'redo')} />
    {toolbar.measurements}
    {source && preview ? <View style={styles.grow}>
      {inlineSearch && <View style={[styles.searchPanel, { borderColor: colors.separator, backgroundColor: colors.systemBackground }]}>
        <View style={styles.searchRow}>
          <TextInput accessibilityLabel="Search text in PDF" autoFocus value={findQuery} onChangeText={updateQuery} editable={!busy} maxLength={128} returnKeyType="search" autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => void findText()} placeholder="Find in this PDF" placeholderTextColor={colors.secondaryLabel} style={[styles.searchInput, { color: colors.label, backgroundColor: colors.accentSurface }]} />
          <Pressable accessibilityRole="button" accessibilityLabel="Search PDF text" disabled={busy || !findQuery.trim()} onPress={() => void findText()} style={[styles.icon, (busy || !findQuery.trim()) && styles.dim]}><UniversalIcon ios="magnifyingglass" android="search" size={20} color={colors.systemBlue} /></Pressable>
          {findResult && <ThemedText accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.searchCount, { color: colors.secondaryLabel }]}>{searchMatches.length ? `${Math.min(searchIndex + 1, searchMatches.length)}/${searchMatches.length}${findResult.truncated ? '+' : ''}` : '0'}</ThemedText>}
          <Pressable accessibilityRole="button" accessibilityLabel="Previous search result" disabled={busy || !searchMatches.length} onPress={() => stepSearch(-1)} style={[styles.icon, (busy || !searchMatches.length) && styles.dim]}><UniversalIcon ios="chevron.up" android="keyboard-arrow-up" size={24} color={colors.systemBlue} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next search result" disabled={busy || !searchMatches.length} onPress={() => stepSearch(1)} style={[styles.icon, (busy || !searchMatches.length) && styles.dim]}><UniversalIcon ios="chevron.down" android="keyboard-arrow-down" size={24} color={colors.systemBlue} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close PDF search" onPress={closeSearch} style={styles.icon}><UniversalIcon ios="xmark" android="close" size={22} color={colors.systemBlue} /></Pressable>
        </View>
        {busy && <ThemedText accessibilityLiveRegion="polite" style={[styles.searchStatus, { color: colors.secondaryLabel }]}>{phase}</ThemedText>}
        {searchMatch && <Pressable accessibilityRole="button" accessibilityLabel={`${multiDelete ? 'Select for removal' : 'Edit'} search result on page ${searchMatch.page + 1}: ${searchMatch.text}`} disabled={busy} onPress={() => { Keyboard.dismiss(); openMatch(searchMatch); }} style={[styles.searchResult, busy && styles.dim]}>
          <ThemedText style={[styles.badge, { color: colors.systemBlue }]}>Page {searchMatch.page + 1}</ThemedText>
          <ThemedText numberOfLines={1} style={styles.grow}>{searchMatch.text}</ThemedText>
          <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.systemBlue} />
        </Pressable>}
        {findResult && !searchMatches.length && <ThemedText accessibilityLiveRegion="polite" style={[styles.searchStatus, { color: colors.secondaryLabel }]}>No editable text matches. Scans and words split across text pieces are skipped.</ThemedText>}
        {!!findResult?.locked && <ThemedText style={[styles.searchStatus, { color: colors.secondaryLabel }]}>{findResult.locked} matching text pieces are protected and cannot be edited.</ThemedText>}
      </View>}
      <PdfPreviewBody pages={{ uri: source.uri, count: preview.pageCount, page, onSelect: target => void navigate(target) }} toolbar={inlineSearch ? null : <PdfPreviewToolbar history page={page + 1} count={preview.pageCount} disabled={busy} onPageChange={target => void navigate(target - 1)} rotate={!(editingText && optionsInRow)}>
        {editingText && <ToolRowButton caption label="Style" icon={{ ios: 'textformat', android: 'text-format' }} selected={showFormatting} expanded={showFormatting} disabled={busy}
          onPress={() => { Keyboard.dismiss(); setShowFormatting(true); setShowTextList(false); setShowOptions(false); }} />}
        {(replaceAvailable || replacing) && !editingText && <ToolRowButton caption label={replacing ? 'Replace' : 'Search'} icon={replacing ? { ios: 'text.magnifyingglass', android: 'find-replace' } : { ios: 'magnifyingglass', android: 'search' }} selected={showSearch} expanded={showSearch} disabled={busy} onPress={openSearch} />}
        {optionsInRow && <ToolRowButton caption label="Options" icon={{ ios: 'slider.horizontal.3', android: 'tune' }} selected={showOptions} expanded={showOptions} disabled={busy} onPress={openOptions} />}
      </PdfPreviewToolbar>}>
      <PdfPreviewStage status={draftIssue ? 'Preview paused' : previewStatus} hint={selected ? 'Your changes appear live on the page. Tap the tick to apply.' : nativeTextBox ? 'Type on the page. Drag the blue handle to move text. Style is in the row above.' : adding ? 'Tap to place text. Pinch to zoom.' : multiDelete ? 'Tap text boxes to select them, then delete them together.' : 'Tap any text to change it. Pinch to zoom.'}>
      {screenActive && NativeEditCanvas ? <NativeEditCanvas key={source.uri + ':' + page} style={styles.canvas} source={preview.imageUri}
        pageLayout={JSON.stringify({ width: preview.width, height: preview.height, pointWidth: preview.pointWidth ?? 0 })}
        objects={objectsJson} selectedId={selected?.id ?? -1} markedIds={marked.join(',')} adding={adding} disabled={busy || !!controlHelp?.active} placement={placement ? JSON.stringify(placement) : ''}
        textBox={JSON.stringify({ visible: nativeTextBox && !controlHelp?.active, submitOnReturn: true, text, font: textStyle.family === 'original' ? 'Helvetica' : fontName(textStyle), fontFile: fontFile(fontName(textStyle)), size: Number(size) || 16, color: ink ?? DEFAULT_INK, underline: textStyle.underline })}
        focus={focusJson} highlight={highlightBounds ? JSON.stringify(highlightBounds) : ''}
        onSelectObject={({ nativeEvent }) => { const object = preview.objects.find(item => item.id === nativeEvent.id); if (object) select(object); }}
        onPlace={({ nativeEvent }) => placeText(nativeEvent)}
        onTextChange={({ nativeEvent }) => setText(nativeEvent.text)}
        onSubmitText={({ nativeEvent }) => { if (nativeEvent.text.trim()) apply(selected ? 'replace' : 'add', nativeEvent.text); }} />
      : screenActive ? <PdfEditCanvas key={source.uri + ':' + page} uri={preview.imageUri} width={preview.width} height={preview.height} objects={preview.objects} selectedId={selected?.id} markedIds={marked} adding={adding} disabled={busy || !!controlHelp?.active} placement={placement}
        removedIds={removedIds} highlight={highlightBounds} onSelect={select} onPlace={placeText} /> : <View style={styles.grow} />}
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
      {(selected || placement) && <View style={[styles.editorBar, { backgroundColor: colors.secondarySystemBackground }]}>
        {!nativeTextBox && <View style={styles.editorInput}>
          <TextInput ref={textField} accessibilityLabel="PDF text" onFocus={() => { setShowFormatting(false); setShowTextList(false); setShowOptions(false); }} value={text} onChangeText={value => { invalidateDraft(); setText(value); }} editable={!busy} maxLength={4000} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => { if (text.trim()) apply(selected ? 'replace' : 'add'); }} placeholder="Type the new text" placeholderTextColor={colors.secondaryLabel} style={inputStyle} />
        </View>}
        <View style={styles.row}>
          <ThemedText style={[styles.grow, styles.markCount]} numberOfLines={1}>{nativeTextBox ? 'Editing on the page' : selected ? 'Live on the page' : 'New text'}</ThemedText>
          <View style={styles.sizeStepper}>
            <Pressable accessibilityRole="button" accessibilityLabel="Smaller text" disabled={busy || Number(size) <= 4} hitSlop={2} style={[styles.sizeButton, (busy || Number(size) <= 4) && styles.dim]} onPress={() => stepSize(-1)}><UniversalIcon ios="textformat.size.smaller" android="text-decrease" size={20} color={colors.systemBlue} /></Pressable>
            <ThemedText accessibilityLabel={`Text size ${size} points`} style={styles.sizeLabel}>{size}</ThemedText>
            <Pressable accessibilityRole="button" accessibilityLabel="Larger text" disabled={busy || Number(size) >= 200} hitSlop={2} style={[styles.sizeButton, (busy || Number(size) >= 200) && styles.dim]} onPress={() => stepSize(1)}><UniversalIcon ios="textformat.size.larger" android="text-increase" size={20} color={colors.systemBlue} /></Pressable>
          </View>
          {selected && <Pressable accessibilityRole="button" accessibilityLabel="Delete selected text" disabled={busy} style={styles.icon} onPress={() => apply('delete')}><UniversalIcon ios="trash" android="delete-outline" size={22} color={colors.destructive} /></Pressable>}
          {editingAddition !== null && <Pressable accessibilityRole="button" accessibilityLabel="Remove added text" disabled={busy} style={styles.icon} onPress={() => { Keyboard.dismiss(); void change(edits.filter((_, index) => index !== editingAddition)); }}><UniversalIcon ios="trash" android="delete-outline" size={22} color={colors.destructive} /></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Apply text" disabled={busy || !text.trim()} style={styles.icon} onPress={() => apply(selected ? 'replace' : 'add')}><UniversalIcon ios="checkmark" android="check" size={24} color={colors.systemBlue} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel selection" style={styles.icon} onPress={() => { Keyboard.dismiss(); invalidateDraft(); setSelected(null); setPlacement(null); setEditingAddition(null); }}><UniversalIcon ios="xmark" android="close" size={20} color={colors.secondaryLabel} /></Pressable>
        </View>
      </View>}
      {!!(draftIssue || previewError || recovery.error) && <ThemedText accessibilityRole="alert" style={styles.hint}>{draftIssue || previewError || recovery.error}</ThemedText>}
      <OptionSheet title="Text style" icon={{ ios: 'textformat', android: 'text-format' }} isPresented={showFormatting && editingText} onClose={() => setShowFormatting(false)}>
        <OptionCard title="Font" icon={{ ios: 'textformat.size', android: 'format-size' }}>
          <TextStyleControls style={textStyle} onChange={changeStyle} size={size} onSizeChange={value => { invalidateDraft(); setSize(value); }} sizeUnit="pt" minSize={4} maxSize={200} allowOriginal={!!selected} disabled={busy} indent={indent} indentStep={INDENT_STEP} onIndentChange={changeIndent} />
          {!!preview.fontFallbacks && textStyle.family === 'original' && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>The closest standard font is used for characters missing from the original font.</ThemedText>}
        </OptionCard>
        <OptionCard title="Colour" icon={{ ios: 'paintpalette', android: 'palette' }}>
          <ColorSwatches value={ink} disabled={busy} original={selected ? { label: 'Original', value: null } : undefined} onChange={value => { invalidateDraft(); setInk(value ?? (selected ? null : DEFAULT_INK)); }} />
        </OptionCard>
        {editingAddition !== null && <ToolButton title="Remove added text" secondary disabled={busy} onPress={() => { setShowFormatting(false); void change(edits.filter((_, index) => index !== editingAddition)); }} />}
      </OptionSheet>
      <OptionSheet expandable title={`Text on page ${page + 1}`} icon={{ ios: 'list.bullet', android: 'format-list-bulleted' }} isPresented={showTextList && !editingText} onClose={() => setShowTextList(false)}>
        {edits.some(edit => edit.kind === 'add' && edit.page === page) && <OptionCard title="Text you added" icon={{ ios: 'text.badge.plus', android: 'text-fields' }}>{edits.map((edit, index) => edit.kind === 'add' && edit.page === page && <Pressable key={index} accessibilityRole="button" accessibilityLabel={`Edit added text: ${edit.text}`} disabled={busy} style={({ pressed }) => [styles.textRow, { borderColor: colors.separator, opacity: pressed ? 0.6 : 1 }]} onPress={() => openAddition(index)}><ThemedText numberOfLines={2} style={styles.grow}>{edit.text}</ThemedText><ThemedText style={[styles.badge, { color: colors.systemBlue }]}>Added</ThemedText></Pressable>)}</OptionCard>}
        <OptionCard title={multiDelete ? 'Tap text to select it for deletion' : 'Tap text to edit it'} icon={{ ios: 'text.alignleft', android: 'notes' }}>
          <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>PDFs may store a sentence as several separate fragments.</ThemedText>
          {!pageObjects.length && <ThemedText style={{ color: colors.secondaryLabel }}>No editable text was found on this page.</ThemedText>}
          {pageObjects.slice(fragmentPage * 50, fragmentPage * 50 + 50).map(object => {
            const existing = edits.find(edit => edit.page === page && edit.objectId === object.id);
            const isMarked = marked.includes(object.id);
            return <Pressable key={object.id} accessibilityRole="button" accessibilityLabel={`Select ${object.text}`} disabled={busy} onPress={() => select(object)} accessibilityState={{ selected: isMarked }} style={({ pressed }) => [styles.textRow, { borderColor: colors.separator, opacity: pressed ? 0.6 : 1 }, isMarked && styles.markedRow]}>
              {isMarked && <UniversalIcon ios="checkmark.circle.fill" android="check-circle" size={18} color={colors.destructive} />}
              <ThemedText numberOfLines={2} style={[styles.grow, existing?.kind === 'delete' && { color: colors.secondaryLabel, textDecorationLine: 'line-through' }]}>{existing?.kind === 'replace' ? existing.text : object.text}</ThemedText>
              {existing && <ThemedText style={[styles.badge, { color: existing.kind === 'delete' ? colors.destructive : colors.systemBlue }]}>{existing.kind === 'delete' ? 'Removed' : 'Edited'}</ThemedText>}
            </Pressable>;
          })}
          {pageObjects.length > 50 && <><ThemedText style={styles.note}>Text {fragmentPage * 50 + 1}–{Math.min(fragmentPage * 50 + 50, pageObjects.length)} of {pageObjects.length}</ThemedText><View style={styles.row}><View style={styles.grow}><ToolButton title="Earlier text" secondary disabled={busy || fragmentPage === 0} onPress={() => setFragmentPage(current => current - 1)} /></View><View style={styles.grow}><ToolButton title="More text" secondary disabled={busy || (fragmentPage + 1) * 50 >= pageObjects.length} onPress={() => setFragmentPage(current => current + 1)} /></View></View></>}
        </OptionCard>
      </OptionSheet>
      <OptionSheet title="PDF options" icon={{ ios: 'slider.horizontal.3', android: 'tune' }} isPresented={showOptions} onClose={() => setShowOptions(false)}>
        <OptionCard title="File" icon={{ ios: 'doc', android: 'description' }}>
          <ThemedText numberOfLines={2}>{source.name}</ThemedText>
          <ThemedText style={styles.label}>New PDF name</ThemedText>
          <TextInput accessibilityLabel="New PDF name" value={name} onChangeText={setName} editable={!busy} maxLength={100} style={inputStyle} />
          <ToolButton title="Choose another PDF" secondary disabled={busy} onPress={() => {
            setShowOptions(false);
            if (unsaved) showDialog('Choose another PDF?', 'Your unsaved changes will be discarded.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { void choose(); } }]);
            else void choose();
          }} />
        </OptionCard>
        {layout && <OptionCard title="View" icon={{ ios: 'rectangle.landscape.rotate', android: 'screen-rotation' }}>
          <EditorOption label={layout.landscape ? 'Switch to portrait' : 'Switch to landscape'} icon={{ ios: 'rotate.right', android: 'screen-rotation' }} selected={layout.landscape} onPress={() => layout.setLandscape(value => !value)} />
        </OptionCard>}
        <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>Scans and text inside embedded groups cannot be edited. Delete removes page text; it is not secure redaction.</ThemedText>
      </OptionSheet>
      {replacing && <OptionSheet expandable title="Find and replace" icon={{ ios: 'text.magnifyingglass', android: 'find-replace' }} isPresented={showSearch && !editingText} onClose={() => setShowSearch(false)}>
        <OptionCard title="Text" icon={{ ios: 'magnifyingglass', android: 'search' }}>
          {!replaceAvailable && <ThemedText accessibilityRole="alert">Install the latest app build to search and replace PDF text.</ThemedText>}
          <ThemedText style={styles.label}>Find</ThemedText>
          <TextInput accessibilityLabel="Text to find" value={findQuery} onChangeText={value => { setFindQuery(value); setFindResult(null); }} editable={!busy && replaceAvailable} maxLength={128} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => void findText()} placeholder="Text to find" placeholderTextColor={colors.secondaryLabel} style={inputStyle} />
          {replacing && <>
            <ThemedText style={styles.label}>Replace with</ThemedText>
            <TextInput accessibilityLabel="Replacement text" value={replaceWith} onChangeText={setReplaceWith} editable={!busy && replaceAvailable} maxLength={500} autoCorrect={false} returnKeyType="done" placeholder="Leave empty to remove the text" placeholderTextColor={colors.secondaryLabel} style={inputStyle} />
          </>}
          <EditorOption label="Match case" icon={{ ios: 'textformat', android: 'text-format' }} selected={matchCase} disabled={busy || !replaceAvailable} onPress={() => { setMatchCase(value => !value); setFindResult(null); }} />
          <ToolButton title="Find in all pages" disabled={busy || !replaceAvailable || !findQuery.trim()} onPress={() => void findText()} />
          {busy && <ThemedText accessibilityLiveRegion="polite" style={[styles.note, { color: colors.secondaryLabel }]}>{phase}{progress !== null ? ' ' + Math.round(progress * 100) + '%' : ''}</ThemedText>}
        </OptionCard>
        {findResult && <OptionCard title="Results" icon={{ ios: 'list.bullet', android: 'format-list-bulleted' }}>
          <ThemedText accessibilityLiveRegion="polite">{replaceMatches.length ? `${replacePlaces} ${replacePlaces === 1 ? 'match' : 'matches'} on ${replacePages} ${replacePages === 1 ? 'page' : 'pages'}` : 'No editable text matches this search.'}</ThemedText>
          {findResult.truncated && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>{replacing ? 'Only the first 500 text pieces are listed. Replace these, then search again for the rest.' : 'Only the first 500 text pieces are listed. Narrow your search to see the rest.'}</ThemedText>}
          {findResult.locked > 0 && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>{findResult.locked} matching {findResult.locked === 1 ? 'piece is' : 'pieces are'} protected and cannot be edited.</ThemedText>}
          {replaceMatches.slice(0, 50).map(match => <Pressable key={`${match.page}:${match.id}`} accessibilityRole="button" accessibilityLabel={`Go to page ${match.page + 1}: ${match.text}`} disabled={busy} onPress={() => openMatch(match)} style={({ pressed }) => [styles.textRow, { borderColor: colors.separator, opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText style={[styles.badge, { color: colors.systemBlue }]}>Page {match.page + 1}</ThemedText>
            <ThemedText numberOfLines={2} style={styles.grow}>{match.text}</ThemedText>
            <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.secondaryLabel} />
          </Pressable>)}
          {replaceMatches.length > 50 && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>And {replaceMatches.length - 50} more text pieces.</ThemedText>}
          {replacing && <ToolButton title={replaceMatches.length ? `Replace all (${replacePlaces})` : 'Replace all'} disabled={busy || !replaceMatches.length} onPress={() => void replaceAll()} />}
        </OptionCard>}
        <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>{replacing
          ? 'Finds text inside a single text piece, keeping its original font where possible. Words split across pieces, scans and protected text are skipped. Undo reverts the whole replacement.'
          : multiDelete ? 'Tap a result to go to it and select it for deletion. Words split across text pieces and scans are not found.'
          : 'Tap a result to go to it and edit it. Words split across text pieces and scans are not found.'}</ThemedText>
      </OptionSheet>}
      </PdfPreviewBody>
    </View> : <View style={styles.empty}>
      {busy ? <AppLoader size="large" /> : <>
        <ThemedText>{available ? 'Choose a PDF to start editing.' : 'Install a new development build to use the native editor.'}</ThemedText>
        <ToolButton title="Choose PDF" disabled={!available} onPress={() => choose()} />
      </>}
    </View>}
    {!keyboardOpen && <View style={[styles.footer, landscape && styles.landscapeSide, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy ? <View style={[styles.row, landscape && styles.landscapeStack]}><AppLoader /><ThemedText style={landscape ? undefined : styles.grow} accessibilityLiveRegion="polite">{phase}{progress !== null ? ' ' + Math.round(progress * 100) + '%' : ''}</ThemedText><ToolButton title="Cancel" secondary onPress={() => { previewQueue.cancel(); if (job.current) PdfEngine?.cancelTextEdit(job.current); }} /></View> : source && <View onLayout={toolbar.onBottomLayout} style={[responsiveToolbarStyles.row, landscape && styles.landscapeStack]}>
        {toolbar.atBottom && toolActions}
        <EditorOption compact label={adding ? 'Select text' : 'Add text'} style={landscape ? undefined : styles.textAction} selected={adding} disabled={busy} icon={{ ios: adding ? 'cursorarrow' : 'text.badge.plus', android: adding ? 'touch-app' : 'text-fields' }} onPress={() => { invalidateDraft(); setAdding(!adding); setSelected(null); setPlacement(null); setEditingAddition(null); setText(''); setIndent(0); setTextStyle(current => current.family === 'original' ? DEFAULT_TEXT_STYLE : current); setShowTextList(false); }} />
        <EditorOption compact label="Text list" style={landscape ? undefined : styles.textAction} selected={showTextList} disabled={busy} onPress={() => { invalidateDraft(); setShowTextList(!showTextList); setShowOptions(false); setSelected(null); setPlacement(null); setAdding(false); }} />
        <View style={landscape ? undefined : [responsiveToolbarStyles.primary, { minWidth: toolbar.primaryMinWidth }]}><ToolButton title={'Save (' + edits.length + ')'} disabled={!edits.length || !recovery.ready} onPress={requestSave} /></View>
      </View>}
    </View>}
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  textAction: { minWidth: TEXT_ACTION_MIN_WIDTH },
  searchPanel: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, fontSize: 15 },
  searchCount: { minWidth: 28, fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums'] },
  searchStatus: { fontSize: 12, paddingHorizontal: 12, paddingBottom: 4 },
  searchResult: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12 },
  markedRow: { backgroundColor: '#ff5a5f40', borderRadius: 8, paddingHorizontal: 8 },
  editorBar: { padding: 4, gap: 4 }, editorInput: { paddingHorizontal: 2, paddingTop: 2 }, markCount: { paddingHorizontal: s.sm, fontWeight: '600' },
  deleteButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 12, marginLeft: 4 }, deleteLabel: { color: '#fff', fontWeight: '600' }, screen: { flex: 1 }, canvas: { flex: 1, minHeight: 120 }, form: { padding: s.lg, gap: s.md }, heading: { ...t.heading }, label: { ...t.label },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.sm }, grow: { flex: 1, minWidth: 0 },
  input: { minHeight: 48, padding: s.md, borderRadius: radius.sm, ...t.body }, pageNumber: { width: 54, textAlign: 'center', paddingHorizontal: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }, icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  note: { fontSize: 12, lineHeight: 16 }, badge: { fontSize: 11, fontWeight: '700' }, hint: { fontSize: 12, textAlign: 'center', paddingVertical: 4 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16 },
  landscapeRow: { flexDirection: 'row' }, landscapeSide: { width: 132, flexGrow: 0, justifyContent: 'center', borderTopWidth: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  sizeStepper: { flexDirection: 'row', alignItems: 'center' }, sizeButton: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sizeLabel: { minWidth: 28, textAlign: 'center', fontWeight: '600', fontVariant: ['tabular-nums'] },
  landscapeStack: { flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch' },
  placement: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#1565ff', transform: [{ translateX: -7 }, { translateY: -7 }] },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: s.sm, paddingVertical: s.sm, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  footer: { padding: s.sm, gap: s.sm, borderTopWidth: StyleSheet.hairlineWidth },
  multiline: { maxHeight: 140, textAlignVertical: 'top' }, notice: { flexDirection: 'row', alignItems: 'center', gap: s.sm, padding: s.sm, borderRadius: radius.sm }, dim: { opacity: 0.35 },
});

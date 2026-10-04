import { useEditorDraft } from '../editor/use-editor-draft';
import { responsiveToolbarStyles, useResponsiveEditorToolbar } from '../editor/responsive-editor-toolbar';
import { pdfDraftId, pruneSignatureDraftAssets } from '../editor/editor-drafts';
import { PagePositionPicker } from './page-position-picker';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Keyboard, Platform, ScrollView, StyleSheet, View, type TextInputProps } from 'react-native';
import { HelpTextInput as TextInput, HelpSheetTextInput as BottomSheetTextInput } from '@/components/help-text-input';
import { Directory, File, Paths } from 'expo-file-system';
import { FileEngine } from '../../../modules/file-engine';
import { ColorSwatches, hexColor } from '@/components/color-swatches';
import { DEFAULT_TEXT_STYLE, fontName, TextStyleControls } from '@/components/text-style-controls';
import { fontFile } from '@/constants/edit-fonts';
import { EditorOption } from '@/components/editor-option';
import { PublishHeaderHistory } from '@/components/header-history';
import { usePublishHeaderShare } from '@/components/header-share';
import { OptionCard, OptionSheet } from '@/components/option-sheet';
import { EditorMenu } from '@/components/editor-menu';
import { ToolRowButton } from '@/components/tool-action-row';
import { BrushControls, BRUSHES } from './brush-controls';
import { useMarkHistory, isMarkHistorySnapshot } from './use-mark-history';
import { SHAPES, ShapePicker } from './shape-picker';
import { MarkupZoomButtons, useMarkupZoom } from './markup-zoom';
import { PdfEngine, type PdfResult } from '../../../modules/pdf-engine';
import PdfMarkupView, { type PdfMark, type PdfMarkChange } from '../../../modules/pdf-engine/src/PdfMarkupView';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { listRecentSignatures, prepareImageSignature, rememberSignatures, removeRecentSignature, signaturePlacement, type RecentSignature } from './recent-signatures';
import { RecentSignatureButton, RecentSignaturesSheet } from './recent-signatures-view';
import { AppLoader } from '@/components/app-loader';
import { showDialog } from '@/components/app-dialog';
import { usePalette } from '@/theme/colors';
import { optionIcon, type OptionIcon } from '@/theme/editor-icons';
import { browseFiles, disposeImports, formatSize, savedPdfDirectory, shareFile, shareNamedFile, shareRenderedPdf, type LocalFile } from '../files/file-storage';
import { askNewFileName, saveEditedOutput, savePdfResult, saveToDevice } from '../files/save-file';
import { forgetRecentUri, rememberPdfResults } from '../files/recent-files';
import { usePdfScreenActive } from './use-pdf-screen-active';
import { openPdfResult } from './open-pdf-screen';
import type { PdfToolSession } from './pdf-tool-session';
import { PdfPagePreview, PdfPreviewBody, PdfPreviewStage, PdfPreviewToolbar, PdfPreviewFooter, PDF_PREVIEW_BACKGROUND, type PdfPreviewImage } from './pdf-preview';
import { PdfDocumentPreview } from './pdf-document-preview';
import { InsertPdfPreview } from './insert-pdf-preview';
import { RecognizedTextSheet } from './recognized-text-sheet';
import { useControlHelp } from '@/components/control-help';
import { usePdfToolLayout } from './pdf-tool-layout';
import { annotationCommands, PageAnnotationsPanel, type AnnotationEdit, type AnnotationEdits, type PdfAnnotation } from './page-annotations';

type Info = { pageCount: number; size: number; width: number; height: number; version: string; encrypted: boolean; title: string; author: string; subject: string; creator: string; producer: string };
type Output = PdfResult & { name: string };
type Response = { info?: Info; outputs?: (PdfResult & { width?: number; height?: number; pointWidth?: number; annotations?: PdfAnnotation[] })[]; estimatedSize?: number; ocrSummary?: { wordCount: number; pagesAdded: number; skippedPages: number; emptyPages: number }; textPreview?: string };
const markupTools = new Set(['highlight', 'draw', 'shapes', 'sign']);
const rangeTools = new Set(['duplicate', 'to_image', 'watermark', 'numbers', 'extract_text', 'ocr']);
const settingsTitles: Record<string, string> = {
  duplicate: 'Duplicate pages options', insert: 'Insert pages options',
  compress: 'Compression options', to_image: 'Export images options',
  repair: 'Repair PDF options', metadata: 'Remove metadata options', flatten: 'Flatten PDF options',
  ocr: 'Scan text settings', extract_text: 'Extract text settings',
  numbers: 'Page number settings', watermark: 'Watermark settings', protect: 'Password',
};
const qualityOptions: { id: string; label: string; icon: OptionIcon }[] = [
  { id: 'max', label: 'Max quality', icon: { ios: 'sparkles', android: 'high-quality' } },
  { id: 'balanced', label: 'Balanced', icon: { ios: 'scalemass', android: 'balance' } },
  { id: 'small', label: 'Smallest', icon: { ios: 'arrow.down.right.and.arrow.up.left', android: 'compress' } },
];
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
/** BottomSheetTextInput only works inside a sheet; it lets the sheet move above the keyboard. */
function FieldInput({ sheet, ...props }: TextInputProps & { sheet: boolean }) {
  return sheet ? <BottomSheetTextInput {...props} /> : <TextInput {...props} />;
}
/** `process` already shows its own error; this stops the share dialog repeating it. */
const SHARE_HANDLED = 'versara-share-handled';
const TEXT_SHEET_LIMIT = 2 * 1024 * 1024;
const guidance: Record<string, string> = {
  duplicate: 'Each selected page is copied immediately after its original.',
  insert: 'Add a blank page, or all pages from another PDF, anywhere in this document.',
  compress: 'Preserves text, links, forms and page content. Android can optimize suitable embedded images; iOS uses a lossless document rewrite. The original is kept if the result is larger.',
  to_image: 'Export selected pages as separate images. Up to 100 pages per export.',
  highlight: 'Drag across a passage to highlight it. Change pages to mark more passages.',
  draw: 'Draw directly on the page. Undo removes your last mark and returns to its page.',
  shapes: 'Choose a shape, then drag on the page. Use two fingers to zoom and pan.',
  sign: 'Draw your signature where it belongs on the page. This adds a visual signature, not a digital certificate.',
  watermark: 'Choose a position, text style and optional stamp outline. Preview updates as you adjust.',
  numbers: 'Choose placement and style, then preview before saving.',
  protect: 'Set a password required to open the output PDF. Keep it somewhere safe; Versara does not store it.',
  metadata: 'Remove document properties such as title, author and subject. Visible text, annotations and personal information written on pages are not redacted.',
  flatten: 'Rebuild pages as high-quality images with visible annotations and form values baked in. Text, links and forms will no longer be interactive.',
  ocr: 'Recognize English text offline. Export a text file or add searchable text to the original PDF pages. Clear, upright scans work best; review recognized text for errors.',
  extract_text: 'Export the existing text layer as a UTF-8 text file. For scanned pages, use Scan Text (OCR).',
  repair: 'Attempt to rewrite readable PDF structure and validate every output page. Severely damaged or missing content cannot be recovered.',
};
function pageRange(value: string, count: number): number[] {
  if (!value.trim()) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const part of value.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Use page numbers such as 1, 3, 5-8.');
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > count) throw new Error(`Choose pages between 1 and ${count}.`);
    for (let page = start; page <= end; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

export function AdvancedPdfTool({ session, onUnsavedChange, onDiscardReady }: { session: PdfToolSession; onUnsavedChange: (value: boolean) => void; onDiscardReady?: (action: () => Promise<void>) => void }) {
  const colors = usePalette();
  const controlHelp = useControlHelp();
  const active = usePdfScreenActive();
  const { tool, files, directory } = session;
  const source = files[0];
  const markup = markupTools.has(tool);
  const available = (PdfEngine?.nativeAdvancedToolsVersion ?? 0) >= (markup || tool === 'numbers' || tool === 'watermark' ? 2 : 1);
  const [info, setInfo] = useState<Info>();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [page, setPage] = useState((session.initialPage ?? 0) + 1);
  const [preview, setPreview] = useState<{ uri: string; page: number; width: number; height: number; key: string; annotations: PdfAnnotation[] }>();
  const annotationsAvailable = markup && !!PdfEngine?.nativeAnnotationsVersion;
  const [keepEditable, setKeepEditable] = useState(true);
  const [annotationEdits, setAnnotationEdits] = useState<AnnotationEdits>({});
  const [focused, setFocused] = useState<{ page: number; index: number }>();
  const focusAnnotation = focused?.page === page ? focused.index : undefined;
  const setFocusAnnotation = useCallback((index: number | undefined) => setFocused(index === undefined ? undefined : { page, index }), [page]);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const annotationEditCount = Object.keys(annotationEdits).length;
  const changeAnnotation = useCallback((key: string, edit: AnnotationEdit | undefined) => {
    setAnnotationEdits(current => { const next = { ...current }; if (edit) next[key] = edit; else delete next[key]; return next; });
    if (edit?.remove) setFocused(undefined);
  }, []);
  const signatureJob = useRef<string | undefined>(undefined);
  const [recentSignatures, setRecentSignatures] = useState<RecentSignature[]>([]);
  const [signaturesOpen, setSignaturesOpen] = useState(false);
  useEffect(() => {
    if (tool !== 'sign') return;
    let cancelled = false;
    void listRecentSignatures().then(list => { if (!cancelled) setRecentSignatures(list); });
    return () => { cancelled = true; };
  }, [tool]);
  const imageSignaturesAvailable = !!PdfEngine?.nativeSignatureImageVersion && !!FileEngine?.nativeSignatureImageVersion;
  const [previewRetry, setPreviewRetry] = useState(0);
  // Retry only appears after a render really failed, never in the gap before it starts.
  const [failedPreview, setFailedPreview] = useState('');
  const [inspectFailed, setInspectFailed] = useState(false);
  // The page area shows its own loader while a markup page renders.
  const [pageRendering, setPageRendering] = useState(false);
  const [ranges, setRanges] = useState('');
  const [position, setPosition] = useState('0');
  const [insert, setInsert] = useState<LocalFile>();
  const [insertCount, setInsertCount] = useState(0);
  const [quality, setQuality] = useState('balanced');
  const [format, setFormat] = useState('jpg');
  const [ocrFormat, setOcrFormat] = useState<'text' | 'pdf'>('text');
  const [skipExistingText, setSkipExistingText] = useState(true);
  const [estimate, setEstimate] = useState<{ quality: string; size: number }>();
  const [text, setText] = useState('');
  const [startNumber, setStartNumber] = useState('1');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const history = useMarkHistory();
  const { marks } = history;
  const [brushType, setBrushType] = useState('pen');
  const activeBrush = BRUSHES.find(item => item.id === brushType) ?? BRUSHES[0];
  const [pattern, setPattern] = useState('solid');
  const [selectingChosen, setSelecting] = useState(false);
  // Shapes are added from the picker; touching the page selects, moves, or scrolls instead of drawing.
  const placing = tool === 'shapes' && !!PdfEngine?.nativeMarkupPanVersion;
  const [erasing, setErasing] = useState(false);
  const selecting = selectingChosen || (placing && !erasing);
  const [inkOpacity, setInkOpacity] = useState(tool === 'highlight' ? .3 : 1);
  const [selectedId, setSelectedId] = useState<string>();
  const markupEditing = !!PdfEngine?.nativeMarkupEditingVersion;
  const landscape = usePdfToolLayout()?.landscape ?? false;
  const selectedMark = selecting ? marks.find(mark => mark.id === selectedId && mark.page === page) : undefined;
  function styleSelection(patch: Partial<PdfMark>) { if (selectedMark?.id) history.update(selectedMark.id, patch); }
  function selectMark(serialized: string) {
    if (!markupEditing) return;
    try {
      const mark = serialized ? JSON.parse(serialized) as PdfMark : null;
      setSelectedId(mark?.id);
      if (mark && mark.kind !== 'image') { setInkColor(mark.color); setInkWidth(mark.width); setInkOpacity(mark.opacity ?? (mark.kind.startsWith('highlight') || mark.brush === 'highlighter' ? .3 : mark.brush === 'pencil' ? 170/255 : mark.brush === 'marker' ? 210/255 : 1)); setFillColor(mark.fillColor ? parseInt(mark.fillColor.slice(1),16) : null); setBrushType(mark.brush ?? 'pen'); setPattern(mark.pattern ?? 'solid'); }
    } catch { setSelectedId(undefined); }
  }
  const [optionsOpen, setOptionsOpen] = useState(tool === 'protect');
  const [fullText, setFullText] = useState<{ text: string; truncated: boolean } | null>(null);
  const [textSheet, setTextSheet] = useState(false);
  const [brush, setBrush] = useState(false);
  const [fillColor, setFillColor] = useState<number | null>(null);
  const [showStyle, setShowStyle] = useState(false);
  const [numberStyle, setNumberStyle] = useState(DEFAULT_TEXT_STYLE);
  const [numberSize, setNumberSize] = useState(tool === 'watermark' ? '32' : '11');
  const [stampShape, setStampShape] = useState('none');
  const [stampOpacity, setStampOpacity] = useState('0.3');
  const [numberPosition, setNumberPosition] = useState(tool === 'watermark' ? 'middle-center' : 'bottom-center');
  const [numberFormat, setNumberFormat] = useState('number');
  const [numberMargin, setNumberMargin] = useState('24');
  const [numberPrefix, setNumberPrefix] = useState('');
  const [numberPreview, setNumberPreview] = useState<PdfPreviewImage & { page: number }>();
  const [showSourcePreview, setShowSourcePreview] = useState(false);
  const [shape, setShape] = useState('rectangle');
  const [inkColor, setInkColor] = useState(tool === 'highlight' ? '#FACC15' : '#1D4ED8');
  const [inkWidth, setInkWidth] = useState(tool === 'highlight' ? .025 : .005);
  const [results, setResults] = useState<Output[]>([]);
  const [textPreview, setTextPreview] = useState('');
  const [notice, setNotice] = useState('');
  const saveTitle = markup ? `Save PDF${marks.length + annotationEditCount ? ` (${marks.length + annotationEditCount})` : ''}` : tool === 'repair' ? 'Attempt repair' : tool === 'compress' ? 'Compress PDF' : tool === 'ocr' && ocrFormat === 'pdf' ? 'Create searchable PDF' : ['ocr', 'extract_text'].includes(tool) ? 'Export text' : tool === 'to_image' ? 'Export images' : 'Create PDF';
  const toolbar = useResponsiveEditorToolbar(markup ? ['Style', 'Select', ...(tool === 'highlight' ? [brush ? 'Brush' : 'Area'] : [])] : [tool === 'protect' ? 'Password' : 'Options'], [saveTitle], markup ? 2 : 0);
  const recovery = useEditorDraft({ id: markup && session.origin && info ? pdfDraftId(session.origin.uri, tool) : null, uri: session.origin?.uri, value: history.snapshot,
    dirty: !results.length && (marks.length > 0 || history.canRedo), validate: isMarkHistorySnapshot, restore: value => { history.restoreSnapshot(value); if (value.marks.length) setPage(Math.min(info?.pageCount ?? 1, value.marks.at(-1)!.page)); } });
  useEffect(() => { onDiscardReady?.(recovery.discard); }, [onDiscardReady, recovery.discard]);
  const [savedOutputs, setSavedOutputs] = useState<ReadonlySet<string>>(() => new Set());
  const [cancellable, setCancellable] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const job = useRef<string | undefined>(undefined);
  const initialized = useRef(false);
  const previewJob = useRef(false);
  const previewAttempt = useRef('');
  const secret = useRef(inputPassword);
  useEffect(() => { secret.current = inputPassword; }, [inputPassword]);
  useEffect(() => { onUnsavedChange(marks.length + annotationEditCount > 0 && results.length === 0); }, [marks.length, annotationEditCount, results.length, onUnsavedChange]);
  useEffect(() => {
    mounted.current = true;
    const listener = available ? PdfEngine?.addListener('onConversionProgress', event => { if (mounted.current && event.jobId === job.current) setProgress(event.total ? event.completed / event.total : 0); }) : undefined;
    return () => {
      mounted.current = false; listener?.remove();
      queueMicrotask(() => { if (mounted.current) return; if (signatureJob.current) FileEngine?.cancelImageJob(signatureJob.current); if (job.current) { PdfEngine?.cancelPdfTool(job.current); PdfEngine?.cancelTextEdit(job.current); } if (!locked.current) disposeImports(directory); });
    };
  }, [available, directory]);
  const process = useCallback(async (request: Record<string, unknown>, label: string): Promise<Response | undefined> => {
    if (!PdfEngine?.nativeAdvancedToolsVersion || locked.current) return;
    locked.current = true; const id = uid(); job.current = id; previewJob.current = request.operation === 'preview' || request.action === 'preview';
    setBusy(true); setCancellable(true); setPhase(label); setError(''); setProgress(0); setPageRendering(markup && previewJob.current);
    try {
      const payload = JSON.stringify({ uri: source.uri, inputPassword: secret.current, ...request });
      const raw = JSON.parse(await (request.nativeEditor ? PdfEngine.editPdfText(id, payload) : PdfEngine.processPdf(id, payload)));
      const result: Response = request.nativeEditor ? { outputs: [request.action === 'preview' ? { ...raw, uri: raw.imageUri } : raw] } : raw;
      return result;
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message || 'Could not process this PDF.');
    } finally {
      locked.current = false; job.current = undefined;
      if (mounted.current) { setBusy(false); setCancellable(false); setPhase(''); setPageRendering(false); } else disposeImports(directory);
    }
  }, [source.uri, directory, markup]);
  const inspect = useCallback(async () => {
    setInspectFailed(false);
    const result = await process({ operation: 'info' }, 'Reading document details…');
    if (!mounted.current) return;
    if (result?.info) { setInfo(result.info); setPosition(String(result.info.pageCount)); setPage(value => Math.min(value, result.info!.pageCount)); }
    else setInspectFailed(true);
  }, [process]);
  useEffect(() => { if (!active || !available || initialized.current) return; initialized.current = true; void inspect(); }, [active, available, inspect]);
  const pageAnnotationEdits = annotationsAvailable ? annotationCommands(annotationEdits, page) : [];
  const previewKey = `${page}|${JSON.stringify(pageAnnotationEdits)}|${focusAnnotation ?? ''}`;
  useEffect(() => {
    if (!active || !markup || !info || busy || results.length || preview?.key === previewKey || previewAttempt.current === previewKey) return;
    previewAttempt.current = previewKey;
    const output = new File(directory, `markup-${uid()}.png`);
    void process({ nativeEditor: true, action: 'preview', includeObjects: false, includeAnnotations: annotationsAvailable, focusAnnotation: focusAnnotation ?? -1, page: page - 1, imageUri: output.uri, edits: pageAnnotationEdits }, 'Preparing page…').then(result => {
      if (!mounted.current) return;
      if (!result?.outputs?.length) { if (previewAttempt.current === previewKey) setFailedPreview(previewKey); return; }
      const rendered = result.outputs[0];
      setPreview(previous => { if (previous) { try { new File(previous.uri).delete(); } catch { /* Session teardown retries. */ } } return { uri: output.uri, page, key: previewKey, width: rendered.width ?? 1, height: rendered.height ?? 1, annotations: rendered.annotations ?? [] }; });
    });
    // The page edits and focus are part of previewKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, markup, info, page, preview?.key, previewKey, previewRetry, busy, results.length, directory, process, annotationsAvailable]);
  useEffect(() => {
    if (!active && previewJob.current && job.current) { PdfEngine?.cancelPdfTool(job.current); PdfEngine?.cancelTextEdit(job.current); previewAttempt.current = ''; }
  }, [active, busy]);
  async function addSignatureImage() {
    if (locked.current || !imageSignaturesAvailable || !preview || !recovery.ready) return;
    const unique = new Set(marks.filter(mark => mark.kind === 'image').map(mark => mark.originalImageUri));
    if (unique.size >= 8 || marks.filter(mark => mark.kind === 'image').length >= 32) { setError('Use up to 8 signature images and 32 placements per PDF.'); return; }
    locked.current=true; setBusy(true); setPhase('Choose a signature image'); setError('');
    const folder = new Directory(Paths.document, 'Versara Signature Drafts');
    const assets: File[] = [];
    let accepted=false;
    try {
      const picked = (await browseFiles(directory,true,1))[0];
      if (!picked || !mounted.current) return;
      await pruneSignatureDraftAssets();
      if (!mounted.current) return;
      folder.create({intermediates:true,idempotent:true});
      if (folder.list().length >= 250) throw new Error('Save or discard existing signature drafts before adding another image.');
      const used = folder.list().reduce((sum,item) => sum+(item instanceof File ? item.size : 0),0);
      if (used + 16*1024*1024 > 64*1024*1024) throw new Error('Save or discard existing signature drafts before adding another image.');
      setPhase('Preparing your signature on this device');
      const prepare = async (uri: string, removeBackground: boolean) => {
        const output = new File(folder, `signature-${uid()}.png`); assets.push(output,new File(output.uri+'.bgra'));
        const key=uid(); signatureJob.current=key;
        return await FileEngine!.processImage(key,JSON.stringify({tool:'signature',uri,outputUri:output.uri,removeBackground})) as {uri:string;pixelPath:string;width:number;height:number};
      };
      const original = await prepare(picked.uri,false);
      if (!mounted.current) return;
      const clean = await prepare(original.uri,true);
      if (!mounted.current) return;
      const ratio = (original.height/original.width)*(preview.width/preview.height);
      const w=Math.min(.4,.3/ratio), h=w*ratio;
      const mark: PdfMark = { id:uid(),page,kind:'image',color:'#000000',width:.001,opacity:1,
        imageUri:original.uri,pixelPath:original.pixelPath,originalImageUri:original.uri,originalPixelPath:original.pixelPath,
        cleanImageUri:clean.uri,cleanPixelPath:clean.pixelPath,backgroundRemoved:false,
        points:[[(1-w)/2,(1-h)/2],[(1+w)/2,(1+h)/2]] };
      history.commit(mark); accepted=true; setSelecting(true); setErasing(false); setShowStyle(false); setSelectedId(undefined);
      setNotice('Drag the image to move it; drag a corner to resize. Remove background clears light paper.');
    } catch(cause) { if (mounted.current) setError((cause as Error).message || 'Could not add this signature image.'); }
    finally {
      if (!accepted) for (const asset of assets) try { if (asset.exists) asset.delete(); } catch { /* Retry with draft cleanup. */ }
      signatureJob.current=undefined; locked.current=false;
      if (mounted.current) { setBusy(false); setPhase(''); } else disposeImports(directory);
    }
  }
  async function applyRecentSignature(entry: RecentSignature) {
    if (locked.current || !preview || preview.page !== page || !recovery.ready) return;
    const place = signaturePlacement(entry, preview.width / Math.max(1, preview.height));
    setError('');
    if (entry.kind === 'drawn') {
      const strokes: PdfMark[] = entry.strokes.map(stroke => ({ ...stroke, id: uid(), page, signatureId: entry.id,
        points: stroke.points.map(([x, y]) => [place.left + x * place.width, place.top + y * place.height] as [number, number]) }));
      if (!history.commitGroup(strokes)) { setError('This page has too many marks to add the signature.'); return; }
      setSelecting(false); setErasing(false); setSelectedId(undefined);
      return;
    }
    const images = marks.filter(mark => mark.kind === 'image');
    if (new Set(images.map(mark => mark.originalImageUri)).size >= 8 || images.length >= 32) { setError('Use up to 8 signature images and 32 placements per PDF.'); return; }
    locked.current = true; setBusy(true); setPhase('Adding your signature');
    try {
      const asset = await prepareImageSignature(entry);
      if (!mounted.current) return;
      const mark: PdfMark = { id: uid(), page, kind: 'image', color: '#000000', width: .001, opacity: 1, signatureId: entry.id,
        imageUri: asset.uri, pixelPath: asset.pixelPath, originalImageUri: asset.uri, originalPixelPath: asset.pixelPath, cleanImageUri: asset.uri, cleanPixelPath: asset.pixelPath,
        backgroundRemoved: entry.backgroundRemoved, points: [[place.left, place.top], [place.left + place.width, place.top + place.height]] };
      history.commit(mark); setSelecting(true); setErasing(false); setShowStyle(false); setSelectedId(undefined);
    } catch (cause) { if (mounted.current) setError((cause as Error).message || 'Could not add this signature.'); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); setPhase(''); } }
  }
  async function pickInsert() {
    if (locked.current) return;
    setOptionsOpen(false);
    locked.current = true; setBusy(true); setError('');
    let picked: LocalFile | undefined;
    let accepted = false;
    try {
      picked = (await browseFiles(directory, false, 1, true))[0];
      if (!picked || !mounted.current) return;
      if (!PdfEngine) throw new Error('Install the latest app build to insert PDF pages.');
      const id = uid(); job.current = id;
      setPhase('Reading inserted PDF...'); setCancellable(true);
      const response = JSON.parse(await PdfEngine.processPdf(id, JSON.stringify({ operation: 'info', uri: picked.uri }))) as Response;
      if (!mounted.current) return;
      if (!response.info || response.info.pageCount < 1 || response.info.encrypted) throw new Error('Choose an unrestricted PDF with at least one page.');
      if (!info || info.pageCount + response.info.pageCount > 2000) throw new Error('Keep the result below 2,001 pages.');
      // Older sources remain in the session directory until preview jobs release them on teardown.
      setInsert(picked); setInsertCount(response.info.pageCount); accepted = true;
    }
    catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally {
      if (picked && !accepted) try { new File(picked.uri).delete(); } catch { /* Session cleanup retries. */ }
      locked.current = false; job.current = undefined;
      if (mounted.current) { setBusy(false); setCancellable(false); setPhase(''); } else disposeImports(directory);
    }
  }
  async function estimateSize() {
    const result = await process({ operation: 'estimate', quality }, 'Estimating from sample pages…');
    if (mounted.current && result?.estimatedSize != null) setEstimate({ quality, size: result.estimatedSize });
  }
  function numberCommands() {
    if (!info) return [];
    if (!/^\d+$/.test(startNumber) || Number(startNumber) > 1_000_000) throw new Error('Start numbering between 0 and 1,000,000.');
    if (!Number.isFinite(Number(numberSize)) || Number(numberSize) < 4 || Number(numberSize) > 72) throw new Error('Choose a font size from 4 to 72 pt.');
    if (!Number.isFinite(Number(numberMargin)) || Number(numberMargin) < 0 || Number(numberMargin) > 144) throw new Error('Choose a margin from 0 to 144 pt.');
    const selected = pageRange(ranges, info.pageCount);
    return selected.map((number, index) => {
      const value = Number(startNumber) + index;
      const label = numberFormat === 'total' ? `${value} of ${Number(startNumber) + selected.length - 1}` : numberFormat === 'page' ? `Page ${value}` : String(value);
      return { kind: 'number', page: number - 1, text: `${numberPrefix}${label}`, position: numberPosition, margin: Number(numberMargin), font: fontName(numberStyle), fontFile: fontFile(fontName(numberStyle)), size: Number(numberSize), underline: numberStyle.underline, color: parseInt(inkColor.slice(1), 16) };
    });
  }
  function watermarkCommands(): Record<string, unknown>[] {
    if (!info) return [];
    if (!text.trim()) throw new Error('Enter watermark text to preview it.');
    if (!Number.isFinite(Number(numberSize)) || Number(numberSize) < 4 || Number(numberSize) > 72) throw new Error('Choose a font size from 4 to 72 pt.');
    const x = numberPosition.endsWith('left') ? .2 : numberPosition.endsWith('right') ? .8 : .5;
    const y = numberPosition.startsWith('top') ? .13 : numberPosition.startsWith('bottom') ? .87 : .5;
    return pageRange(ranges, info.pageCount).flatMap(number => {
      const commands: Record<string, unknown>[] = [];
      const shape = SHAPES.find(item => item.id === stampShape);
      if (shape) commands.push({ kind: 'mark', shape: 'polygon', page: number - 1, brush: 'highlighter', color: inkColor, fillColor: '', width: .003, points: shape.points.map(([px,py]) => [x + (px-.5)*.3, y + (py-.5)*.16]) });
      commands.push({ kind: 'number', page: number - 1, text: text.trim(), position: numberPosition, margin: 36, size: Number(numberSize), font: fontName(numberStyle), fontFile: fontFile(fontName(numberStyle)), underline: numberStyle.underline, color: parseInt(inkColor.slice(1),16), opacity: Number(stampOpacity) });
      return commands;
    });
  }
  async function previewNumbers(target = page) {
    if (locked.current) return;
    try {
      // Without watermark text the plain page still renders, so there is always a page to look at.
      const commands = tool === 'watermark' ? (text.trim() ? watermarkCommands() : []) : numberCommands();
      const output = new File(directory, `number-preview-${uid()}.png`);
      const response = await process({ nativeEditor: true, action: 'preview', includeObjects: false, page: target - 1, edits: commands.filter(command => command.page === target - 1), imageUri: output.uri }, 'Preparing page...');
      if (mounted.current && response?.outputs?.length) {
        if (numberPreview) { try { new File(numberPreview.uri).delete(); } catch { /* Session cleanup. */ } }
        const rendered = response.outputs[0];
        if (!rendered.width || !rendered.height) throw new Error('The preview has no page dimensions. Try again.');
        setNumberPreview({ uri: output.uri, page: target, width: rendered.width, height: rendered.height, pointWidth: rendered.pointWidth }); setPage(target);
      }
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
  }
  function markupEdits() {
    // Image signatures always go into the page content: stamp annotations are skipped by Android's
    // system PdfRenderer and some other viewers, so the signature would disappear after saving.
    return [...marks.map(mark => ({ ...mark, page: mark.page - 1, shape: mark.kind, kind: mark.kind === 'image' ? 'image' : 'mark', annotation: annotationsAvailable && keepEditable && mark.kind !== 'image' })), ...(annotationsAvailable ? annotationCommands(annotationEdits) : [])];
  }
  /** Shares a single result, otherwise a copy with the current marks or page labels, otherwise the original. */
  async function shareCurrent() {
    if (locked.current) return;
    if (results.length) { await shareFile({ uri: results[0].uri, mimeType: mime(results[0]) }); return; }
    const edits = markup ? (marks.length || annotationEditCount ? markupEdits() : []) : tool === 'numbers' && info ? numberCommands() : tool === 'watermark' && info && text.trim() ? watermarkCommands() : [];
    if (!edits.length) { await shareNamedFile({ ...source, mimeType: 'application/pdf' }); return; }
    await shareRenderedPdf(`${source.name.replace(/\.pdf$/i, '').slice(0, 80)} - edited.pdf`, async outputUri => {
      const response = await process({ nativeEditor: true, action: 'save', outputUri, edits }, 'Preparing the edited PDF...');
      if (!response?.outputs) throw new Error(SHARE_HANDLED);
    }).catch(cause => { if ((cause as Error).message !== SHARE_HANDLED) throw cause; });
  }
  const pendingShare = markup ? marks.length + annotationEditCount > 0 : tool === 'numbers' || (tool === 'watermark' && !!text.trim());
  usePublishHeaderShare({ disabled: busy || results.length > 1, onShare: shareCurrent,
    label: results.length > 1 ? 'Share each file from its card' : results.length ? 'Share result' : pendingShare ? 'Share edited PDF' : 'Share PDF',
    save: { label: results.length > 1 ? 'Save each file from its card' : results.length ? 'Save result to device' : saveTitle,
      disabled: busy || !info || (results.length ? results.length > 1 : !recovery.ready || (markup ? !marks.length && !annotationEditCount : tool === 'compress' && estimate?.quality !== quality)),
      onSave: () => results.length === 1 ? save(results[0]) : results.length ? undefined : run() } });
  // Without a selection, the size buttons act on the newest shape so a tiny one can grow straight after drawing.
  const resizeTarget = selectedMark ?? (tool === 'shapes' && !selecting && !erasing ? marks.findLast(mark => mark.page === page && (mark.kind === 'polygon' || mark.kind === 'line')) : undefined);
  const markupZoom = useMarkupZoom(`${page}:${previewRetry}:${preview?.uri ?? ''}`);
  function undoMark() { if (!busy) { const target = history.undo(); if (target) setPage(target); } }
  function redoMark() { if (!busy) { const target = history.redo(); if (target) setPage(target); } }
  async function run() {
    if (!info || locked.current || !recovery.ready) return;
    Keyboard.dismiss(); setError('');
    try {
      const selected = markup ? [...new Set(marks.map(mark => mark.page))].sort((a, b) => a - b) : pageRange(ranges, info.pageCount);
      if (markup && !marks.length && !annotationEditCount) throw new Error('Add a mark to the page first.');
      if (tool === 'to_image' && selected.length > 100) throw new Error('Export up to 100 pages at a time.');
      if (tool === 'protect' && (password !== confirmation || !/^[\x20-\x7e]{6,64}$/.test(password))) { setOptionsOpen(true); throw new Error('Enter matching passwords with 6–64 English letters, numbers or symbols.'); }
      if (tool === 'watermark' && !/^[\x20-\x7e]{1,100}$/.test(text.trim())) throw new Error('Enter a label with up to 100 English letters, numbers or symbols.');
      if (tool === 'insert' && (!/^\d+$/.test(position) || Number(position) > info.pageCount)) throw new Error(`Choose an insertion position from 0 to ${info.pageCount}.`);
      if (tool === 'numbers' && (!/^\d+$/.test(startNumber) || Number(startNumber) > 1_000_000)) throw new Error('Start numbering between 0 and 1,000,000.');
      const numbered = tool === 'numbers' ? numberCommands() : tool === 'watermark' ? watermarkCommands() : [];
      if (tool === 'ocr' && ocrFormat === 'pdf' && (!PdfEngine?.nativeSearchableOcrVersion || selected.length > 100)) throw new Error(!PdfEngine?.nativeSearchableOcrVersion ? 'Update the native app build to create searchable PDFs.' : 'Choose up to 100 pages for searchable PDF output.');
      const extension = tool === 'to_image' ? format : tool === 'ocr' ? (ocrFormat === 'pdf' ? 'pdf' : 'txt') : tool === 'extract_text' ? 'txt' : 'pdf';
      const base = source.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 70);
      locked.current = true; setBusy(true);
      const name = await askNewFileName(`${base} - ${tool.replace(/_/g, ' ')}.${extension}`);
      locked.current = false;
      if (!name || !mounted.current) { if (mounted.current) setBusy(false); else disposeImports(directory); return; }
      const outputDirectory = savedPdfDirectory(); outputDirectory.create({ intermediates: true, idempotent: true });
      const names = tool === 'to_image' ? selected.map(page => name.replace(/\.[^.]+$/, ` - page ${page}.${extension}`)) : [name];
      const outputUris = names.map((suggested, index) => {
        let candidate = suggested, suffix = 2;
        while (new File(outputDirectory, candidate).exists) candidate = suggested.replace(/\.[^.]+$/, ` (${suffix++}).${extension}`);
        names[index] = candidate;
        return new File(outputDirectory, candidate).uri;
      });
      const result = await process({ ...(markup || tool === 'numbers' || tool === 'watermark' ? { nativeEditor: true, action: 'save', outputUri: outputUris[0], edits: markup ? markupEdits() : numbered } : {}), operation: tool, outputUris, pages: selected, quality, format, ocrFormat, skipExistingText, position: Number(position), insertUri: insert?.uri ?? '', text: text.trim(), startNumber: Number(startNumber), password, marks }, 'Processing on your device…');
      if (!result?.outputs) return;
      const outputs = result.outputs.map((output, i) => ({ ...output, name: names[i] }));
      if (extension === 'pdf') await rememberPdfResults(outputs).catch(() => {});
      if (tool === 'sign' && marks.length) void rememberSignatures(marks, preview ? preview.width / Math.max(1, preview.height) : 1 / Math.SQRT2)
        .then(list => { if (mounted.current) setRecentSignatures(list); }, () => {});
      await recovery.clear();
      if (mounted.current && result.ocrSummary) { const stats = result.ocrSummary; setNotice(`${stats.wordCount} words added on ${stats.pagesAdded} pages. ${stats.skippedPages} pages already had selectable text; ${stats.emptyPages} pages had no recognized text. Check OCR results before relying on them.`); }
      if (mounted.current && extension === 'txt' && outputs[0]) {
        const exported = new File(outputs[0].uri);
        // Very long exports stay in the file; the sheet shows the native preview instead.
        const preview = { text: result.textPreview ?? '', truncated: true };
        const recognized = exported.size <= TEXT_SHEET_LIMIT ? await exported.text().then(text => ({ text, truncated: false }), () => preview) : preview;
        if (mounted.current) { setFullText(recognized); setTextSheet(true); }
      }
      if (mounted.current) { setSavedOutputs(new Set()); setResults(outputs); setTextPreview(result.textPreview ?? ''); setPassword(''); setConfirmation(''); history.clear(); setAnnotationEdits({}); setFocusAnnotation(undefined); }
    } catch (cause) { locked.current = false; if (mounted.current) { setError((cause as Error).message); setBusy(false); } else disposeImports(directory); }
  }
  async function save(output: Output) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (output.name.endsWith('.pdf')) {
        const saved = await savePdfResult(output, session.origin);
        if (saved && mounted.current) { setSavedOutputs(current => new Set(current).add(saved.file.uri)); setResults(current => current.map(item => item.uri === output.uri ? { ...item, uri: saved.file.uri, name: saved.file.name } : item)); }
      } else {
        const name = await askNewFileName(output.name);
        if (name) {
          const saved = output.name.endsWith('.txt') ? await saveToDevice(output.uri, name, mime(output)) : (await saveEditedOutput({ output: output.uri, mimeType: mime(output), kind: 'image', mode: 'new', name })).device;
          if (mounted.current) setSavedOutputs(current => new Set(current).add(output.uri));
          if (mounted.current) setNotice(`Saved to ${saved.location}`);
        }
      }
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { locked.current = false; if (mounted.current) setBusy(false); else disposeImports(directory); }
  }
  function mime(output: Output) { return output.name.endsWith('.pdf') ? 'application/pdf' : output.name.endsWith('.txt') ? 'text/plain' : output.name.endsWith('.png') ? 'image/png' : 'image/jpeg'; }
  async function share(output: Output) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await shareFile({ uri: output.uri, mimeType: mime(output) }); }
    catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { locked.current = false; if (mounted.current) setBusy(false); else disposeImports(directory); }
  }
  function deleteOutput(output: Output) {
    if (locked.current || savedOutputs.has(output.uri)) return;
    showDialog('Delete this output?', `Delete “${output.name}” from Versara? Your original PDF stays unchanged.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        if (!mounted.current || locked.current) return;
        try {
          const file = new File(output.uri);
          if (file.parentDirectory.uri !== savedPdfDirectory().uri) throw new Error('Only generated outputs can be deleted here.');
          if (file.exists) file.delete();
          void forgetRecentUri(output.uri).catch(() => {});
          setResults(current => current.filter(item => item.uri !== output.uri));
        } catch (cause) { setError((cause as Error).message); }
      } },
    ]);
  }
  function addMark(serialized: string) {
    if (!recovery.ready) return;
    try {
      const mark = JSON.parse(serialized) as PdfMarkChange;
      if ('deleted' in mark) { history.commit(mark); return; }
      const total = marks.filter(item => item.id !== mark.id).reduce((sum, item) => sum + item.points.length, 0);
      if ((!marks.some(item => item.id === mark.id) && marks.length >= 300) || total + mark.points.length > 20_000) {
        setError('Save these annotations before adding more.');
        // Remount to discard the just-finished native stroke that exceeds the session budget.
        setPreviewRetry(value => value + 1);
        return;
      }
      history.commit({ ...mark, page });
    } catch { setError('Could not record this mark. Please draw it again.'); }
  }
  /** Adds the picked shape in the middle of the page, selected so it can be moved and resized. */
  function placeShape(id: string) {
    setShape(id);
    if (!placing || !preview || preview.page !== page) return;
    const template = SHAPES.find(item => item.id === id)?.points ?? SHAPES[0].points;
    // A third of the page width, drawn square on screen.
    const width = 0.3, height = Math.min(0.5, width * preview.width / Math.max(1, preview.height));
    const points = template.map(([x, y]) => [0.5 - width / 2 + x * width, 0.5 - height / 2 + y * height]);
    const mark = { id: uid(), kind: id === 'line' ? 'line' : 'polygon', brush: brushType, pattern, color: inkColor, fillColor: fillColor === null ? '' : hexColor(fillColor), width: inkWidth, points, ...(markupEditing ? { opacity: inkOpacity } : {}) };
    setErasing(false); setSelectedId(mark.id);
    addMark(JSON.stringify(mark));
  }
  const styledPreviewKey = JSON.stringify([tool, page, ranges, startNumber, numberStyle, numberSize, numberPosition, numberFormat, numberMargin, numberPrefix, inkColor, text, stampShape, stampOpacity]);
  const lastStyledPreview = useRef('');
  const refreshStyledPreview = useRef(previewNumbers);
  useEffect(() => { refreshStyledPreview.current = previewNumbers; });
  useEffect(() => {
    if (!active || !info || busy || results.length || !['numbers', 'watermark'].includes(tool) || lastStyledPreview.current === styledPreviewKey) return;
    const timer = setTimeout(() => { lastStyledPreview.current = styledPreviewKey; void refreshStyledPreview.current(); }, 300);
    return () => clearTimeout(timer);
  }, [active, info, busy, results.length, tool, styledPreviewKey]);
  const inputStyle = [styles.input, { color: colors.label, backgroundColor: colors.secondarySystemBackground, borderColor: colors.borderHighlight }];
  // Fields in a bottom sheet use the sheet's input so the sheet rises above the keyboard.
  const field = (label: string, value: string, setter: (value: string) => void, numeric = false, secure = false, sheet = true) => <View style={styles.field}><ThemedText style={styles.label}>{label}</ThemedText><FieldInput sheet={sheet} accessibilityLabel={label} editable={!busy} value={value} onChangeText={setter} keyboardType={numeric ? 'number-pad' : 'default'} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} maxLength={secure ? 64 : 100} style={inputStyle} /></View>;
  const choices = (items: { id: string; label: string; icon?: OptionIcon }[], selected: string, choose: (value: string) => void) => <View style={styles.choices}>{items.map(item => <EditorOption key={item.id} label={item.label} icon={item.icon} selected={selected === item.id} disabled={busy} onPress={() => choose(item.id)} />)}</View>;
  const status = <>{busy && !pageRendering && <View style={styles.status}><AppLoader /><ThemedText accessibilityLiveRegion="polite">{phase || 'Please wait…'}{progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}</ThemedText>{cancellable && <ToolButton title="Cancel" secondary onPress={() => { if (signatureJob.current) FileEngine?.cancelImageJob(signatureJob.current); if (job.current) { PdfEngine?.cancelPdfTool(job.current); PdfEngine?.cancelTextEdit(job.current); } }} />}</View>}{!!error && <ThemedText accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</ThemedText>}{!!recovery.error && <ThemedText accessibilityRole="alert">{recovery.error}</ThemedText>}{!!notice && <ThemedText accessibilityLiveRegion="polite">{notice}</ThemedText>}</>;
  if (!available) return <View style={styles.content}><ThemedText>Install a new development build to use these native PDF tools on this device.</ThemedText></View>;
  if (results.length) return <ScrollView contentContainerStyle={styles.content}>{status}<ThemedText style={styles.heading}>{tool === 'repair' ? 'Rewritten and validated' : 'Your files are ready'}</ThemedText>{tool === 'compress' && <ThemedText>Original {formatSize(source.size)} · Result {formatSize(results[0].size)}{results[0].size >= source.size ? ' — no size reduction for this document.' : ` — ${Math.round((1 - results[0].size / source.size) * 100)}% smaller.`}</ThemedText>}{results.map(output => <View key={output.uri} style={[styles.result, { backgroundColor: colors.secondarySystemBackground }]}><ThemedText style={styles.label}>{output.name}</ThemedText><ThemedText>{formatSize(output.size)}</ThemedText>{output.name.endsWith('.pdf') && tool !== 'protect' && <ToolButton title="Open PDF" disabled={busy} onPress={() => openPdfResult(output, session.returnRoute)} />}{tool === 'protect' && <ThemedText>Use the password you set when opening this file in a password-capable PDF reader.</ThemedText>}<View style={styles.choices}><ToolButton title="Save to device" disabled={busy} onPress={() => void save(output)} /><ToolButton title="Share" secondary disabled={busy} onPress={() => void share(output)} /></View>{!savedOutputs.has(output.uri) && <ToolButton title="Delete output" secondary disabled={busy} onPress={() => deleteOutput(output)} />}</View>)}{fullText ? <ToolButton title="View and copy text" icon={{ ios: 'doc.on.doc', android: 'content-copy' }} disabled={busy} onPress={() => setTextSheet(true)} />
    : !!textPreview && <View style={styles.field}><ThemedText style={styles.label}>Text preview</ThemedText><ThemedText selectable>{textPreview}</ThemedText><ThemedText>The exported file contains the full text.</ThemedText></View>}
    <ToolButton title="Run again" secondary disabled={busy} onPress={() => { setResults([]); setTextPreview(''); setNotice(''); setFullText(null); setTextSheet(false); }} />
    {fullText && <RecognizedTextSheet text={fullText.text} truncated={fullText.truncated} isPresented={textSheet} onClose={() => setTextSheet(false)} />}</ScrollView>;
  if (!info && !inspectFailed) return <View style={styles.loadingScreen}><AppLoader size="large" /><ThemedText accessibilityLiveRegion="polite">Opening PDF…</ThemedText><ThemedText numberOfLines={2} style={{ color: colors.secondaryLabel, textAlign: 'center' }}>{source.name}</ThemedText></View>;
  if (!info) return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{status}<ThemedText style={styles.label}>{source.name}</ThemedText>{!busy && <>{field('Document password (if required)', inputPassword, setInputPassword, false, true, false)}<ToolButton title="Open document" onPress={() => void inspect()} /></>}</ScrollView>;
  if (showSourcePreview) return <PdfDocumentPreview uri={source.uri} count={info.pageCount} initialPage={page} inputPassword={inputPassword} onClose={() => setShowSourcePreview(false)} />;
  if (tool === 'info') return <ScrollView contentContainerStyle={styles.content}>{status}<ToolButton title="Preview PDF" secondary onPress={() => setShowSourcePreview(true)} /><ThemedText style={styles.heading}>{source.name}</ThemedText>{Object.entries({ Pages: info.pageCount, Size: formatSize(info.size), 'First page': `${Math.round(info.width)} × ${Math.round(info.height)} pt`, 'PDF version': info.version, Encrypted: info.encrypted ? 'Yes' : 'No', Title: info.title || '—', Author: info.author || '—', Subject: info.subject || '—', Creator: info.creator || '—', Producer: info.producer || '—' }).map(([key, value]) => <View key={key} style={styles.field}><ThemedText style={{ color: colors.secondaryLabel }}>{key}</ThemedText><ThemedText selectable>{value}</ThemedText></View>)}</ScrollView>;
  const renderSettings = (content: ReactNode) => <OptionSheet title={settingsTitles[tool] ?? 'PDF options'} icon={tool === 'protect' ? { ios: 'lock', android: 'lock' } : { ios: 'slider.horizontal.3', android: 'tune' }} isPresented={optionsOpen} keyboardInput dim={!['numbers', 'watermark'].includes(tool)} onClose={() => setOptionsOpen(false)}>
      <OptionCard>{content}</OptionCard>
    </OptionSheet>;
  const settingsAction = <EditorOption label={tool === 'protect' ? 'Password' : 'Options'} icon={tool === 'protect' ? { ios: 'lock', android: 'lock' } : { ios: 'slider.horizontal.3', android: 'tune' }} compact accessibilityLabel={tool === 'protect' ? 'Set the password' : 'Open advanced PDF options'} selected={optionsOpen} disabled={busy} onPress={() => { Keyboard.dismiss(); setOptionsOpen(value => !value); }} />;
  const toolActions = <View style={responsiveToolbarStyles.tools}>
    {markup ? <>
      {(tool === 'draw' || tool === 'sign' || tool === 'highlight') && <EditorMenu iconOnly tintedItems grid={3} label={tool === 'highlight' && !brush ? 'Brush: Area highlight' : `Brush: ${activeBrush.label}`} icon={tool === 'highlight' && !brush ? optionIcon('Area highlight') : optionIcon(activeBrush.label)} colorKey={activeBrush.colorKey} disabled={busy || selectedMark?.kind === 'image'} items={[
        ...(tool === 'highlight' ? [{ id: 'area', label: 'Area highlight', colorKey: 'compress', selected: !brush && !erasing, onPress: () => { setBrush(false); setSelecting(false); setErasing(false); } }] : []),
        ...BRUSHES.map(item => ({ id: item.id, label: item.label, colorKey: item.colorKey, selected: brushType === item.id && !erasing && (tool !== 'highlight' || brush), onPress: () => { setErasing(false); setSelecting(false); setBrushType(item.id); setInkWidth(item.width); setInkOpacity(item.opacity); styleSelection({ brush: item.id, width: item.width, opacity: item.opacity }); if (tool === 'highlight') setBrush(true); } })),
      ]} />}
      {tool === 'shapes' && !placing && <ShapePicker iconOnly value={shape} onChange={setShape} disabled={busy} />}
      <ToolRowButton label="Style and colour" icon={{ ios: 'paintpalette', android: 'palette' }} selected={showStyle} expanded={showStyle} disabled={busy || selectedMark?.kind === 'image'} onPress={() => { setShowStyle(value => !value); setShowAnnotations(false); setFocusAnnotation(undefined); }} />
      {markupEditing && <ToolRowButton label={erasing ? 'Stop erasing' : 'Stroke eraser'} icon={{ ios: 'eraser', android: 'auto-fix-normal' }} selected={erasing} disabled={busy} onPress={() => { setErasing(value => !value); setSelecting(false); }} />}
      <ToolRowButton label={annotationsAvailable ? (showAnnotations ? 'Hide page annotations' : 'Edit page annotations') : 'Edit page annotations, update the app to use this'} icon={{ ios: 'text.bubble', android: 'comment' }} selected={showAnnotations} disabled={busy || !annotationsAvailable} onPress={() => { setShowAnnotations(value => !value); setShowStyle(false); setFocusAnnotation(undefined); }} />
    </> : settingsAction}
  </View>;
  const changePage = (target: number) => { if (numberPreview) void previewNumbers(target); else setPage(target); };
  // Encrypted sources cannot be thumbnailed without their password.
  const pageList = inputPassword ? null : { uri: source.uri, count: info.pageCount, page: page - 1, onSelect: (target: number) => { if (!busy) changePage(target + 1); } };
  const pageControls = <PdfPreviewToolbar history={markup} page={page} count={info.pageCount} disabled={busy} onPageChange={changePage} below={markup ? toolActions : undefined}>{!markup && !toolbar.atBottom ? toolActions : undefined}</PdfPreviewToolbar>;
  const strokeWidth = (tool !== 'highlight' || brush) && <View style={styles.choices}>
    <ToolButton title="-" secondary disabled={busy || inkWidth <= .001} onPress={() => { const width = Math.max(.001, inkWidth - .001); setInkWidth(width); styleSelection({ width }); }} />
    <ThemedText style={styles.grow}>{tool === 'shapes' ? 'Border' : 'Thickness'} {Math.round(inkWidth * 1000)}</ThemedText>
    <ToolButton title="+" secondary disabled={busy || inkWidth >= .06} onPress={() => { const width = Math.min(.06, inkWidth + .002); setInkWidth(width); styleSelection({ width }); }} />
  </View>;
  const markupLower = <>
    {markupEditing && selectedMark?.id && <View style={styles.choices}>
      <EditorOption label="Duplicate" disabled={busy || marks.length >= 300 || (selectedMark.kind === 'image' && marks.filter(mark => mark.kind === 'image').length >= 32)} onPress={() => { const id = history.duplicate(selectedMark.id!); if (!id) setError('Save before adding more marks.'); }} />
      <EditorOption label="Delete" disabled={busy} onPress={() => { history.remove(selectedMark.id!); setSelectedId(undefined); }} />
    </View>}
    {showAnnotations && annotationsAvailable && <PageAnnotationsPanel annotations={preview?.page === page ? preview.annotations : []} page={page} edits={annotationEdits} focus={focusAnnotation} disabled={busy} onFocus={setFocusAnnotation} onChange={changeAnnotation} />}
    <OptionSheet title={tool === 'shapes' ? 'Shape style' : 'Style and colour'} icon={{ ios: 'paintbrush', android: 'brush' }} isPresented={showStyle && !showAnnotations && selectedMark?.kind !== 'image'} dim={false} onClose={() => setShowStyle(false)}>
      {(tool === 'draw' || tool === 'sign' || tool === 'highlight' && brush) && <OptionCard title="Brush" icon={{ ios: 'paintbrush.pointed', android: 'brush' }}>
        <BrushControls showSelectors={false} patternsAvailable={!!PdfEngine?.nativeStrokePatternsVersion} brush={brushType} pattern={pattern} disabled={busy} editingAvailable={markupEditing} opacity={inkOpacity} onOpacity={value => { setInkOpacity(value); styleSelection({ opacity: value }); }} erasing={erasing} onEraser={() => { setErasing(value => !value); setSelecting(false); }} onBrush={(value, width, opacity) => { setErasing(false); setBrushType(value); setInkWidth(width); setInkOpacity(opacity); styleSelection({ brush: value, width, opacity }); }} onPattern={value => { setPattern(value); styleSelection({ pattern: value }); }} />
        {strokeWidth}
      </OptionCard>}
      {tool === 'shapes' && shape !== 'line' && <OptionCard title="Fill" icon={{ ios: 'drop.fill', android: 'format-color-fill' }}>
        <ColorSwatches value={fillColor} onChange={value => { setFillColor(value); styleSelection({ fillColor: value === null ? '' : hexColor(value) }); }} original={{ label: 'None', value: null }} disabled={busy} />
      </OptionCard>}
      <OptionCard title={tool === 'shapes' ? 'Border' : 'Ink colour'} icon={{ ios: tool === 'shapes' ? 'square.dashed' : 'paintpalette', android: tool === 'shapes' ? 'border-style' : 'palette' }}>
        <ColorSwatches value={parseInt(inkColor.slice(1), 16)} onChange={value => { const color = hexColor(value ?? 0); setInkColor(color); styleSelection({ color }); }} disabled={busy} />
        {(tool === 'shapes' || !(tool === 'draw' || tool === 'sign' || tool === 'highlight' && brush)) && strokeWidth}
      </OptionCard>
      {(tool !== 'highlight' || brush) && <OptionCard title="Line style" icon={{ ios: 'line.3.horizontal', android: 'line-style' }}>
        <View style={styles.choices}>{['solid', 'dashed', 'dotted'].map(value => <EditorOption key={value} label={`${value[0].toUpperCase()}${value.slice(1)}`} selected={pattern === value} disabled={busy || (value !== 'solid' && !PdfEngine?.nativeStrokePatternsVersion)} onPress={() => { setPattern(value); styleSelection({ pattern: value }); }} />)}</View>
        {!PdfEngine?.nativeStrokePatternsVersion && <ThemedText style={{ fontSize: 12 }}>Update the app build to use dashed and dotted lines.</ThemedText>}
      </OptionCard>}
      <OptionCard title="When saving" icon={{ ios: 'square.and.arrow.down', android: 'save' }}>
        <EditorOption label="Keep new marks editable in other PDF apps" selected={annotationsAvailable && keepEditable} disabled={busy || !annotationsAvailable} onPress={() => setKeepEditable(value => !value)} />
        {!annotationsAvailable && <ThemedText style={{ fontSize: 12 }}>Update the app build to keep marks editable.</ThemedText>}
        {marks.some(mark => mark.kind === 'image') && <ThemedText style={{ fontSize: 12 }}>Image signatures are always added to the page so every PDF viewer shows them.</ThemedText>}
      </OptionCard>
    </OptionSheet>
    <PdfPreviewFooter>{status}
    {tool === 'sign' && <View style={styles.choices}>
      <EditorOption label="Draw signature" icon={{ios:'signature',android:'draw'}} selected={!selecting} disabled={busy} onPress={() => { setSelecting(false);setErasing(false);setSelectedId(undefined); }} />
      <EditorOption label="Add image" icon={{ios:'photo.badge.plus',android:'add-photo-alternate'}} disabled={busy || !imageSignaturesAvailable || !recovery.ready || preview?.page !== page} onPress={() => void addSignatureImage()} />
      {recentSignatures.slice(0, 2).map(entry => <RecentSignatureButton key={entry.id} entry={entry} disabled={busy || !recovery.ready || preview?.page !== page || (entry.kind === 'image' && !imageSignaturesAvailable)} onPress={item => void applyRecentSignature(item)} />)}
      {recentSignatures.length > 0 && <EditorOption label="Recent" icon={{ ios: 'clock.arrow.circlepath', android: 'history' }} disabled={busy} onPress={() => setSignaturesOpen(true)} />}
      {selectedMark?.kind === 'image' && selectedMark.originalImageUri !== selectedMark.cleanImageUri && <EditorOption label={selectedMark.backgroundRemoved ? 'Restore background' : 'Remove background'} icon={{ios:'wand.and.stars',android:'auto-fix-high'}} selected={selectedMark.backgroundRemoved} disabled={busy} onPress={() => history.update(selectedMark.id!, {backgroundRemoved:!selectedMark.backgroundRemoved,imageUri:selectedMark.backgroundRemoved ? selectedMark.originalImageUri : selectedMark.cleanImageUri,pixelPath:selectedMark.backgroundRemoved ? selectedMark.originalPixelPath : selectedMark.cleanPixelPath})} />}
      {!imageSignaturesAvailable && <ThemedText>Update the native app build to add signature images.</ThemedText>}
      <RecentSignaturesSheet visible={signaturesOpen} signatures={recentSignatures} disabled={busy || !recovery.ready || preview?.page !== page} onClose={() => setSignaturesOpen(false)}
        onUse={entry => void applyRecentSignature(entry)} onRemove={entry => void removeRecentSignature(entry.id).then(list => { if (mounted.current) setRecentSignatures(list); })} />
    </View>}
    {tool === 'sign' && <ThemedText style={{ color: colors.secondaryLabel, paddingHorizontal: 4 }}>{guidance.sign}</ThemedText>}
    <View onLayout={toolbar.onBottomLayout} style={responsiveToolbarStyles.row}>
      {placing ? <ShapePicker compact label="Add shape" value={shape} onChange={placeShape} disabled={busy || !recovery.ready || preview?.page !== page || marks.length >= 300} /> : <>
      <EditorOption compact label={tool === 'sign' ? 'Sign' : tool === 'highlight' ? 'Mark' : tool === 'shapes' ? 'Shape' : 'Draw'} selected={!selecting && !erasing} disabled={busy} icon={{ ios: 'pencil.tip', android: 'draw' }} onPress={() => { setSelecting(false); setErasing(false); setSelectedId(undefined); }} />
      <EditorOption compact label="Select & resize" selected={selecting} disabled={busy} icon={{ ios: 'arrow.up.and.down.and.arrow.left.and.right', android: 'open-with' }} onPress={() => { setSelecting(true); setErasing(false); }} />
      </>}
      <View style={[responsiveToolbarStyles.primary, { minWidth: toolbar.primaryMinWidth }]}><ToolButton title={saveTitle} disabled={busy || !recovery.ready || (!marks.length && !annotationEditCount)} onPress={() => void run()} /></View>
    </View></PdfPreviewFooter>
  </>;
  if (markup) return <View style={[styles.markup, landscape && styles.landscapeRow]}>
    <PublishHeaderHistory canUndo={history.canUndo && !busy} canRedo={history.canRedo && !busy} onUndo={undoMark} onRedo={redoMark} />
    {toolbar.measurements}
    <View style={styles.canvasColumn}>
    <PdfPreviewBody pages={pageList} toolbar={pageControls}>
    <PdfPreviewStage hint={placing ? 'Pick a shape to add it. Drag a shape to move it. Drag the page to scroll, swipe to change page.' : 'Drag to mark. Select to move or resize. Two fingers to zoom.'} onFit={active && !busy ? () => setPreviewRetry(value => value + 1) : undefined}>
    {active && preview?.page === page && PdfMarkupView ? <PdfMarkupView key={`${page}:${previewRetry}:${preview.uri}`} style={{ flex: 1, backgroundColor: PDF_PREVIEW_BACKGROUND }} source={preview.uri} zoomRequest={markupZoom.request} onZoom={markupZoom.onZoom} marks={JSON.stringify(marks.filter(mark => mark.page === page))} brush={brushType} pattern={pattern} inkOpacity={markupEditing ? inkOpacity : undefined} onSelection={markupEditing ? event => selectMark(event.nativeEvent.mark) : undefined} mode={erasing ? 'erase' : selecting ? 'select' : tool === 'shapes' ? (shape === 'line' ? 'line' : 'polygon') : tool === 'highlight' && brush ? 'highlight-brush' : tool} shapePath={JSON.stringify(SHAPES.find(item => item.id === shape)?.points ?? [])} fillColor={fillColor === null ? '' : hexColor(fillColor)} inkColor={inkColor} inkWidth={inkWidth} disabled={!!controlHelp?.active || busy || !recovery.ready || (!selecting && !erasing && marks.length >= 300)} onMark={event => addMark(event.nativeEvent.mark)}
      onPageSwipe={placing ? ({ nativeEvent }) => { const target = page + nativeEvent.direction; if (!busy && target >= 1 && target <= info.pageCount) changePage(target); } : undefined} /> : failedPreview === previewKey && !busy
      ? <View style={styles.loadingScreen}><ThemedText>Page preview unavailable.</ThemedText><ToolButton title="Retry preview" onPress={() => { previewAttempt.current = ''; setFailedPreview(''); setPreviewRetry(value => value + 1); }} /></View>
      : <View style={styles.loadingScreen}><AppLoader size="large" /><ThemedText accessibilityLiveRegion="polite">Preparing page…</ThemedText></View>}
    {(selecting || !!resizeTarget) && active && preview?.page === page && !!PdfMarkupView && <MarkupZoomButtons showZoom={selecting} zoom={markupZoom.zoom} onZoomBy={markupZoom.zoomBy} disabled={busy} selection={resizeTarget?.points} onResize={points => { if (resizeTarget?.id) history.update(resizeTarget.id, { points }); }} />}
    </PdfPreviewStage>
    </PdfPreviewBody>
    </View>
    {landscape ? <ScrollView style={styles.landscapeSide} contentContainerStyle={styles.sideContent} keyboardShouldPersistTaps="handled">{markupLower}</ScrollView> : markupLower}
  </View>;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.markup, landscape && styles.landscapeRow]}>
    {toolbar.measurements}
    <View style={styles.canvasColumn}>
    {(tool === 'numbers' || tool === 'watermark') ? <PdfPreviewBody pages={pageList} toolbar={pageControls}>{numberPreview ? <PdfPagePreview image={numberPreview} active={active} preserveViewport /> : <PdfPreviewStage hint={tool === 'watermark' ? 'Preparing page...' : 'Preparing page numbers...'}><View style={styles.status}>{busy && <AppLoader />}</View></PdfPreviewStage>}</PdfPreviewBody> : tool === 'insert' ? <InsertPdfPreview uri={source.uri} count={info.pageCount} inputPassword={inputPassword} position={Number(position) || 0} inserted={insert ? { uri: insert.uri, name: insert.name, count: insertCount } : undefined} disabled={busy} toolbarActions={toolbar.atBottom ? undefined : toolActions} /> : <PdfDocumentPreview uri={source.uri} count={info.pageCount} initialPage={page} inputPassword={inputPassword} embedded toolbarActions={toolbar.atBottom ? undefined : toolActions} onClose={() => {}} />}
    </View>
    <View style={landscape ? styles.landscapeSide : undefined}>
    {renderSettings(<><View style={styles.field}><ThemedText style={styles.label}>{source.name}</ThemedText><ThemedText style={{ color: colors.secondaryLabel }}>{info.pageCount} pages · {formatSize(info.size)}</ThemedText></View><ThemedText>{guidance[tool]}</ThemedText>

    {rangeTools.has(tool) && <>{field('Pages (leave empty for all)', ranges, setRanges)}<ThemedText style={{ color: colors.secondaryLabel }}>For example: 1, 3, 5-8</ThemedText></>}
    {tool === 'insert' && (() => {
      const after = Math.min(info.pageCount, Math.max(0, Number(position) || 0));
      const useBlank = () => { setInsert(undefined); setInsertCount(0); setOptionsOpen(false); };
      return <>
        <ThemedText style={styles.label}>What to insert</ThemedText>
        <View style={styles.choices}>
          <EditorOption label="Blank page" icon={{ ios: 'doc', android: 'note-add' }} selected={!insert} disabled={busy} onPress={useBlank} style={styles.grow} />
          <EditorOption label="Another PDF" icon={{ ios: 'doc.on.doc', android: 'file-copy' }} selected={!!insert} disabled={busy} onPress={() => void pickInsert()} style={styles.grow} />
        </View>
        {insert && <View style={[styles.insertFile, { backgroundColor: colors.secondarySystemBackground }]}>
          <UniversalIcon ios="doc.richtext" android="picture-as-pdf" size={22} color={colors.systemBlue} />
          <ThemedText numberOfLines={1} style={styles.grow}>{insert.name}</ThemedText>
          <ToolButton title="Change" secondary disabled={busy} onPress={() => void pickInsert()} />
        </View>}
        <ThemedText style={styles.label}>Where</ThemedText>
        <View style={styles.choices}>
          <EditorOption label="At the start" icon={{ ios: 'arrow.up.to.line', android: 'vertical-align-top' }} selected={after === 0} disabled={busy} onPress={() => setPosition('0')} style={styles.grow} />
          <EditorOption label="At the end" icon={{ ios: 'arrow.down.to.line', android: 'vertical-align-bottom' }} selected={after === info.pageCount} disabled={busy} onPress={() => setPosition(String(info.pageCount))} style={styles.grow} />
        </View>
        <View style={styles.insertStepper}>
          <ToolButton title="-" secondary disabled={busy || after <= 0} onPress={() => setPosition(String(after - 1))} />
          <ThemedText accessibilityLiveRegion="polite" style={[styles.grow, styles.insertWhere]}>{after === 0 ? 'Before page 1' : `After page ${after} of ${info.pageCount}`}</ThemedText>
          <ToolButton title="+" secondary disabled={busy || after >= info.pageCount} onPress={() => setPosition(String(after + 1))} />
        </View>
      </>;
    })()}
    {tool === 'to_image' && choices(qualityOptions, quality, setQuality)}
    {tool === 'compress' && estimate?.quality === quality && <ThemedText>Output will be at most {formatSize(Math.min(estimate.size, info.size))}. The exact reduction is known after saving; an already optimized PDF may stay the same size.</ThemedText>}
    {tool === 'ocr' && <>
      <ThemedText style={styles.label}>Output</ThemedText>
      <View style={styles.choices}>
        <EditorOption label="Text file" icon={{ ios: 'doc.text', android: 'description' }} selected={ocrFormat === 'text'} disabled={busy} onPress={() => setOcrFormat('text')} />
        <EditorOption label="Searchable PDF" icon={{ ios: 'doc.text.magnifyingglass', android: 'find-in-page' }} selected={ocrFormat === 'pdf'} disabled={busy || !PdfEngine?.nativeSearchableOcrVersion} onPress={() => setOcrFormat('pdf')} />
      </View>
      {ocrFormat === 'pdf' && <><EditorOption label="Skip pages with selectable text" icon={{ ios: 'checkmark.circle', android: 'check-circle' }} selected={skipExistingText} disabled={busy} onPress={() => setSkipExistingText(value => !value)} /><ThemedText>The page artwork stays unchanged. Up to 100 selected pages; English OCR. Turn off skipping for mixed scanned and selectable content, which can create duplicate text.</ThemedText></>}
      {!PdfEngine?.nativeSearchableOcrVersion && <ThemedText>Update the native app build to enable searchable PDF output.</ThemedText>}
    </>}
    {tool === 'watermark' && <><PagePositionPicker value={numberPosition} onChange={setNumberPosition} disabled={busy} center /><TextStyleControls style={numberStyle} onChange={setNumberStyle} size={numberSize} onSizeChange={setNumberSize} sizeUnit="pt" minSize={4} maxSize={72} disabled={busy} /><ColorSwatches value={parseInt(inkColor.slice(1),16)} onChange={value=>setInkColor(hexColor(value??0))} disabled={busy} /><ThemedText style={styles.label}>Stamp outline</ThemedText><View style={styles.choices}><EditorOption compact label="Text only" icon={{ ios: 'textformat', android: 'text-fields' }} selected={stampShape==='none'} onPress={()=>setStampShape('none')} disabled={busy} /><ShapePicker inline value={stampShape} onChange={setStampShape} disabled={busy} /></View><ToolButton title="Preview watermark" secondary disabled={busy} onPress={()=>void previewNumbers()} /></>}
    {tool === 'numbers' && <>
      {field('Start numbering at', startNumber, setStartNumber, true)}
      <ThemedText style={styles.label}>Position</ThemedText>
      <PagePositionPicker value={numberPosition} onChange={setNumberPosition} disabled={busy} />
      {field('Prefix (optional)', numberPrefix, setNumberPrefix)}
      {field('Margin from edge (pt)', numberMargin, setNumberMargin, true)}
      <TextStyleControls style={numberStyle} onChange={setNumberStyle} size={numberSize} onSizeChange={setNumberSize} sizeUnit="pt" minSize={4} maxSize={72} disabled={busy} />
      <ColorSwatches value={parseInt(inkColor.slice(1), 16)} onChange={value => { const color = hexColor(value ?? 0); setInkColor(color); styleSelection({ color }); }} disabled={busy} />
      <ToolButton title="Preview page numbers" secondary disabled={busy} onPress={() => void previewNumbers()} />
    </>}
    {tool === 'protect' && <>{field('New password', password, setPassword, false, true)}{field('Confirm password', confirmation, setConfirmation, false, true)}
      {!!error && <ThemedText accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</ThemedText>}
      <ToolButton title="Protect PDF" disabled={busy || !password || !confirmation} onPress={() => { setOptionsOpen(false); void run(); }} /></>}
  </>)}
  <PdfPreviewFooter>{status}
    {tool === 'compress' && <>
      <ScrollView horizontal style={styles.quickScroll} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quickRow}>
        {qualityOptions.map(item => <EditorOption key={item.id} compact label={item.label} icon={item.icon} selected={quality === item.id} disabled={busy} onPress={() => setQuality(item.id)} />)}
        <EditorOption compact label="Estimate size" icon={{ ios: 'doc.text.magnifyingglass', android: 'find-in-page' }} disabled={busy} onPress={() => void estimateSize()} />
      </ScrollView>
      <ThemedText accessibilityLiveRegion="polite" style={styles.quickHint}>{estimate?.quality === quality ? `Estimated output: up to ${formatSize(Math.min(estimate.size, info.size))}` : 'Estimate size before compressing.'}</ThemedText>
    </>}
    {tool === 'to_image' && <View style={styles.quickRow}>
      {['jpg', 'png'].map(value => <EditorOption key={value} compact label={value.toUpperCase()} selected={format === value} disabled={busy} onPress={() => setFormat(value)} />)}
    </View>}
    {tool === 'watermark' && <View style={styles.quickRow}>
      <TextInput accessibilityLabel="Watermark text" editable={!busy} value={text} onChangeText={setText} placeholder="Watermark text" placeholderTextColor={colors.secondaryLabel} autoCorrect={false} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} maxLength={100} style={[inputStyle, styles.quickInput]} />
      {[{ id: '0.15', label: 'Subtle', icon: { ios: 'circle.dotted', android: 'blur-on' } }, { id: '0.3', label: 'Balanced', icon: { ios: 'circle.lefthalf.filled', android: 'tonality' } }, { id: '0.6', label: 'Bold', icon: { ios: 'circle.fill', android: 'brightness-1' } }].map(item => <EditorOption key={item.id} compact label={item.label} accessibilityLabel={`${item.label} watermark`} icon={item.icon as OptionIcon} selected={stampOpacity === item.id} disabled={busy} onPress={() => setStampOpacity(item.id)} />)}
    </View>}
    {tool === 'numbers' && <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quickRow}>
      {[{ id: 'number', label: '1', icon: { ios: 'number', android: 'tag' } }, { id: 'page', label: 'Page 1', icon: { ios: 'doc.text', android: 'description' } }, { id: 'total', label: '1 of 10', icon: { ios: 'square.stack', android: 'layers' } }].map(item => <EditorOption key={item.id} compact label={item.label} accessibilityLabel={`Number format ${item.label}`} icon={item.icon as OptionIcon} selected={numberFormat === item.id} disabled={busy} onPress={() => setNumberFormat(item.id)} />)}
      <View style={styles.quickStepper}>
        <ToolButton title="-" secondary disabled={busy || Number(numberSize) <= 4} onPress={() => setNumberSize(String(Math.max(4, (Number(numberSize) || 11) - 1)))} />
        <ThemedText accessibilityLabel={`Text size ${numberSize} points`} style={styles.quickSize}>{numberSize} pt</ThemedText>
        <ToolButton title="+" secondary disabled={busy || Number(numberSize) >= 72} onPress={() => setNumberSize(String(Math.min(72, (Number(numberSize) || 11) + 1)))} />
      </View>
    </ScrollView>}
    <View onLayout={toolbar.onBottomLayout} style={responsiveToolbarStyles.row}>
      {toolbar.atBottom && toolActions}
      <View style={[responsiveToolbarStyles.primary, { minWidth: toolbar.primaryMinWidth }]}><ToolButton title={saveTitle} disabled={busy || (tool === 'compress' && estimate?.quality !== quality)} onPress={() => void run()} /></View>
    </View>
  </PdfPreviewFooter>
  </View>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  icon: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, flexWrap: 'nowrap' },
  landscapeRow: { flexDirection: 'row' }, grow: { flex: 1, minWidth: 0 }, canvasColumn: { flex: 1, minWidth: 0 }, landscapeSide: { width: 300, flexGrow: 0 }, sideContent: { flexGrow: 1 },
  content: { padding: 20, gap: 16, paddingBottom: 40 }, field: { gap: 6 }, heading: { fontSize: 23, fontWeight: '700' }, label: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, chip: { minHeight: 44, borderRadius: 12, padding: 12, justifyContent: 'center' },
  status: { padding: 12, gap: 10, alignItems: 'center', justifyContent: 'center' },
  loadingScreen: { flex: 1, padding: 24, gap: 12, alignItems: 'center', justifyContent: 'center' }, result: { padding: 16, borderRadius: 18, gap: 12 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, quickInput: { flex: 1, minWidth: 0, minHeight: 44, paddingVertical: 8 },
  quickHint: { fontSize: 12, lineHeight: 16, paddingHorizontal: 4 },
  quickScroll: { flexGrow: 0 },
  quickStepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  insertFile: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 },
  insertStepper: { flexDirection: 'row', alignItems: 'center', gap: 8 }, insertWhere: { textAlign: 'center', fontWeight: '600', fontVariant: ['tabular-nums'] }, quickSize: { minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'] },
  markup: { flex: 1 }, controls: { paddingHorizontal: 8, paddingVertical: 4 }, swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 3 },
});

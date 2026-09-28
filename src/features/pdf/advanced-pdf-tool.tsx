import { PagePositionPicker } from './page-position-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import { ColorSwatches, hexColor } from '@/components/color-swatches';
import { DEFAULT_TEXT_STYLE, fontName, TextStyleControls } from '@/components/text-style-controls';
import { UniversalIcon } from '@/components/universal-icon';
import { EditorOption } from '@/components/editor-option';
import { BrushControls } from './brush-controls';
import { useMarkHistory } from './use-mark-history';
import { SHAPES, ShapePicker } from './shape-picker';
import { PdfEngine, type PdfResult } from '../../../modules/pdf-engine';
import PdfMarkupView, { type PdfMark } from '../../../modules/pdf-engine/src/PdfMarkupView';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { AppLoader } from '@/components/app-loader';
import { showDialog } from '@/components/app-dialog';
import { usePalette } from '@/theme/colors';
import { browseFiles, disposeImports, formatSize, savedPdfDirectory, shareFile, type LocalFile } from '../files/file-storage';
import { askNewFileName, saveEditedOutput, savePdfResult, saveToDevice } from '../files/save-file';
import { forgetRecentUri, rememberPdfResults } from '../files/recent-files';
import { usePdfScreenActive } from './use-pdf-screen-active';
import { openPdfResult } from './open-pdf-screen';
import type { PdfToolSession } from './pdf-tool-session';
import { PdfPagePreview, PdfPreviewStage, PdfPreviewToolbar, PdfPreviewFooter, PDF_PREVIEW_BACKGROUND, type PdfPreviewImage } from './pdf-preview';
import { PdfDocumentPreview } from './pdf-document-preview';

type Info = { pageCount: number; size: number; width: number; height: number; version: string; encrypted: boolean; title: string; author: string; subject: string; creator: string; producer: string };
type Output = PdfResult & { name: string };
type Response = { info?: Info; outputs?: (PdfResult & { width?: number; height?: number; pointWidth?: number })[]; estimatedSize?: number; textPreview?: string };
const markupTools = new Set(['highlight', 'draw', 'shapes', 'sign']);
const rangeTools = new Set(['duplicate', 'to_image', 'watermark', 'numbers', 'extract_text', 'ocr']);
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const guidance: Record<string, string> = {
  duplicate: 'Each selected page is copied immediately after its original.',
  insert: 'Add a blank page, or insert all pages from another PDF. Position 0 inserts at the beginning.',
  compress: 'Max quality preserves page content. Balanced and Smallest rebuild pages as images, removing selectable text, links and editable forms. If compression is larger, the original file is retained.',
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
  ocr: 'Recognize English text on selected pages, entirely offline. Export a UTF-8 text file. Clear, upright scans give better results; review the output for recognition errors.',
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

export function AdvancedPdfTool({ session, onUnsavedChange }: { session: PdfToolSession; onUnsavedChange: (value: boolean) => void }) {
  const colors = usePalette();
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
  const [preview, setPreview] = useState<{ uri: string; page: number }>();
  const [previewRetry, setPreviewRetry] = useState(0);
  const [ranges, setRanges] = useState('');
  const [position, setPosition] = useState('0');
  const [insert, setInsert] = useState<LocalFile>();
  const [quality, setQuality] = useState('balanced');
  const [format, setFormat] = useState('jpg');
  const [estimate, setEstimate] = useState<{ quality: string; size: number }>();
  const [text, setText] = useState('');
  const [startNumber, setStartNumber] = useState('1');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const history = useMarkHistory();
  const { marks } = history;
  const [brushType, setBrushType] = useState('pen');
  const [pattern, setPattern] = useState('solid');
  const [selecting, setSelecting] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(true);
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
  const savedOutputs = useRef(new Set<string>());
  const mounted = useRef(true);
  const locked = useRef(false);
  const job = useRef<string | undefined>(undefined);
  const initialized = useRef(false);
  const previewJob = useRef(false);
  const previewAttempt = useRef(0);
  const secret = useRef(inputPassword); secret.current = inputPassword;
  useEffect(() => { onUnsavedChange(marks.length > 0 && results.length === 0); }, [marks.length, results.length, onUnsavedChange]);
  useEffect(() => {
    mounted.current = true;
    const listener = available ? PdfEngine?.addListener('onConversionProgress', event => { if (mounted.current && event.jobId === job.current) setProgress(event.total ? event.completed / event.total : 0); }) : undefined;
    return () => {
      mounted.current = false; listener?.remove();
      queueMicrotask(() => { if (mounted.current) return; if (job.current) { PdfEngine?.cancelPdfTool(job.current); PdfEngine?.cancelTextEdit(job.current); } if (!locked.current) disposeImports(directory); });
    };
  }, [available, directory]);
  const process = useCallback(async (request: Record<string, unknown>, label: string): Promise<Response | undefined> => {
    if (!PdfEngine?.nativeAdvancedToolsVersion || locked.current) return;
    locked.current = true; const id = uid(); job.current = id; previewJob.current = request.operation === 'preview' || request.action === 'preview';
    setBusy(true); setPhase(label); setError(''); setProgress(0);
    try {
      const payload = JSON.stringify({ uri: source.uri, inputPassword: secret.current, ...request });
      const raw = JSON.parse(await (request.nativeEditor ? PdfEngine.editPdfText(id, payload) : PdfEngine.processPdf(id, payload)));
      const result: Response = request.nativeEditor ? { outputs: [request.action === 'preview' ? { ...raw, uri: raw.imageUri } : raw] } : raw;
      return result;
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message || 'Could not process this PDF.');
    } finally {
      locked.current = false; job.current = undefined;
      if (mounted.current) { setBusy(false); setPhase(''); } else disposeImports(directory);
    }
  }, [source.uri, directory]);
  const inspect = useCallback(async () => {
    const result = await process({ operation: 'info' }, 'Reading document details…');
    if (mounted.current && result?.info) { setInfo(result.info); setPosition(String(result.info.pageCount)); setPage(value => Math.min(value, result.info!.pageCount)); }
  }, [process]);
  useEffect(() => { if (!active || !available || initialized.current) return; initialized.current = true; void inspect(); }, [active, available, inspect]);
  useEffect(() => {
    if (!active || !markup || !info || busy || results.length || preview?.page === page || previewAttempt.current === page) return;
    previewAttempt.current = page;
    const output = new File(directory, `markup-${uid()}.png`);
    void process({ nativeEditor: true, action: 'preview', includeObjects: false, page: page - 1, imageUri: output.uri, edits: [] }, 'Preparing page…').then(result => {
      if (!mounted.current || !result?.outputs?.length) return;
      setPreview(previous => { if (previous) { try { new File(previous.uri).delete(); } catch { /* Session teardown retries. */ } } return { uri: output.uri, page }; });
    });
  }, [active, markup, info, page, preview?.page, previewRetry, busy, results.length, directory, process]);
  useEffect(() => {
    if (!active && previewJob.current && job.current) { PdfEngine?.cancelPdfTool(job.current); PdfEngine?.cancelTextEdit(job.current); previewAttempt.current = 0; }
  }, [active, busy]);
  async function pickInsert() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { const picked = await browseFiles(directory, false, 1, true); if (picked[0] && mounted.current) { if (insert) { try { new File(insert.uri).delete(); } catch { /* Session cleanup. */ } } setInsert(picked[0]); } }
    catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { locked.current = false; if (mounted.current) setBusy(false); else disposeImports(directory); }
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
      return { kind: 'number', page: number - 1, text: `${numberPrefix}${label}`, position: numberPosition, margin: Number(numberMargin), font: fontName(numberStyle), size: Number(numberSize), underline: numberStyle.underline, color: parseInt(inkColor.slice(1), 16) };
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
      commands.push({ kind: 'number', page: number - 1, text: text.trim(), position: numberPosition, margin: 36, size: Number(numberSize), font: fontName(numberStyle), underline: numberStyle.underline, color: parseInt(inkColor.slice(1),16), opacity: Number(stampOpacity) });
      return commands;
    });
  }
  async function previewNumbers(target = page) {
    if (locked.current) return;
    try {
      const commands = tool === 'watermark' ? watermarkCommands() : numberCommands();
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
  function undoMark() { if (!busy) { const target = history.undo(); if (target) setPage(target); } }
  function redoMark() { if (!busy) { const target = history.redo(); if (target) setPage(target); } }
  async function run() {
    if (!info || locked.current) return;
    Keyboard.dismiss(); setError('');
    try {
      const selected = markup ? [...new Set(marks.map(mark => mark.page))].sort((a, b) => a - b) : pageRange(ranges, info.pageCount);
      if (markup && !marks.length) throw new Error('Add a mark to the page first.');
      if (tool === 'to_image' && selected.length > 100) throw new Error('Export up to 100 pages at a time.');
      if (tool === 'protect' && (password !== confirmation || !/^[\x20-\x7e]{6,64}$/.test(password))) throw new Error('Enter matching passwords with 6–64 English letters, numbers or symbols.');
      if (tool === 'watermark' && !/^[\x20-\x7e]{1,100}$/.test(text.trim())) throw new Error('Enter a label with up to 100 English letters, numbers or symbols.');
      if (tool === 'insert' && (!/^\d+$/.test(position) || Number(position) > info.pageCount)) throw new Error(`Choose an insertion position from 0 to ${info.pageCount}.`);
      if (tool === 'numbers' && (!/^\d+$/.test(startNumber) || Number(startNumber) > 1_000_000)) throw new Error('Start numbering between 0 and 1,000,000.');
      const numbered = tool === 'numbers' ? numberCommands() : tool === 'watermark' ? watermarkCommands() : [];
      const extension = tool === 'to_image' ? format : ['ocr', 'extract_text'].includes(tool) ? 'txt' : 'pdf';
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
      const result = await process({ ...(markup || tool === 'numbers' || tool === 'watermark' ? { nativeEditor: true, action: 'save', outputUri: outputUris[0], edits: markup ? marks.map(mark => ({ ...mark, page: mark.page - 1, shape: mark.kind, kind: 'mark' })) : numbered } : {}), operation: tool, outputUris, pages: selected, quality, format, position: Number(position), insertUri: insert?.uri ?? '', text: text.trim(), startNumber: Number(startNumber), password, marks }, 'Processing on your device…');
      if (!result?.outputs) return;
      const outputs = result.outputs.map((output, i) => ({ ...output, name: names[i] }));
      if (extension === 'pdf') await rememberPdfResults(outputs).catch(() => {});
      if (mounted.current) { savedOutputs.current.clear(); setResults(outputs); setTextPreview(result.textPreview ?? ''); setPassword(''); setConfirmation(''); history.clear(); }
    } catch (cause) { locked.current = false; if (mounted.current) { setError((cause as Error).message); setBusy(false); } else disposeImports(directory); }
  }
  async function save(output: Output) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (output.name.endsWith('.pdf')) {
        const saved = await savePdfResult(output, session.origin);
        if (saved) { savedOutputs.current.add(saved.file.uri); if (mounted.current) setResults(current => current.map(item => item.uri === output.uri ? { ...item, uri: saved.file.uri, name: saved.file.name } : item)); }
      } else {
        const name = await askNewFileName(output.name);
        if (name) {
          const saved = output.name.endsWith('.txt') ? await saveToDevice(output.uri, name, mime(output)) : (await saveEditedOutput({ output: output.uri, mimeType: mime(output), kind: 'image', mode: 'new', name })).device;
          savedOutputs.current.add(output.uri); if (mounted.current) setNotice(`Saved to ${saved.location}`);
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
    if (locked.current || savedOutputs.current.has(output.uri)) return;
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
    try {
      const mark = JSON.parse(serialized) as PdfMark;
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
  const styledPreviewKey = JSON.stringify([tool, page, ranges, startNumber, numberStyle, numberSize, numberPosition, numberFormat, numberMargin, numberPrefix, inkColor, text, stampShape, stampOpacity]);
  const lastStyledPreview = useRef('');
  const refreshStyledPreview = useRef(previewNumbers);
  useEffect(() => { refreshStyledPreview.current = previewNumbers; });
  useEffect(() => {
    if (!active || !info || busy || results.length || !['numbers', 'watermark'].includes(tool) || (tool === 'watermark' && !text.trim()) || lastStyledPreview.current === styledPreviewKey) return;
    const timer = setTimeout(() => { lastStyledPreview.current = styledPreviewKey; void refreshStyledPreview.current(); }, 300);
    return () => clearTimeout(timer);
  }, [active, info, busy, results.length, tool, text, styledPreviewKey]);
  const inputStyle = [styles.input, { color: colors.label, backgroundColor: colors.secondarySystemBackground, borderColor: colors.borderHighlight }];
  const field = (label: string, value: string, setter: (value: string) => void, numeric = false, secure = false) => <View style={styles.field}><ThemedText style={styles.label}>{label}</ThemedText><TextInput accessibilityLabel={label} editable={!busy} value={value} onChangeText={setter} keyboardType={numeric ? 'number-pad' : 'default'} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} maxLength={secure ? 64 : 100} style={inputStyle} /></View>;
  const choices = (items: { id: string; label: string }[], selected: string, choose: (value: string) => void) => <View style={styles.choices}>{items.map(item => <EditorOption key={item.id} label={item.label} selected={selected === item.id} disabled={busy} onPress={() => choose(item.id)} />)}</View>;
  const status = <>{busy && <View style={styles.status}><AppLoader /><ThemedText accessibilityLiveRegion="polite">{phase || 'Please wait…'}{progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}</ThemedText>{job.current && <ToolButton title="Cancel" secondary onPress={() => { if (job.current) { PdfEngine?.cancelPdfTool(job.current); PdfEngine?.cancelTextEdit(job.current); } }} />}</View>}{!!error && <ThemedText accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</ThemedText>}{!!notice && <ThemedText accessibilityLiveRegion="polite">{notice}</ThemedText>}</>;
  if (!available) return <View style={styles.content}><ThemedText>Install a new development build to use these native PDF tools on this device.</ThemedText></View>;
  if (results.length) return <ScrollView contentContainerStyle={styles.content}>{status}<ThemedText style={styles.heading}>{tool === 'repair' ? 'Rewritten and validated' : 'Your files are ready'}</ThemedText>{tool === 'compress' && <ThemedText>Original {formatSize(source.size)} · Result {formatSize(results[0].size)}{results[0].size >= source.size ? ' — no size reduction for this document.' : ` — ${Math.round((1 - results[0].size / source.size) * 100)}% smaller.`}</ThemedText>}{results.map(output => <View key={output.uri} style={[styles.result, { backgroundColor: colors.secondarySystemBackground }]}><ThemedText style={styles.label}>{output.name}</ThemedText><ThemedText>{formatSize(output.size)}</ThemedText>{output.name.endsWith('.pdf') && tool !== 'protect' && <ToolButton title="Open PDF" disabled={busy} onPress={() => openPdfResult(output, session.returnRoute)} />}{tool === 'protect' && <ThemedText>Use the password you set when opening this file in a password-capable PDF reader.</ThemedText>}<View style={styles.choices}><ToolButton title="Save to device" disabled={busy} onPress={() => void save(output)} /><ToolButton title="Share" secondary disabled={busy} onPress={() => void share(output)} /></View>{!savedOutputs.current.has(output.uri) && <ToolButton title="Delete output" secondary disabled={busy} onPress={() => deleteOutput(output)} />}</View>)}<ToolButton title="Run again" secondary disabled={busy} onPress={() => { setResults([]); setTextPreview(''); setNotice(''); }} />{!!textPreview && <View style={styles.field}><ThemedText style={styles.label}>Text preview</ThemedText><ThemedText selectable>{textPreview}</ThemedText><ThemedText>The exported file contains the full text.</ThemedText></View>}</ScrollView>;
  if (!info) return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{status}<ThemedText style={styles.label}>{source.name}</ThemedText>{!busy && <>{field('Document password (if required)', inputPassword, setInputPassword, false, true)}<ToolButton title="Open document" onPress={() => void inspect()} /></>}</ScrollView>;
  if (showSourcePreview) return <PdfDocumentPreview uri={source.uri} count={info.pageCount} initialPage={page} inputPassword={inputPassword} onClose={() => setShowSourcePreview(false)} />;
  if (tool === 'info') return <ScrollView contentContainerStyle={styles.content}>{status}<ToolButton title="Preview PDF" secondary onPress={() => setShowSourcePreview(true)} /><ThemedText style={styles.heading}>{source.name}</ThemedText>{Object.entries({ Pages: info.pageCount, Size: formatSize(info.size), 'First page': `${Math.round(info.width)} × ${Math.round(info.height)} pt`, 'PDF version': info.version, Encrypted: info.encrypted ? 'Yes' : 'No', Title: info.title || '—', Author: info.author || '—', Subject: info.subject || '—', Creator: info.creator || '—', Producer: info.producer || '—' }).map(([key, value]) => <View key={key} style={styles.field}><ThemedText style={{ color: colors.secondaryLabel }}>{key}</ThemedText><ThemedText selectable>{value}</ThemedText></View>)}</ScrollView>;
  const pageControls = <PdfPreviewToolbar page={page} count={info.pageCount} disabled={busy} onPageChange={target => numberPreview ? void previewNumbers(target) : setPage(target)} />;
  if (markup) return <View style={styles.markup}>
    {pageControls}
    <PdfPreviewStage hint="Drag to mark. Select to move or resize. Two fingers to zoom." onFit={active && !busy ? () => setPreviewRetry(value => value + 1) : undefined}>
    {active && preview?.page === page && PdfMarkupView ? <PdfMarkupView key={`${page}:${previewRetry}`} style={{ flex: 1, backgroundColor: PDF_PREVIEW_BACKGROUND }} source={preview.uri} marks={JSON.stringify(marks.filter(mark => mark.page === page))} brush={brushType} pattern={pattern} mode={selecting ? 'select' : tool === 'shapes' ? (shape === 'line' ? 'line' : 'polygon') : tool === 'highlight' && brush ? 'highlight-brush' : tool} shapePath={JSON.stringify(SHAPES.find(item => item.id === shape)?.points ?? [])} fillColor={fillColor === null ? '' : hexColor(fillColor)} inkColor={inkColor} inkWidth={inkWidth} disabled={busy || (!selecting && marks.length >= 300)} onMark={event => addMark(event.nativeEvent.mark)} /> : <View style={styles.status}><ThemedText>{busy ? 'Preparing page...' : 'Page preview unavailable.'}</ThemedText>{!busy && <ToolButton title="Retry preview" onPress={() => { previewAttempt.current = 0; setPreviewRetry(value => value + 1); }} />}</View>}
    </PdfPreviewStage>
    <View style={[styles.choices, styles.controls]}>
      <ToolButton title={showStyle ? 'Hide style' : 'Style & colour'} secondary disabled={busy} onPress={() => setShowStyle(value => !value)} />
      <EditorOption label="Select & resize" selected={selecting} disabled={busy} onPress={() => setSelecting(value => !value)} />
      {tool === 'highlight' && choices([{ id: 'area', label: 'Area' }, { id: 'brush', label: 'Brush' }], brush ? 'brush' : 'area', value => setBrush(value === 'brush'))}

    </View>
    {showStyle && <ScrollView style={{ maxHeight: '36%', flexGrow: 0 }} contentContainerStyle={{ gap: 10, padding: 12 }} keyboardShouldPersistTaps="handled">
      {(tool === 'draw' || tool === 'sign') && <BrushControls brush={brushType} pattern={pattern} disabled={busy} onBrush={(value, width) => { setBrushType(value); setInkWidth(width); }} onPattern={setPattern} />}
      {tool === 'shapes' && <ShapePicker value={shape} onChange={setShape} disabled={busy} />}
      <ThemedText style={styles.label}>{tool === 'shapes' ? 'Border colour' : 'Ink colour'}</ThemedText>
      <ColorSwatches value={parseInt(inkColor.slice(1), 16)} onChange={value => setInkColor(hexColor(value ?? 0))} disabled={busy} />
      {tool === 'shapes' && shape !== 'line' && <><ThemedText style={styles.label}>Fill colour</ThemedText><ColorSwatches value={fillColor} onChange={setFillColor} original={{ label: 'None', value: null }} disabled={busy} /></>}
      {(tool !== 'highlight' || brush) && <View style={styles.choices}><ToolButton title="-" secondary disabled={busy || inkWidth <= .002} onPress={() => setInkWidth(value => Math.max(.001, value - .002))} /><ThemedText>Thickness {Math.round(inkWidth * 1000)}</ThemedText><ToolButton title="+" secondary disabled={busy || inkWidth >= .06} onPress={() => setInkWidth(value => Math.min(.06, value + .002))} /></View>}
    </ScrollView>}
    <PdfPreviewFooter>{status}
    <View style={styles.choices}>
      <Pressable accessibilityRole="button" accessibilityLabel="Undo annotation" disabled={busy || !history.canUndo} onPress={undoMark} style={[styles.icon, !history.canUndo && { opacity: 0.35 }]}><UniversalIcon ios="arrow.uturn.backward" android="undo" size={24} color={colors.systemBlue} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Redo annotation" disabled={busy || !history.canRedo} onPress={redoMark} style={[styles.icon, !history.canRedo && { opacity: 0.35 }]}><UniversalIcon ios="arrow.uturn.forward" android="redo" size={24} color={colors.systemBlue} /></Pressable>
      <View style={{ flex: 1 }}><ToolButton title={`Save PDF${marks.length ? ` (${marks.length})` : ''}`} disabled={busy || !marks.length} onPress={() => void run()} /></View>
    </View></PdfPreviewFooter>
  </View>;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.markup}>
    {(tool === 'numbers' || tool === 'watermark') ? <>{pageControls}{numberPreview ? <PdfPagePreview image={numberPreview} active={active} preserveViewport /> : <PdfPreviewStage hint={tool === 'watermark' ? 'Enter a watermark to preview its placement.' : 'Preparing page numbers...'}><View style={styles.status}>{busy && <AppLoader />}</View></PdfPreviewStage>}</> : <PdfDocumentPreview uri={source.uri} count={info.pageCount} initialPage={page} inputPassword={inputPassword} embedded onClose={() => {}} />}
    <View style={styles.controls}><EditorOption label="Tool settings" selected={optionsOpen} onPress={() => { Keyboard.dismiss(); setOptionsOpen(value => !value); }} /></View>
    {optionsOpen && <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets style={{ maxHeight: '44%', flexGrow: 0 }} contentContainerStyle={styles.content}>{status}<View style={styles.field}><ThemedText style={styles.label}>{source.name}</ThemedText><ThemedText style={{ color: colors.secondaryLabel }}>{info.pageCount} pages · {formatSize(info.size)}</ThemedText></View><ThemedText>{guidance[tool]}{tool === 'metadata' && Platform.OS === 'ios' ? ' On iOS, pages are rewritten without document metadata; forms and links become static.' : ''}</ThemedText>

    {rangeTools.has(tool) && <>{field('Pages (leave empty for all)', ranges, setRanges)}<ThemedText style={{ color: colors.secondaryLabel }}>For example: 1, 3, 5-8</ThemedText></>}
    {tool === 'insert' && <>{field(`Insert after page (0–${info.pageCount})`, position, setPosition, true)}<ThemedText>{insert ? insert.name : 'One blank page'}</ThemedText><ToolButton title="Choose PDF to insert" secondary disabled={busy} onPress={() => void pickInsert()} />{insert && <ToolButton title="Use a blank page" secondary disabled={busy} onPress={() => { try { new File(insert.uri).delete(); } catch { /* Session cleanup. */ } setInsert(undefined); }} />}</>}
    {(tool === 'compress' || tool === 'to_image') && choices([{ id: 'max', label: 'Max quality' }, { id: 'balanced', label: 'Balanced' }, { id: 'small', label: 'Smallest' }], quality, setQuality)}
    {tool === 'compress' && <><ToolButton title="Estimate output size" secondary disabled={busy} onPress={() => void estimateSize()} />{estimate?.quality === quality && <ThemedText>Estimated output: {formatSize(Math.min(estimate.size, info.size))}. {estimate.size >= info.size ? 'This preset may not reduce the file; the original is kept if compression is larger.' : ''} {quality === 'max' ? 'A lossless rewrite may not reduce size.' : 'Based on sample pages; actual size can vary.'}</ThemedText>}</>}
    {tool === 'to_image' && choices([{ id: 'jpg', label: 'JPG' }, { id: 'png', label: 'PNG' }], format, setFormat)}
    {tool === 'watermark' && <>{field('Watermark text', text, setText)}<PagePositionPicker value={numberPosition} onChange={setNumberPosition} disabled={busy} center /><TextStyleControls style={numberStyle} onChange={setNumberStyle} size={numberSize} onSizeChange={setNumberSize} sizeUnit="pt" minSize={4} maxSize={72} disabled={busy} /><ColorSwatches value={parseInt(inkColor.slice(1),16)} onChange={value=>setInkColor(hexColor(value??0))} disabled={busy} />{choices([{id:'0.15',label:'Subtle'},{id:'0.3',label:'Balanced'},{id:'0.6',label:'Bold'}],stampOpacity,setStampOpacity)}<ThemedText style={styles.label}>Stamp outline</ThemedText><EditorOption label="Text only" selected={stampShape==='none'} onPress={()=>setStampShape('none')} disabled={busy} /><ShapePicker value={stampShape} onChange={setStampShape} disabled={busy} /><ToolButton title="Preview watermark" secondary disabled={busy} onPress={()=>void previewNumbers()} /></>}
    {tool === 'numbers' && <>
      {field('Start numbering at', startNumber, setStartNumber, true)}
      <ThemedText style={styles.label}>Position</ThemedText>
      <PagePositionPicker value={numberPosition} onChange={setNumberPosition} disabled={busy} />
      {choices([{ id: 'number', label: '1' }, { id: 'page', label: 'Page 1' }, { id: 'total', label: '1 of 10' }], numberFormat, setNumberFormat)}
      {field('Prefix (optional)', numberPrefix, setNumberPrefix)}
      {field('Margin from edge (pt)', numberMargin, setNumberMargin, true)}
      <TextStyleControls style={numberStyle} onChange={setNumberStyle} size={numberSize} onSizeChange={setNumberSize} sizeUnit="pt" minSize={4} maxSize={72} disabled={busy} />
      <ColorSwatches value={parseInt(inkColor.slice(1), 16)} onChange={value => setInkColor(hexColor(value ?? 0))} disabled={busy} />
      <ToolButton title="Preview page numbers" secondary disabled={busy} onPress={() => void previewNumbers()} />
    </>}
    {tool === 'protect' && <>{field('New password', password, setPassword, false, true)}{field('Confirm password', confirmation, setConfirmation, false, true)}</>}

  </ScrollView>}
  <PdfPreviewFooter>    <ToolButton title={tool === 'repair' ? 'Attempt repair' : ['ocr', 'extract_text'].includes(tool) ? 'Export text' : tool === 'to_image' ? 'Export images' : 'Create PDF'} disabled={busy || (tool === 'compress' && estimate?.quality !== quality)} onPress={() => void run()} /></PdfPreviewFooter>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  icon: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, flexWrap: 'nowrap' },
  content: { padding: 20, gap: 16, paddingBottom: 40 }, field: { gap: 6 }, heading: { fontSize: 23, fontWeight: '700' }, label: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, chip: { minHeight: 44, borderRadius: 12, padding: 12, justifyContent: 'center' },
  status: { padding: 12, gap: 10, alignItems: 'center', justifyContent: 'center' }, result: { padding: 16, borderRadius: 18, gap: 12 },
  markup: { flex: 1 }, controls: { paddingHorizontal: 8, paddingVertical: 4 }, swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 3 },
});

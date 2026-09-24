import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { ScreenHeader } from '@/components/screen-header';
import { ToolButton } from '@/components/tool-button';
import { showDialog } from '@/components/app-dialog';
import { AppLoader, withLoading } from '@/components/app-loader';
import { ColorSwatches } from '@/components/color-swatches';
import { DEFAULT_TEXT_STYLE, fontName, styleFromFont, TextStyleControls, type TextStyle } from '@/components/text-style-controls';
import { askSaveMode, newFileName, saveEditedOutput } from './save-file';
import { toast } from '@/components/toast';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing as s } from '@/theme/dashboard';
import { useScreenActive } from '@/hooks/use-screen-active';
import { FileEngine, type RecognizedImageText, type RecognizedTextLine } from '../../../modules/file-engine';
import NativeEditCanvas from '../../../modules/pdf-engine/src/PdfEditCanvasView';
import { getRecentFile, type RecentFile } from './recent-files';
import { formatSize, shareFile } from './file-storage';

type Erase = { x: number; y: number; width: number; height: number; background: number; left: number; right: number };
/** Sizes are pixels of the analysed image, which is `analysis.width` wide. */
/** `font` is a standard PDF font name (Helvetica-Bold, Times-Italic, …); `text` may hold several lines. */
type TextEdit = { lineId?: number; erase?: Erase; text: string; font: string; size: number; color: number; x: number; y: number; underline?: boolean };
type Preview = { uri: string; width: number; height: number };

const PREVIEW_SIZE = 1600;
const MAX_HISTORY = 30;
const outputDirectory = () => new Directory(Paths.document, 'Versara Images');

/** Line boxes include ascenders and descenders; this maps them to a font size and baseline. */
function lineMetrics(line: RecognizedTextLine, analysis: RecognizedImageText) {
  const heightPx = line.height * analysis.height;
  const size = Math.max(4, heightPx / 1.15);
  return { size, x: line.x, y: (line.y * analysis.height + heightPx - size * 0.2) / analysis.height };
}
const eraseFor = (line: RecognizedTextLine): Erase => ({ x: line.x, y: line.y, width: line.width, height: line.height, background: line.background, left: line.backgroundLeft, right: line.backgroundRight });

/**
 * Recognition, erasing and drawing are native; the page, hit-testing and text box are the native edit canvas.
 * 'edit' finds and replaces text already in the image; 'add' places new text and skips recognition.
 */
export function ImageTextEditorScreen({ id, mode }: { id: string; mode: 'add' | 'edit' }) {
  const addOnly = mode === 'add';
  const colors = usePalette();
  const active = useScreenActive();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const sideWidth = Math.round(Math.min(420, Math.max(300, width * 0.4)));
  const [file, setFile] = useState<RecentFile | null>(null);
  const [analysis, setAnalysis] = useState<RecognizedImageText | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState<TextEdit[]>([]);
  const [history, setHistory] = useState<TextEdit[][]>([]);
  const [future, setFuture] = useState<TextEdit[][]>([]);
  const [line, setLine] = useState<RecognizedTextLine | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const adding = addOnly;
  const [placement, setPlacement] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const [textStyle, setTextStyle] = useState<TextStyle>(DEFAULT_TEXT_STYLE);
  const [sizeInput, setSizeInput] = useState('32');
  const [indent, setIndent] = useState(0);
  const [ink, setInk] = useState(0x101010);
  const [busy, setBusy] = useState(false);
  const [session] = useState(() => new Directory(Paths.cache, `image-text-${Date.now()}`));
  const mounted = useRef(true);
  const ticket = useRef(0);
  const closeRef = useRef(() => {});

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const value = await getRecentFile(id);
        if (!value || !new File(value.uri).exists) throw new Error('This image is no longer available. Open it again from your files.');
        if (!FileEngine?.nativeImageTextVersion || !NativeEditCanvas) throw new Error('Install a new development build to edit text in images.');
        const engine = FileEngine;
        const result = await withLoading(addOnly ? 'Opening your image…' : 'Finding text in your image…', async () => {
          session.create({ intermediates: true, idempotent: true });
          const found = addOnly ? null : await engine.recognizeImageText(value.uri);
          const first = await engine.renderImageText(JSON.stringify({ uri: value.uri, outputUri: new File(session, `preview-${++ticket.current}.jpg`).uri, refWidth: found?.width ?? 1, edits: [], maxSize: PREVIEW_SIZE, preview: true }));
          // Added text is measured against the preview width, which the full-size export scales from.
          return { found: found ?? { width: first.width, height: first.height, lines: [] }, first };
        });
        if (cancelled) return;
        setFile(value); setAnalysis(result.found); setPreview(result.first);
        if (addOnly) toast('Tap the image where the text should start.');
        else if (!result.found.lines.length) toast('No text was found in this image.', true);
        else toast(`Found ${result.found.lines.length} line${result.found.lines.length === 1 ? '' : 's'} of text`);
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message || 'Could not read text in this image.');
      }
    })();
    return () => { cancelled = true; mounted.current = false; };
  }, [id, session, addOnly]);

  useEffect(() => () => {
    const clean = () => { try { if (session.exists) session.delete(); } catch { /* Cache is cleared by the system. */ } };
    clean();
  }, [session]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => subscription.remove();
  }, []);

  const boxOpen = !!placement && (!!line || adding);
  const font = fontName(textStyle);
  const size = Math.min(2000, Math.max(4, Number(sizeInput) || 4));
  const underline = textStyle.underline;
  const indentStep = analysis ? Math.max(8, Math.round(analysis.width / 32)) : 24;
  // Edits are drawn natively over the base preview; an open line is erased there while the text box shows the new text.
  const draftEdits = useMemo(() => {
    const base = editing === null ? edits : edits.filter((_, index) => index !== editing);
    return line ? [...base, { lineId: line.id, erase: eraseFor(line), text: '', font, size, color: ink, x: 0, y: 0 }] : base;
  }, [edits, editing, line, font, size, ink]);
  function changeIndent(next: number) {
    const value = Math.max(0, Math.min(indentStep * 20, next));
    if (placement && analysis) setPlacement({ ...placement, x: Math.max(0, Math.min(1, placement.x + (value - indent) / analysis.width)) });
    setIndent(value);
  }
  const annotations = useMemo(() => JSON.stringify(draftEdits), [draftEdits]);
  function closeBox() { setLine(null); setEditing(null); setPlacement(null); setText(''); setIndent(0); }
  function selectLine(lineId: number) {
    if (!analysis || busy) return;
    const target = analysis.lines.find(item => item.id === lineId);
    if (!target) return;
    const index = edits.findIndex(edit => edit.lineId === lineId);
    const existing = index >= 0 ? edits[index] : null;
    const metrics = lineMetrics(target, analysis);
    setLine(target); setEditing(index >= 0 ? index : null); setError('');
    setText(existing?.text ?? target.text);
    setTextStyle(styleFromFont(existing?.font ?? 'Helvetica', existing?.underline));
    setSizeInput(String(Math.round(existing?.size ?? metrics.size)));
    setIndent(0);
    setInk(existing?.color ?? target.color);
    setPlacement(existing && existing.text ? { x: existing.x, y: existing.y } : { x: metrics.x, y: metrics.y });
  }
  function place(point: { x: number; y: number }) {
    if (busy) return;
    if (!placement && !line) { setText(''); setEditing(null); setIndent(0); if (analysis) setSizeInput(String(Math.max(12, Math.round(analysis.width / 24)))); }
    setPlacement(point);
  }
  function commit(next: TextEdit[]) {
    if (next.length > 500) { setError('Save these changes before adding more.'); return; }
    setHistory(current => [...current, edits].slice(-MAX_HISTORY)); setFuture([]);
    setEdits(next); closeBox();
  }
  function apply(value = text) {
    if (!placement) return;
    if (/[\r\t]/.test(value)) { setError('Tabs are not supported. Use Indent instead.'); return; }
    if (value.split('\n').length > 50) { setError('Use up to 50 lines in one text box.'); return; }
    if (!line && !value.trim()) { setError('Type some text first.'); return; }
    const edit: TextEdit = { lineId: line?.id, erase: line ? eraseFor(line) : undefined, text: value, font, size, color: ink, ...(underline ? { underline } : {}), ...placement };
    commit(editing === null ? [...edits, edit] : edits.map((item, index) => index === editing ? edit : item));
  }
  function removeText() {
    if (line) {
      const edit: TextEdit = { lineId: line.id, erase: eraseFor(line), text: '', font, size, color: ink, x: 0, y: 0 };
      commit(editing === null ? [...edits, edit] : edits.map((item, index) => index === editing ? edit : item));
    } else if (editing !== null) commit(edits.filter((_, index) => index !== editing));
    else closeBox();
  }
  function undo() {
    if (!history.length) return;
    setFuture(current => [...current, edits].slice(-MAX_HISTORY));
    setEdits(history[history.length - 1]); setHistory(current => current.slice(0, -1)); closeBox();
  }
  function redo() {
    if (!future.length) return;
    setHistory(current => [...current, edits].slice(-MAX_HISTORY));
    setEdits(future[future.length - 1]); setFuture(current => current.slice(0, -1)); closeBox();
  }

  function close() { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }
  function requestClose() {
    if (!edits.length || busy) { close(); return; }
    showDialog('Discard text edits?', 'Your changes to this image have not been saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: close }], { ios: 'textformat', android: 'text-fields' });
  }
  useEffect(() => { closeRef.current = requestClose; });

  async function save() {
    if (!file || !analysis || !FileEngine || busy || !edits.length) return;
    if (boxOpen) { showDialog('Text box still open', 'Apply or cancel this text before saving the image.', undefined, { ios: 'character.textbox', android: 'text-fields' }); return; }
    const engine = FileEngine;
    const png = file.mimeType === 'image/png';
    const mode = await askSaveMode(file.name, png ? 'image/png' : 'image/jpeg');
    if (!mode || !mounted.current) return;
    setBusy(true); setError('');
    const base = file.name.replace(/\.[a-zA-Z0-9]{1,8}$/, '').replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 60) || 'Image';
    const stamp = new Date().toISOString().replace(/[T:.]/g, '-').replace(/Z$/, '');
    const name = `${base}-text-${stamp}${png ? '.png' : '.jpg'}`;
    try {
      const directory = outputDirectory();
      directory.create({ intermediates: true, idempotent: true });
      const output = new File(directory, name);
      const { result, saved } = await withLoading('Saving your image…', async () => {
        const rendered = await engine.renderImageText(JSON.stringify({ uri: file.uri, outputUri: output.uri, refWidth: analysis.width, edits, format: png ? 'png' : 'jpeg', quality: 92 }));
        const stored = await saveEditedOutput({ output: rendered.uri, mimeType: rendered.mimeType, kind: 'image', mode, origin: file, name: newFileName(file.name.replace(/\.[a-zA-Z0-9]{1,8}$/, '') + (png ? '.png' : '.jpg')) });
        return { result: rendered, saved: stored };
      });
      toast(`Saved to ${saved.device.location}`);
      if (!mounted.current) return;
      if (mode === 'replace' && saved.recent) { router.replace({ pathname: '/file-preview', params: { id: saved.recent.id } }); return; }
      setHistory([]); setFuture([]);
      showDialog('Image saved', `${saved.file.name}\n${result.width} × ${result.height} · ${formatSize(result.size)}\nSaved to ${saved.device.location}`, [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Share', onPress: () => { void shareFile({ uri: saved.file.uri, mimeType: result.mimeType }).catch(() => {}); } },
        ...(saved.recent ? [{ text: 'Open', onPress: () => router.replace({ pathname: '/file-preview', params: { id: saved.recent!.id } }) }] : []),
      ], { ios: 'checkmark.circle', android: 'check-circle' });
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message || 'Could not save the image.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const objectsJson = useMemo(() => JSON.stringify(analysis?.lines.map(item => ({ id: item.id, x: item.x, y: item.y, width: item.width, height: item.height })) ?? []), [analysis]);
  return <KeyboardAvoidingView style={[styles.screen, { backgroundColor: colors.systemBackground }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScreenHeader title={addOnly ? 'Add text' : 'Edit text'} onBack={requestClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Save image with text changes" disabled={!edits.length || busy} onPress={() => { void save(); }}
        style={[styles.save, getGradients(colors).module, (!edits.length || busy) && styles.disabled]}>
        <ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>Save</ThemedText>
      </Pressable>
    </ScreenHeader>
    {!!error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
    {!analysis || !preview || !file ? <View style={styles.center}>{!error && <AppLoader size="large" />}</View> : <View style={[styles.grow, landscape && styles.row]}>
      <View style={styles.grow}>
        {active && NativeEditCanvas && <NativeEditCanvas key={file.uri} style={styles.grow} source={preview.uri}
          pageLayout={JSON.stringify({ width: preview.width, height: preview.height, pointWidth: analysis.width })}
          objects={objectsJson} annotations={annotations} selectedId={line?.id ?? -1} adding={adding} disabled={busy} placement={placement ? JSON.stringify(placement) : ''}
          textBox={JSON.stringify({ visible: boxOpen, text, font, size, color: ink, underline })}
          focus={line ? JSON.stringify({ x: line.x, y: line.y, width: line.width, height: line.height }) : ''}
          onSelectObject={({ nativeEvent }) => selectLine(nativeEvent.id)}
          onPlace={({ nativeEvent }) => place(nativeEvent)}
          onTextChange={({ nativeEvent }) => setText(nativeEvent.text)}
          onSubmitText={({ nativeEvent }) => apply(nativeEvent.text)} />}
      </View>
      <View style={landscape ? [styles.side, { width: sideWidth, borderColor: colors.separator }] : undefined}>
      <ThemedText numberOfLines={landscape ? 3 : 2} style={[styles.hint, { color: colors.secondaryLabel }]}>
        {boxOpen ? 'Type in the box on the image. Return starts a new line. Drag the blue handle to move it.' : addOnly ? 'Tap where the new text should start. Pinch to zoom.' : analysis.lines.length ? 'Tap any outlined text to change it. Pinch to zoom.' : 'No text was found in this image. Use Add text to write new text instead.'}
      </ThemedText>
      <View style={[landscape ? styles.sideDock : styles.dock, { borderColor: colors.separator }]}>
        {boxOpen ? <ScrollView style={landscape ? styles.grow : styles.panel} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
          <TextStyleControls style={textStyle} onChange={setTextStyle} size={sizeInput} onSizeChange={setSizeInput} sizeUnit="px" minSize={4} maxSize={2000} disabled={busy}
            indent={indent} indentStep={indentStep} onIndentChange={changeIndent} />
          <ColorSwatches value={ink} disabled={busy} original={line ? { label: 'Original', value: line.color } : undefined} onChange={value => { if (value !== null) setInk(value); }} />
          <View style={styles.row}>
            <View style={styles.grow}><ToolButton title={line ? 'Apply change' : 'Add text'} disabled={busy || (!line && !text.trim())} onPress={() => apply()} /></View>
            {(line || editing !== null) && <ToolButton title={line ? 'Remove text' : 'Delete'} secondary disabled={busy} onPress={removeText} />}
            <ToolButton title="Cancel" secondary disabled={busy} onPress={closeBox} />
          </View>
          {!!line && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>The old text is covered with the colour around it. This works best on plain backgrounds.</ThemedText>}
        </ScrollView> : <View style={[styles.row, landscape && styles.wrap]}>
          {!addOnly && !analysis.lines.length && <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.replace({ pathname: '/image-text', params: { id, mode: 'add' } })}
            style={[styles.action, { backgroundColor: colors.accentSurface }]}>
            <UniversalIcon ios="text.badge.plus" android="text-fields" size={20} color={colors.systemBlue} />
            <ThemedText style={[styles.chipText, { color: colors.systemBlue }]}>Add text instead</ThemedText>
          </Pressable>}
          <Pressable accessibilityRole="button" disabled={busy || !history.length} onPress={undo} style={[styles.action, { backgroundColor: colors.accentSurface, opacity: history.length ? 1 : 0.5 }]}>
            <UniversalIcon ios="arrow.uturn.backward" android="undo" size={20} color={colors.systemBlue} />
            <ThemedText style={[styles.chipText, { color: colors.systemBlue }]}>Undo</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy || !future.length} onPress={redo} style={[styles.action, { backgroundColor: colors.accentSurface, opacity: future.length ? 1 : 0.5 }]}>
            <UniversalIcon ios="arrow.uturn.forward" android="redo" size={20} color={colors.systemBlue} />
            <ThemedText style={[styles.chipText, { color: colors.systemBlue }]}>Redo</ThemedText>
          </Pressable>
          <ThemedText style={[styles.grow, styles.note, { color: colors.secondaryLabel }]}>{edits.length ? `${edits.length} change${edits.length === 1 ? '' : 's'}` : addOnly ? 'No text added yet' : `${analysis.lines.length} text line${analysis.lines.length === 1 ? '' : 's'} found`}</ThemedText>
        </View>}
      </View>
      </View>
    </View>}
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.xl },
  error: { paddingHorizontal: s.md, paddingVertical: s.xs },
  save: { minHeight: 40, minWidth: 68, borderRadius: 20, paddingHorizontal: s.lg, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  hint: { fontSize: 12, textAlign: 'center', paddingVertical: 4, paddingHorizontal: s.md },
  dock: { borderTopWidth: StyleSheet.hairlineWidth, padding: s.sm },
  panel: { maxHeight: 260, flexGrow: 0 },
  side: { borderLeftWidth: StyleSheet.hairlineWidth },
  sideDock: { flex: 1, padding: s.sm },
  wrap: { flexWrap: 'wrap' },
  panelContent: { gap: s.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  chipText: { fontSize: 13, fontWeight: '600' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, borderRadius: radius.sm, paddingHorizontal: s.md },
  note: { fontSize: 12, lineHeight: 16 },
});

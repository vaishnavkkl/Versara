import { rememberPdfResults } from '../files/recent-files';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { PdfEditCanvas, type PdfTextObject } from './pdf-edit-canvas';
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
import { PdfViewer } from './pdf-viewer';
import { PdfPreviewQueue, type PagePreview } from './pdf-preview-queue';
import { useScreenActive } from '@/hooks/use-screen-active';

type TextObject = PdfTextObject;
type Font = 'original' | 'Helvetica' | 'Times-Roman' | 'Courier';
type Edit = { page: number; kind: 'replace' | 'delete' | 'add'; objectId?: number; original?: string; text?: string; font?: Font; size?: number; x?: number; y?: number; color?: number };
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function makeDraft(edits: Edit[], page: number, selected: TextObject | null, placement: { x: number; y: number } | null, addition: number | null, text: string, font: Font, size: string, color: number): { changes: Edit[]; error?: string } {
  if (!selected && !placement) return { changes: edits };
  if (/[\n\r\t]/.test(text)) return { changes: edits, error: 'Use one line per text box.' };
  let command: Edit;
  if (selected) {
    const existing = edits.find(edit => edit.page === page && edit.objectId === selected.id);
    if (text === (existing?.text ?? selected.text) && font === (existing?.font ?? 'original') && existing?.kind !== 'delete') return { changes: edits };
    command = { kind: text.trim() ? 'replace' : 'delete', page, objectId: selected.id, original: selected.text, text, font };
  } else {
    if (!text.trim()) return { changes: addition === null ? edits : edits.filter((_, index) => index !== addition) };
    const points = Number(size);
    if (!Number.isFinite(points) || points < 4 || points > 200) return { changes: edits, error: 'Choose a font size from 4 to 200.' };
    command = { kind: 'add', page, ...placement!, text, size: points, font: font === 'original' ? 'Helvetica' : font, color };
  }
  const changes = command.kind === 'add'
    ? addition === null ? [...edits, command] : edits.map((edit, index) => index === addition ? command : edit)
    : [...edits.filter(edit => !(edit.page === page && edit.objectId === selected?.id)), command];
  return changes.length > 500 ? { changes: edits, error: 'Save these changes before adding more.' } : { changes };
}

export function PdfTextEditor({ initialMode = 'edit', initialSelection }: { initialMode?: 'edit' | 'add' | 'delete'; initialSelection?: InitialSelection }) {
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
  const [history, setHistory] = useState<Edit[][]>([]);
  const [selected, setSelected] = useState<TextObject | null>(null);
  const [fragmentPage, setFragmentPage] = useState(0);
  const [editingAddition, setEditingAddition] = useState<number | null>(null);
  const [placement, setPlacement] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(initialMode === 'add');
  const [text, setText] = useState('');
  const [font, setFont] = useState<Font>('original');
  const [size, setSize] = useState('16');
  const [ink, setInk] = useState(0x101020);
  const [name, setName] = useState('Edited PDF');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [previewStatus, setPreviewStatus] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [draftRevision, setDraftRevision] = useState(0);
  const [result, setResult] = useState<(PdfResult & { name: string }) | null>(null);
  const [viewResult, setViewResult] = useState(false);
  const [showTextList, setShowTextList] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const job = useRef<string | null>(null);
  const obsoleteImages = useRef<{ uri: string; expires: number }[]>([]);
  const displayedPreview = useRef<PagePreview | null>(null);

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
  const draft = makeDraft(edits, page, selected, placement, editingAddition, text, font, size, ink);
  const draftJson = JSON.stringify(draft.changes.filter(edit => edit.page === page));
  const draftIssue = draft.error;
  const sourceUri = source?.uri;
  const publishLivePreview = useEffectEvent((next: PagePreview) => showPreview(next));
  useEffect(() => {
    if (!screenActive) { if (!locked.current) previewQueue.cancel(); return; }
    if (!sourceUri || busy || result) return;
    let current = true;
    const timer = setTimeout(() => {
      if (locked.current || !mounted.current) return;
      if (draftIssue) { setPreviewError(draftIssue); setPreviewStatus('Preview paused'); return; }
      setPreviewError(''); setPreviewStatus('Updating preview...');
      void previewQueue.render(sourceUri, page, draftJson).then(next => {
        if (!current || !mounted.current || locked.current || !next) return;
        publishLivePreview(next); setPreviewStatus('Live preview');
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
  const placeText = useCallback((point: { x: number; y: number }) => {
    invalidateDraft(); setPlacement(point); setShowTextList(false); setShowOptions(false);
    if (editingAddition === null && !placement) { setFont('Helvetica'); setText(''); }
  }, [editingAddition, placement, invalidateDraft]);

  useInitialFiles(initialSelection, available, choose);

  async function choose(initialFiles?: LocalFile[]) {
    if (locked.current || !available) return;
    begin('Opening your PDF...');
    let picked: LocalFile | undefined;
    let accepted = false;
    try {
      [picked] = initialFiles ?? await browseFiles(directory, false, 1, true);
      if (!picked || !mounted.current) return;
      const next = await loadPage(picked, 0, []);
      if (!next) return;
      if (source) { try { new File(source.uri).delete(); } catch { /* Session cleanup retries. */ } }
      setSource(picked); setPage(0); setPageInput('1'); setFragmentPage(0); setEditingAddition(null); showPreview(next);
      setEdits([]); setHistory([]); setSelected(null); setPlacement(null);
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
    setShowTextList(false); setShowOptions(false); setAdding(false); setPlacement(null); setEditingAddition(null); setSelected(object); setText(existing?.text ?? object.text); setFont(existing?.font ?? 'original'); setError('');
  }, [edits, page, invalidateDraft]);
  async function change(next: Edit[], undo = false) {
    if (!source || locked.current) return;
    begin('Updating preview...');
    try {
      const nextPreview = await loadPage(source, page, next);
      if (nextPreview) {
        showPreview(nextPreview);
        setHistory(current => undo ? current.slice(0, -1) : [...current, edits].slice(-30));
        setEdits(next); setSelected(null); setPlacement(null); setEditingAddition(null); setText('');
      }
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  function apply(kind: 'replace' | 'delete' | 'add') {
    if (locked.current) return;
    if (kind !== 'delete' && (!text.trim() || /[\n\r\t]/.test(text))) { setError('Enter one line of text. Add another text box for a new line.'); return; }
    let command: Edit;
    if (kind === 'add') {
      if (!placement) return;
      const points = Number(size);
      if (!Number.isFinite(points) || points < 4 || points > 200) { setError('Choose a font size from 4 to 200.'); return; }
      command = { kind, page, ...placement, text, size: points, font: font === 'original' ? 'Helvetica' : font, color: ink };
    } else {
      if (!selected) return;
      command = { kind, page, objectId: selected.id, original: selected.text, text, font };
    }
    const next = kind === 'add'
      ? editingAddition === null ? [...edits, command] : edits.map((edit, index) => index === editingAddition ? command : edit)
      : [...edits.filter(edit => !(edit.page === page && edit.objectId === selected?.id)), command];
    if (next.length > 500) { setError('Save these changes before adding more.'); return; }
    void change(next);
  }
  async function save() {
    if (!source || !PdfEngine || locked.current || !edits.length) return;
    begin('Saving your PDF...'); setProgress(0);
    const id = newId(); job.current = id;
    const filename = `${name.trim().replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 80) || 'Edited PDF'}-${id}.pdf`;
    try {
      await previewQueue.settle();
      if (!mounted.current) return;
      const outputUri = new File(savedPdfDirectory(), filename).uri;
      const output: PdfResult = JSON.parse(await PdfEngine.editPdfText(id, JSON.stringify({ action: 'save', uri: source.uri, outputUri, edits })));
      if (mounted.current) setResult({ ...output, name: filename });
      // History failure must not discard an otherwise successful native export.
      void rememberPdfResults([{ ...output, name: filename }]).catch(() => {});
    } catch (cause) { fail(cause); }
    finally { finish(); }
  }
  function requestSave() {
    if (selected || placement) {
      Alert.alert('Text box still open', 'Apply or cancel this text box before saving the PDF.'); return;
    }
    void save();
  }
  async function exportResult() {
    if (!result || locked.current) return;
    begin('Opening save options...');
    try { await shareFile({ ...result, mimeType: 'application/pdf' }); }
    catch (cause) { fail(cause); }
    finally { finish(); }
  }

  if (viewResult && result) return <PdfViewer initialDocument={result} onBack={() => setViewResult(false)} />;
  if (result) return <ScrollView contentContainerStyle={styles.form}>
    <ThemedText style={styles.heading}>Your edited PDF is ready</ThemedText>
    <ThemedText>Your changes are saved in a new PDF. Your original is unchanged.</ThemedText>
    <ThemedText>{result.name}</ThemedText>
    <ToolButton title="Open PDF" disabled={busy} onPress={() => setViewResult(true)} />
    <ToolButton title="Save to device / share" disabled={busy} onPress={exportResult} />
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
        <Pressable accessibilityRole="button" accessibilityLabel={adding ? 'Select existing text' : 'Add text'} disabled={busy} onPress={() => { invalidateDraft(); setAdding(!adding); setSelected(null); setPlacement(null); setEditingAddition(null); setText(''); setFont('Helvetica'); setShowTextList(false); }} style={[styles.icon, { backgroundColor: adding ? colors.accentSurface : 'transparent' }]}><UniversalIcon ios="text.badge.plus" android="text-fields" size={24} color={colors.systemBlue} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="PDF options" disabled={busy} onPress={() => { setShowOptions(!showOptions); setShowTextList(false); }} style={styles.icon}><UniversalIcon ios="ellipsis" android="more-horiz" size={24} color={colors.systemBlue} /></Pressable>
      </View>
      {screenActive ? <PdfEditCanvas key={source.uri + ':' + page} uri={preview.imageUri} width={preview.width} height={preview.height} objects={preview.objects} selectedId={selected?.id} adding={adding} disabled={busy} placement={placement}
        removedIds={removedIds} onSelect={select} onPlace={placeText} /> : <View style={styles.grow} />}
      <ThemedText numberOfLines={1} style={[styles.hint, { color: colors.secondaryLabel }]}>{adding ? 'Tap to place text. Pinch to zoom.' : 'Pinch to zoom. Tap text to edit.'}</ThemedText>
      {(selected || placement || showTextList || showOptions) && <ScrollView style={styles.dock} contentContainerStyle={styles.dockContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {(selected || placement) && <View style={[styles.editPanel, { backgroundColor: colors.secondarySystemBackground }]}>
          <View style={styles.row}><ThemedText style={[styles.label, styles.grow]}>{selected ? 'Selected text' : 'New text'}</ThemedText><ThemedText style={{ color: colors.secondaryLabel, fontSize: 12 }}>{previewStatus}</ThemedText></View>
          <TextInput accessibilityLabel="PDF text" value={text} onChangeText={value => { invalidateDraft(); setText(value); }} editable={!busy} maxLength={4000} placeholder="Enter text" placeholderTextColor={colors.secondaryLabel} style={inputStyle} />
          {!!previewError && <ThemedText accessibilityRole="alert">{previewError}</ThemedText>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
            {(selected ? ['original', 'Helvetica', 'Times-Roman', 'Courier'] as const : ['Helvetica', 'Times-Roman', 'Courier'] as const).map(value => <ToolButton key={value} title={value === 'original' ? 'Original font' : value === 'Times-Roman' ? 'Times' : value} secondary={font !== value} disabled={busy} onPress={() => { invalidateDraft(); setFont(value); }} />)}
          </ScrollView>
          {placement && <>
            <ThemedText style={styles.label}>Font size</ThemedText>
            <TextInput accessibilityLabel="Font size in points" keyboardType="decimal-pad" value={size} onChangeText={value => { invalidateDraft(); setSize(value); }} maxLength={5} editable={!busy} style={inputStyle} />
            <View style={styles.row}>{[{ value: 0x101020, label: 'Black' }, { value: 0x122b86, label: 'Blue' }, { value: 0xb92332, label: 'Red' }].map(color => <View key={color.value} style={styles.grow}><ToolButton title={color.label} secondary={ink !== color.value} disabled={busy} onPress={() => { invalidateDraft(); setInk(color.value); }} /></View>)}</View>
          </>}
          {selected && <ThemedText style={{ color: colors.secondaryLabel }}>Replacement keeps the text position. Longer text does not reflow the document. If the original font is missing characters, try Helvetica.</ThemedText>}
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
        {showTextList && edits.some(edit => edit.kind === 'add' && edit.page === page) && <View style={styles.editPanel}><ThemedText style={styles.label}>Text you added</ThemedText>{edits.map((edit, index) => edit.kind === 'add' && edit.page === page && <Pressable key={index} accessibilityRole="button" accessibilityLabel={`Edit added text: ${edit.text}`} disabled={busy} style={[styles.textRow, { borderColor: colors.separator }]} onPress={() => { invalidateDraft(); setAdding(true); setSelected(null); setEditingAddition(index); setPlacement({ x: edit.x ?? 0, y: edit.y ?? 0 }); setText(edit.text ?? ''); setSize(String(edit.size ?? 16)); setFont(edit.font ?? 'Helvetica'); setInk(edit.color ?? 0x101020); }}><ThemedText numberOfLines={2}>{edit.text}</ThemedText></Pressable>)}</View>}

        {showOptions && <View style={styles.editPanel}>
          <ThemedText numberOfLines={2}>{source.name}</ThemedText>
          <ThemedText style={styles.label}>New PDF name</ThemedText>
          <TextInput accessibilityLabel="New PDF name" value={name} onChangeText={setName} editable={!busy} maxLength={100} style={inputStyle} />
          <ToolButton title="Choose another PDF" secondary disabled={busy} onPress={() => {
            if (edits.length) Alert.alert('Choose another PDF?', 'Your unsaved changes will be discarded.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Choose PDF', onPress: () => { void choose(); } }]);
            else void choose();
          }} />
          <ThemedText style={{ color: colors.secondaryLabel }}>Scans and text inside embedded groups cannot be edited. Delete removes page text; it is not secure redaction.</ThemedText>
        </View>}
      </ScrollView>}
    </> : <View style={styles.empty}>
      {busy ? <ActivityIndicator size="large" color={colors.systemBlue} /> : <>
        <ThemedText>{available ? 'Choose a PDF to start editing.' : 'Install a new development build to use the native editor.'}</ThemedText>
        <ToolButton title="Choose PDF" disabled={!available} onPress={() => choose()} />
      </>}
    </View>}
    <View style={[styles.footer, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy ? <View style={styles.row}><ActivityIndicator color={colors.systemBlue} /><ThemedText style={styles.grow} accessibilityLiveRegion="polite">{phase}{progress !== null ? ' ' + Math.round(progress * 100) + '%' : ''}</ThemedText><ToolButton title="Cancel" secondary onPress={() => { previewQueue.cancel(); if (job.current) PdfEngine?.cancelTextEdit(job.current); }} /></View> : source && <View style={styles.row}>
        <ToolButton title="Undo" secondary disabled={!history.length} onPress={() => change(history[history.length - 1], true)} />
        <ToolButton title="Text list" secondary onPress={() => { invalidateDraft(); setShowTextList(!showTextList); setShowOptions(false); setSelected(null); setPlacement(null); setAdding(false); }} />
        <View style={styles.grow}><ToolButton title={'Save (' + edits.length + ')'} disabled={!edits.length} onPress={requestSave} /></View>
      </View>}
    </View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, form: { padding: s.lg, gap: s.md }, heading: { ...t.heading }, label: { ...t.label },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.sm }, grow: { flex: 1, minWidth: 0 },
  input: { minHeight: 48, padding: s.md, borderRadius: radius.sm, ...t.body }, pageNumber: { width: 54, textAlign: 'center', paddingHorizontal: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }, icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  dock: { maxHeight: '44%', flexGrow: 0 }, dockContent: { gap: 8 }, hint: { fontSize: 12, textAlign: 'center', paddingVertical: 4 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16 },
  placement: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#1565ff', transform: [{ translateX: -7 }, { translateY: -7 }] },
  editPanel: { gap: s.md, padding: s.md, borderRadius: radius.md }, textList: { maxHeight: 180 }, textRow: { paddingVertical: s.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  footer: { padding: s.sm, gap: s.sm, borderTopWidth: StyleSheet.hairlineWidth },
});

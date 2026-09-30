import { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showDialog, type DialogAction } from '@/components/app-dialog';
import { ThemedText } from '@/components/themed-text';
import { toast } from '@/components/toast';
import { UniversalIcon } from '@/components/universal-icon';
import { withLoading } from '@/components/app-loader';
import { DocEditorView, DocEngine, hasHeaderFooter, hasPageSetup, isDocEditorAvailable, type DocFormat, type HeaderFooter, type PageSetup } from '../../../modules/doc-engine';
import { EMPTY_BANDS, FormatSheet, HeaderFooterSheet, IconToggle, InsertSheet, MoreSheet, PAPER, PageSetupSheet, alignIcon } from '@/features/documents/doc-editor-sheets';
import { askNewFileName, saveEditedOutput } from '@/features/files/save-file';
import type { OptionIcon } from '@/theme/editor-icons';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t } from '@/theme/dashboard';

const outputFile = (extension: string) => {
  const folder = new Directory(Paths.cache, 'versara-doc-output');
  folder.create({ intermediates: true, idempotent: true });
  return new File(folder, `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
};
const DEFAULT_FORMAT: DocFormat = { bold: false, italic: false, underline: false, strike: false, align: 'left', list: 'none', size: 11, image: false };
type Sheet = 'format' | 'insert' | 'bands' | 'more' | 'page' | null;
const DEFAULT_PAGE: PageSetup = { w: PAPER.letter.w, h: PAPER.letter.h, top: 1440, right: 1440, bottom: 1440, left: 1440 };

function parseBands(value?: string): HeaderFooter {
  if (!value) return EMPTY_BANDS;
  try { return { ...EMPTY_BANDS, ...(JSON.parse(value) as Partial<HeaderFooter>) }; } catch { return EMPTY_BANDS; }
}

function parsePage(value?: string): PageSetup {
  if (!value) return DEFAULT_PAGE;
  try { return { ...DEFAULT_PAGE, ...(JSON.parse(value) as Partial<PageSetup>) }; } catch { return DEFAULT_PAGE; }
}

export function DocEditorScreen() {
  const params = useLocalSearchParams<{ uri?: string; name?: string; format?: string; blank?: string; export?: string }>();
  const colors = usePalette();
  const { width } = useWindowDimensions();
  const compactHeader = width < 500;
  const [rotated, setRotated] = useState(false);
  const blank = params.blank === '1';
  const format = params.format === 'txt' ? 'txt' : 'docx';
  const name = params.name || (format === 'txt' ? 'Untitled.txt' : 'Untitled.docx');
  const [page, setPage] = useState<PageSetup>(DEFAULT_PAGE);
  const [showRuler, setShowRuler] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [section, setSection] = useState({ index: 0, count: 1 });
  const [locked, setLocked] = useState(0);
  const [lockedSeen, setLockedSeen] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [fmt, setFmt] = useState<DocFormat>(DEFAULT_FORMAT);
  const [bands, setBands] = useState<HeaderFooter>(EMPTY_BANDS);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [formatTab, setFormatTab] = useState<'text' | 'paragraph'>('text');
  const saving = useRef(false);
  const [target, setTarget] = useState<{ uri: string; name: string } | null>(() => !blank && params.uri ? { uri: params.uri, name } : null);
  const title = target?.name ?? name;
  const dark = colors.systemBackground === '#000000';
  const docx = format === 'docx';

  const run = (command: string, value = '') => { DocEngine?.command(command, value).catch((cause: Error) => setError(cause.message)); };
  const open = (next: Exclude<Sheet, null>) => { run('blur'); setSheet(next); };
  const close = () => setSheet(null);

  function exit() { DocEngine?.discard(); if (router.canGoBack()) router.back(); else router.replace('/(modules)/word'); }

  /** Changes are written only by Save or Save as; leaving with changes asks which one, or to discard. */
  function leave() {
    if (sheet) { close(); return; }
    if (saving.current) return;
    if (!dirty) { exit(); return; }
    run('blur');
    const actions: DialogAction[] = [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard changes', style: 'destructive', onPress: exit },
    ];
    if (target) actions.push({ text: 'Save as…', onPress: () => { void save('saveAs', true); } });
    actions.push({ text: 'Save', onPress: () => { void save(target ? 'save' : 'saveAs', true); } });
    showDialog('Save changes?', target ? `“${title}” has changes that aren’t saved. Save them, save a new copy, or discard them.` : 'This document hasn’t been saved yet. Save it, or discard it.', actions, { ios: 'square.and.arrow.down', android: 'save' });
  }
  const leaveRef = useRef(leave);
  useEffect(() => { leaveRef.current = leave; });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { leaveRef.current(); return true; });
    return () => subscription.remove();
  }, []);

  async function save(mode: 'save' | 'saveAs' | 'docx', exitAfter = false) {
    const engine = DocEngine;
    if (!engine || saving.current) return;
    saving.current = true;
    close();
    const toDocx = mode === 'docx' || docx;
    const extension = toDocx ? '.docx' : '.txt';
    const suggested = title.replace(/\.[^.]+$/, '') + extension;
    const origin = mode === 'save' && target ? target : null;
    try {
      const chosen = origin ? origin.name : await askNewFileName(suggested);
      if (!chosen) return;
      const output = outputFile(toDocx ? 'docx' : 'txt');
      const result = await withLoading('Saving your document…', async () => {
        await engine.save(output.uri);
        return saveEditedOutput({ output: output.uri, mimeType: toDocx ? docxMime : 'text/plain', kind: 'document', mode: origin ? 'replace' : 'new', origin, name: chosen.endsWith(extension) ? chosen : chosen + extension });
      });
      setDirty(false);
      if (mode !== 'docx') setTarget({ uri: result.file.uri, name: result.file.name });
      toast(`Saved to ${result.device.location}`);
      if (exitAfter) exit();
    } catch (cause) { setError((cause as Error).message || 'Could not save this document.'); }
    finally { saving.current = false; }
  }

  async function exportPdf() {
    const engine = DocEngine;
    if (!engine || saving.current) return;
    saving.current = true;
    close();
    const suggested = title.replace(/\.[^.]+$/, '') + '.pdf';
    try {
      const choice = await askNewFileName(suggested);
      if (!choice) return;
      const output = outputFile('pdf');
      await withLoading('Creating a PDF…', async () => {
        await (hasPageSetup ? engine.exportPdf(output.uri) : engine.exportPdf(output.uri, 'a4'));
        await saveEditedOutput({ output: output.uri, mimeType: 'application/pdf', kind: 'pdf', mode: 'new', name: choice.endsWith('.pdf') ? choice : `${choice}.pdf` });
      });
      toast('PDF saved. The layout is simplified.');
    } catch (cause) { setError((cause as Error).message || 'Could not create the PDF.'); }
    finally { saving.current = false; }
  }

  async function exportText() {
    const engine = DocEngine;
    if (!engine || saving.current) return;
    close();
    const output = outputFile('txt');
    saving.current = true;
    try {
      const stored = await withLoading('Saving text…', async () => {
        await engine.exportText(output.uri);
        return saveEditedOutput({ output: output.uri, mimeType: 'text/plain', kind: 'document', mode: 'new', name: title.replace(/\.[^.]+$/, '') + '.txt' });
      });
      toast(`Text saved to ${stored.device.location}`);
    } catch (cause) { setError((cause as Error).message || 'Could not save the text.'); }
    finally { saving.current = false; }
  }

  async function addImage() {
    close();
    try {
      const { getDocumentAsync } = await import('expo-document-picker');
      const picked = await getDocumentAsync({ type: ['image/png', 'image/jpeg', 'image/gif'], copyToCacheDirectory: true, multiple: false });
      if (!picked.canceled) await DocEngine?.insertImage(picked.assets[0].uri);
    } catch (cause) { setError((cause as Error).message || 'Could not insert this image.'); }
  }

  async function applyBands(next: HeaderFooter) {
    close();
    try {
      await DocEngine?.setHeaderFooter(JSON.stringify(next));
      setBands(next);
    } catch (cause) { setError((cause as Error).message || 'Could not update the header and footer.'); }
  }

  async function applyPage(next: PageSetup) {
    close();
    try {
      await DocEngine?.setPage(JSON.stringify(next));
      setPage(next);
    } catch (cause) { setError((cause as Error).message || 'Could not change the page setup.'); }
  }

  const bar = (icon: OptionIcon, label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={2}
    style={({ pressed }) => [styles.barButton, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
    <UniversalIcon {...icon} size={24} color={colors.label} />
  </Pressable>;

  const divider = <View style={[styles.divider, { backgroundColor: colors.separator }]} />;
  const formatBar = fmt.image ? <View style={[styles.formatBar, styles.imageBar, { borderTopColor: colors.separator, backgroundColor: colors.systemBackground }]}>
    <ThemedText style={[styles.barCaption, { color: colors.secondaryLabel }]}>Image</ThemedText>
    <IconToggle icon={{ ios: 'minus.magnifyingglass', android: 'zoom-out' }} label="Make image smaller" onPress={() => { DocEngine?.resizeImage(75).catch((cause: Error) => setError(cause.message)); }} />
    <IconToggle icon={{ ios: 'plus.magnifyingglass', android: 'zoom-in' }} label="Make image larger" onPress={() => { DocEngine?.resizeImage(125).catch((cause: Error) => setError(cause.message)); }} />
    <IconToggle icon={{ ios: 'trash', android: 'delete-outline' }} label="Delete image" onPress={() => run('deleteImage')} />
  </View> : <View style={[styles.formatBar, { borderTopColor: colors.separator, backgroundColor: colors.systemBackground }]}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.formatRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Text styles" onPress={() => { setFormatTab('text'); open('format'); }} style={[styles.styleChip, { backgroundColor: colors.fieldSurface }]}>
        <ThemedText style={styles.styleChipLabel}>Styles</ThemedText>
        <UniversalIcon ios="chevron.down" android="arrow-drop-down" size={16} color={colors.secondaryLabel} />
      </Pressable>
      {divider}
      <IconToggle icon={{ ios: 'bold', android: 'format-bold' }} label="Bold" active={fmt.bold} onPress={() => run('bold')} />
      <IconToggle icon={{ ios: 'italic', android: 'format-italic' }} label="Italic" active={fmt.italic} onPress={() => run('italic')} />
      <IconToggle icon={{ ios: 'underline', android: 'format-underlined' }} label="Underline" active={fmt.underline} onPress={() => run('underline')} />
      <IconToggle icon={{ ios: 'strikethrough', android: 'format-strikethrough' }} label="Strikethrough" active={fmt.strike} onPress={() => run('strike')} />
      <IconToggle icon={{ ios: 'paintbrush.pointed', android: 'format-color-text' }} label="Text and highlight colour" onPress={() => { setFormatTab('text'); open('format'); }} />
      {divider}
      {(['left', 'center', 'right', 'justify'] as const).map(align => <IconToggle key={align} icon={alignIcon(align)} label={`Align ${align}`} active={fmt.align === align} onPress={() => run('align', align)} />)}
      {divider}
      <IconToggle icon={{ ios: 'list.bullet', android: 'format-list-bulleted' }} label="Bulleted list" active={fmt.list === 'bullet'} onPress={() => run('list', fmt.list === 'bullet' ? 'none' : 'bullet')} />
      <IconToggle icon={{ ios: 'list.number', android: 'format-list-numbered' }} label="Numbered list" active={fmt.list === 'decimal'} onPress={() => run('list', fmt.list === 'decimal' ? 'none' : 'decimal')} />
      {hasPageSetup && docx && <>
        <IconToggle icon={{ ios: 'decrease.indent', android: 'format-indent-decrease' }} label="Decrease indent" disabled={(fmt.indent ?? 0) <= 0} onPress={() => run('indent', 'out')} />
        <IconToggle icon={{ ios: 'increase.indent', android: 'format-indent-increase' }} label="Increase indent" disabled={(fmt.indent ?? 0) >= 7200} onPress={() => run('indent', 'in')} />
      </>}
      <IconToggle icon={{ ios: 'eraser', android: 'format-clear' }} label="Clear formatting" onPress={() => run('clear')} />
      {divider}
      <IconToggle icon={{ ios: 'keyboard.chevron.compact.down', android: 'keyboard-hide' }} label="Hide keyboard" onPress={() => run('blur')} />
    </ScrollView>
  </View>;

  const banner = error ? { text: error, onClose: () => setError('') } : locked > 0 && !lockedSeen ? { text: 'Some parts stay in the file but can’t be edited here.', onClose: () => setLockedSeen(true) } : null;

  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.systemBackground }]} edges={['top', 'bottom', 'left', 'right']}>
    <Stack.Screen options={{ gestureEnabled: !dirty, orientation: rotated ? 'landscape' : 'portrait' }} />
    <View style={[styles.topBar, compactHeader && styles.topBarCompact, { borderBottomColor: colors.separator }]}>
      <View style={styles.headerMain}>
      {bar({ ios: 'chevron.left', android: 'arrow-back' }, 'Go back', leave)}
      <View style={styles.titleBlock}>
        <ThemedText accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</ThemedText>
        <ThemedText numberOfLines={1} style={[styles.subtitle, { color: colors.secondaryLabel }]}>
          {!ready ? 'Opening…' : dirty ? 'Unsaved changes' : target ? 'Saved' : 'Not saved yet'}{section.count > 1 ? ` · Part ${section.index + 1} of ${section.count}` : ''}
        </ThemedText>
      </View>
      {!compactHeader && <>
        {bar({ ios: 'arrow.uturn.backward', android: 'undo' }, 'Undo', () => run('undo'), !history.canUndo)}
        {bar({ ios: 'arrow.uturn.forward', android: 'redo' }, 'Redo', () => run('redo'), !history.canRedo)}
        {bar({ ios: 'textformat', android: 'text-format' }, 'Format', () => open('format'), !ready)}
        {bar({ ios: 'plus', android: 'add' }, 'Insert', () => open('insert'), !ready)}
      </>}
      {bar({ ios: 'square.and.arrow.down', android: 'save' }, 'Save document', () => { void save(target ? 'save' : 'saveAs'); }, !ready)}
      {bar({ ios: 'ellipsis', android: 'more-vert' }, 'More options', () => open('more'), !ready)}
      </View>
      {compactHeader && <View style={styles.headerActions}>
        {bar({ ios: 'arrow.uturn.backward', android: 'undo' }, 'Undo', () => run('undo'), !history.canUndo)}
        {bar({ ios: 'arrow.uturn.forward', android: 'redo' }, 'Redo', () => run('redo'), !history.canRedo)}
        {bar({ ios: 'textformat', android: 'text-format' }, 'Format', () => open('format'), !ready)}
        {bar({ ios: 'plus', android: 'add' }, 'Insert', () => open('insert'), !ready)}
      </View>}
    </View>
    {!!banner && <View style={[styles.banner, { backgroundColor: error ? colors.pdfSurface : colors.wordSurface }]}>
      <UniversalIcon ios={error ? 'exclamationmark.triangle' : 'lock'} android={error ? 'error-outline' : 'lock-outline'} size={18} color={error ? colors.pdfInk : colors.wordInk} />
      <ThemedText accessibilityRole={error ? 'alert' : undefined} style={styles.bannerText}>{banner.text}</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={banner.onClose} hitSlop={8}><UniversalIcon ios="xmark" android="close" size={18} color={colors.secondaryLabel} /></Pressable>
    </View>}
    {!isDocEditorAvailable ? <View style={styles.empty}><ThemedText>Install a new development build to edit documents.</ThemedText></View> :
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <DocEditorView style={styles.editor} source={blank ? '' : params.uri} format={format} blank={blank} dark={dark} ruler={showRuler} pages={showPages}
          onReady={event => {
            const info = event.nativeEvent;
            setReady(true); setLocked(info.locked); setSection({ index: info.section, count: info.sections }); setBands(parseBands(info.hf)); setPage(parsePage(info.page));
            if (info.restored) toast('Restored your local draft');
            if (params.export === 'pdf') setSheet('more');
          }}
          onDocChange={event => { const info = event.nativeEvent; setDirty(info.dirty); setHistory({ canUndo: info.canUndo, canRedo: info.canRedo }); setSection({ index: info.section, count: info.sections }); if (info.page) setPage(parsePage(info.page)); }}
          onFormat={event => setFmt(event.nativeEvent)}
          onBand={() => { if (docx && hasHeaderFooter) open('bands'); }}
          onError={event => setError(event.nativeEvent.message)} />
        {section.count > 1 && <View style={[styles.sections, { borderTopColor: colors.separator }]}>
          {bar({ ios: 'chevron.up', android: 'keyboard-arrow-up' }, 'Previous part', () => { void DocEngine?.setSection(section.index - 1); }, section.index === 0)}
          <ThemedText style={[styles.barCaption, { color: colors.secondaryLabel }]}>Part {section.index + 1} of {section.count}</ThemedText>
          {bar({ ios: 'chevron.down', android: 'keyboard-arrow-down' }, 'Next part', () => { void DocEngine?.setSection(section.index + 1); }, section.index >= section.count - 1)}
        </View>}
        {ready && formatBar}
      </KeyboardAvoidingView>}
    <FormatSheet isPresented={sheet === 'format'} onClose={close} tab={formatTab} onTab={setFormatTab} format={fmt} run={run} spacing={hasPageSetup && docx} />
    <InsertSheet isPresented={sheet === 'insert'} onClose={close} docx={docx} bands={hasHeaderFooter} onImage={() => { void addImage(); }}
      onTable={size => { close(); run('table', size); }} onBands={() => setSheet('bands')} />
    <HeaderFooterSheet isPresented={sheet === 'bands'} onClose={close} value={bands} onApply={next => { void applyBands(next); }} />
    <PageSetupSheet isPresented={sheet === 'page'} onClose={close} value={page} onApply={next => { void applyPage(next); }} />
    <MoreSheet isPresented={sheet === 'more'} onClose={close} format={format} rotated={rotated} layout={hasPageSetup} page={page}
      ruler={showRuler} pages={showPages} onRuler={() => setShowRuler(value => !value)} onPages={() => setShowPages(value => !value)} onPageSetup={() => setSheet('page')}
      onSave={mode => { void save(mode); }} onPdf={() => { void exportPdf(); }} onText={() => { void exportText(); }}
      onRotate={() => { close(); setRotated(value => !value); }} />
  </SafeAreaView>;
}
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { minHeight: 56, paddingHorizontal: s.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  topBarCompact: { paddingBottom: 2 },
  headerMain: { minHeight: 56, flexDirection: 'row', alignItems: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', minHeight: 44 },
  titleBlock: { flex: 1, minWidth: 0, paddingHorizontal: s.xs },
  title: { ...t.label, fontSize: 16 },
  subtitle: { fontSize: 12, lineHeight: 16 },
  barButton: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: s.sm, paddingHorizontal: s.md, paddingVertical: s.sm },
  bannerText: { flex: 1, ...t.caption },
  body: { flex: 1 },
  editor: { flex: 1 },
  sections: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s.sm, borderTopWidth: StyleSheet.hairlineWidth },
  formatBar: { borderTopWidth: StyleSheet.hairlineWidth, minHeight: 52, justifyContent: 'center' },
  imageBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s.lg },
  formatRow: { alignItems: 'center', paddingHorizontal: s.sm, gap: 2 },
  barCaption: { ...t.caption },
  styleChip: { minHeight: 36, paddingLeft: s.md, paddingRight: s.sm, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: s.xs },
  styleChipLabel: { fontSize: 14, fontWeight: '600' },
  divider: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: s.xs },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.lg },
});

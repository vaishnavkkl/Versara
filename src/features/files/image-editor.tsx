import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppLoader, withLoading } from '@/components/app-loader';
import { router, Stack } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { Host, Slider } from '@expo/ui';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { ScreenHeader } from '@/components/screen-header';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { useAppearance, usePalette } from '@/theme/colors';
import { getGradients, radius, spacing as s } from '@/theme/dashboard';
import { useScreenActive } from '@/hooks/use-screen-active';
import ImageEditorView, { hasNativeImageEditor, type ImageCrop } from '../../../modules/file-engine/src/ImageEditorView';
import { FileEngine } from '../../../modules/file-engine';
import { getRecentFile, type RecentFile } from './recent-files';
import { askSaveMode, newFileName, saveEditedOutput } from './save-file';
import { formatSize, shareFile } from './file-storage';

export type EditorTab = 'crop' | 'rotate' | 'adjust' | 'filters' | 'resize' | 'export';
type Edits = { rotation: number; flipH: boolean; flipV: boolean; brightness: number; contrast: number; saturation: number; warmth: number; filter: string };
const NEUTRAL: Edits = { rotation: 0, flipH: false, flipV: false, brightness: 0, contrast: 1, saturation: 1, warmth: 0, filter: 'none' };

const TABS: { id: EditorTab; title: string; ios: 'crop' | 'rotate.right' | 'slider.horizontal.3' | 'camera.filters' | 'arrow.up.left.and.arrow.down.right' | 'square.and.arrow.down'; android: 'crop' | 'rotate-right' | 'tune' | 'filter-vintage' | 'photo-size-select-large' | 'save-alt' }[] = [
  { id: 'crop', title: 'Crop', ios: 'crop', android: 'crop' },
  { id: 'rotate', title: 'Rotate', ios: 'rotate.right', android: 'rotate-right' },
  { id: 'adjust', title: 'Adjust', ios: 'slider.horizontal.3', android: 'tune' },
  { id: 'filters', title: 'Filters', ios: 'camera.filters', android: 'filter-vintage' },
  { id: 'resize', title: 'Resize', ios: 'arrow.up.left.and.arrow.down.right', android: 'photo-size-select-large' },
  { id: 'export', title: 'Export', ios: 'square.and.arrow.down', android: 'save-alt' },
];
const ASPECTS = [
  { id: 'none', label: 'Original' }, { id: 'free', label: 'Free' }, { id: '1:1', label: 'Square' },
  { id: '4:3', label: '4:3' }, { id: '3:4', label: '3:4' }, { id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' },
];
const FILTERS = [{ id: 'none', label: 'None' }, { id: 'mono', label: 'Mono' }, { id: 'sepia', label: 'Sepia' }, { id: 'vivid', label: 'Vivid' }, { id: 'fade', label: 'Fade' }, { id: 'cool', label: 'Cool' }];
const SCALES = [1, 0.75, 0.5, 0.25];
const FORMATS = Platform.OS === 'android' ? ['jpeg', 'png', 'webp'] as const : ['jpeg', 'png'] as const;
type Format = (typeof FORMATS)[number];
const EXTENSIONS: Record<Format, string> = { jpeg: '.jpg', png: '.png', webp: '.webp' } as Record<Format, string>;
const outputDirectory = () => new Directory(Paths.document, 'Versara Images');

/** Controls in React; decoding, preview, crop handles and export all run natively. */
export function ImageEditorScreen({ id, initialTab = 'crop' }: { id: string; initialTab?: EditorTab }) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const active = useScreenActive();
  const [file, setFile] = useState<RecentFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const [edits, setEdits] = useState<Edits>(NEUTRAL);
  const [aspect, setAspect] = useState(initialTab === 'crop' ? 'free' : 'none');
  const [crop, setCrop] = useState<ImageCrop | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [format, setFormat] = useState<Format>('jpeg');
  const [quality, setQuality] = useState(initialTab === 'export' ? 80 : 92);
  const [busy, setBusy] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const { width } = useWindowDimensions();
  const sideWidth = Math.round(Math.min(440, Math.max(300, width * 0.4)));
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void getRecentFile(id).then(value => {
      if (!mounted.current) return;
      if (!value || !new File(value.uri).exists) setError('This image is no longer available. Open it again from your files.');
      else setFile(value);
    });
    return () => { mounted.current = false; };
  }, [id]);

  const closeRef = useRef(() => {});
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => subscription.remove();
  }, []);

  const update = (next: Partial<Edits>) => setEdits(current => ({ ...current, ...next }));
  const changed = JSON.stringify(edits) !== JSON.stringify(NEUTRAL) || !!crop || scale < 1 || format !== 'jpeg' || quality !== 92;
  const turned = edits.rotation === 90 || edits.rotation === 270;
  const outputSize = size ? {
    width: Math.max(1, Math.round((turned ? size.height : size.width) * (crop?.width ?? 1) * scale)),
    height: Math.max(1, Math.round((turned ? size.width : size.height) * (crop?.height ?? 1) * scale)),
  } : null;

  function close() { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }
  function requestClose() {
    if (!changed || busy) { close(); return; }
    showDialog('Discard edits?', 'Your changes to this image have not been saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: close }], { ios: 'photo', android: 'image' });
  }
  useEffect(() => { closeRef.current = requestClose; });

  async function save() {
    if (!file || busy || !FileEngine) return;
    const mode = await askSaveMode(file.name, file.mimeType.includes('*') ? 'image/jpeg' : file.mimeType);
    if (!mode || !mounted.current) return;
    setBusy(true); setError(null);
    const base = file.name.replace(/\.[a-zA-Z0-9]{1,8}$/, '').replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 60) || 'Image';
    const stamp = new Date().toISOString().replace(/[T:.]/g, '-').replace(/Z$/, '');
    const name = `${base}-edited-${stamp}${EXTENSIONS[format]}`;
    try {
      const directory = outputDirectory();
      directory.create({ intermediates: true, idempotent: true });
      const output = new File(directory, name);
      const engine = FileEngine;
      const { result, saved } = await withLoading('Saving your image…', async () => {
        const rendered = await engine.editImage(JSON.stringify({ uri: file.uri, outputUri: output.uri, edits, crop, scale, format, quality }));
        const stored = await saveEditedOutput({ output: rendered.uri, mimeType: rendered.mimeType, kind: 'image', mode, origin: file, name: newFileName(file.name.replace(/\.[a-zA-Z0-9]{1,8}$/, '') + EXTENSIONS[format]) });
        return { result: rendered, saved: stored };
      });
      toast(`Saved to ${saved.device.location}`);
      if (!mounted.current) return;
      if (mode === 'replace' && saved.recent) { router.replace({ pathname: '/file-preview', params: { id: saved.recent.id } }); return; }
      showDialog('Image saved', `${saved.file.name}\n${result.width} × ${result.height} · ${formatSize(result.size)}\nSaved to ${saved.device.location}`, [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Share', onPress: () => { void shareFile({ uri: saved.file.uri, mimeType: result.mimeType }).catch(() => {}); } },
        ...(saved.recent ? [{ text: 'Open', onPress: () => router.replace({ pathname: '/file-preview', params: { id: saved.recent!.id } }) }] : []),
      ], { ios: 'checkmark.circle', android: 'check-circle' });
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message || 'Could not save the edited image.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const chip = (selected: boolean, label: string, onPress: () => void, key = label) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={onPress}
    style={[styles.chip, { backgroundColor: selected ? colors.systemBlue : colors.accentSurface }]}>
    <ThemedText style={[styles.chipText, { color: selected ? colors.systemBackground : colors.systemBlue }]}>{label}</ThemedText>
  </Pressable>;
  const slider = (label: string, value: number, min: number, max: number, onChange: (value: number) => void, format = (v: number) => `${Math.round(v * 100)}`) => <View key={label} style={styles.sliderRow}>
    <ThemedText style={styles.sliderLabel}>{label}</ThemedText>
    <View style={styles.grow}><Host colorScheme={mode} seedColor={colors.accent} matchContents={{ vertical: true }}><Slider value={value} min={min} max={max} onValueChange={onChange} disabled={busy} /></Host></View>
    <ThemedText style={[styles.sliderValue, { color: colors.secondaryLabel }]}>{format(value)}</ThemedText>
  </View>;

  const chipRow = (children: ReactNode) => landscape
    ? <View style={[styles.chips, styles.wrap]}>{children}</View>
    : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{children}</ScrollView>;
  const panel = <View style={styles.panel}>
    {tab === 'crop' && chipRow(<>{ASPECTS.map(item => chip(aspect === item.id, item.label, () => { setAspect(item.id); if (item.id === 'none') setCrop(null); }, item.id))}</>)}
    {tab === 'rotate' && chipRow(<>
      {chip(false, 'Rotate left', () => update({ rotation: (edits.rotation + 270) % 360 }))}
      {chip(false, 'Rotate right', () => update({ rotation: (edits.rotation + 90) % 360 }))}
      {chip(edits.flipH, 'Flip horizontal', () => update({ flipH: !edits.flipH }))}
      {chip(edits.flipV, 'Flip vertical', () => update({ flipV: !edits.flipV }))}
      {chip(false, 'Reset', () => update({ rotation: 0, flipH: false, flipV: false }))}
    </>)}
    {tab === 'adjust' && <>
      {slider('Brightness', edits.brightness, -0.5, 0.5, value => update({ brightness: value }), v => `${Math.round(v * 200)}`)}
      {slider('Contrast', edits.contrast, 0.5, 1.5, value => update({ contrast: value }), v => `${Math.round((v - 1) * 200)}`)}
      {slider('Saturation', edits.saturation, 0, 2, value => update({ saturation: value }), v => `${Math.round((v - 1) * 100)}`)}
      {slider('Warmth', edits.warmth, -1, 1, value => update({ warmth: value }))}
      <View style={styles.chips}>{chip(false, 'Reset adjustments', () => update({ brightness: 0, contrast: 1, saturation: 1, warmth: 0 }))}</View>
    </>}
    {tab === 'filters' && chipRow(<>{FILTERS.map(item => chip(edits.filter === item.id, item.label, () => update({ filter: item.id }), item.id))}</>)}
    {tab === 'resize' && <>
      {chipRow(<>{SCALES.map(value => chip(scale === value, `${Math.round(value * 100)}%`, () => setScale(value), String(value)))}</>)}
      <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>{outputSize ? `Output about ${outputSize.width} × ${outputSize.height} px. Very large photos are limited to 4096 px on the longest side.` : 'Reading image size…'}</ThemedText>
    </>}
    {tab === 'export' && <>
      {chipRow(<>{FORMATS.map(value => chip(format === value, value.toUpperCase(), () => setFormat(value), value))}</>)}
      {format !== 'png' && slider('Quality', quality, 40, 100, value => setQuality(Math.round(value)), v => `${Math.round(v)}`)}
      <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>Saving creates a new image without location or camera details. Lower quality makes smaller files.</ThemedText>
    </>}
  </View>;

  const tabs = <ScrollView horizontal={!landscape} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={landscape ? styles.tabColumn : styles.tabRow}>
    {TABS.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} onPress={() => { setTab(item.id); if (item.id === 'crop' && aspect === 'none') setAspect('free'); }} style={styles.tab}>
      <View style={[styles.tabIcon, { backgroundColor: tab === item.id ? colors.systemBlue : colors.accentSurface }]}>
        <UniversalIcon ios={item.ios} android={item.android} size={20} color={tab === item.id ? colors.systemBackground : colors.systemBlue} />
      </View>
      <ThemedText style={styles.tabLabel}>{item.title}</ThemedText>
    </Pressable>)}
  </ScrollView>;

  return <View style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <Stack.Screen options={{ orientation: landscape ? 'landscape' : 'portrait' }} />
    <ScreenHeader title={file ? 'Edit image' : 'Image editor'} onBack={requestClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={landscape ? 'Switch to portrait view' : 'Switch to landscape view'} onPress={() => setLandscape(value => !value)} style={styles.headerButton}>
        <UniversalIcon ios="rotate.right" android="screen-rotation" size={22} color={colors.systemBlue} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Save edited image" disabled={!file || busy} onPress={() => { void save(); }} style={[styles.save, getGradients(colors).module, (!file || busy) && styles.disabled]}>
        {busy ? <AppLoader color={colors.moduleText} /> : <ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>Save</ThemedText>}
      </Pressable>
    </ScreenHeader>
    {error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
    {!hasNativeImageEditor || !ImageEditorView ? <View style={styles.center}><ThemedText style={styles.note}>Install a new development build to edit images.</ThemedText></View>
      : !file ? <View style={styles.center}>{!error && <AppLoader />}</View>
      : <View style={[styles.grow, landscape && styles.row]}>
        <View style={[styles.grow, { backgroundColor: '#000' }]}>
          {active && <ImageEditorView style={styles.grow} source={file.uri} edits={JSON.stringify(edits)} aspect={aspect}
            onLoad={({ nativeEvent }) => setSize(nativeEvent)} onError={({ nativeEvent }) => setError(nativeEvent.message)}
            onCropChange={({ nativeEvent }) => setCrop(nativeEvent.width ? nativeEvent as ImageCrop : null)} />}
        </View>
        <View style={[landscape ? [styles.side, { width: sideWidth }] : styles.bottom, { borderColor: colors.separator }]}>
          {landscape ? <View style={[styles.row, styles.grow]}>{tabs}<ScrollView style={styles.grow} contentContainerStyle={styles.sidePanel}>{panel}</ScrollView></View> : <>{panel}{tabs}</>}
        </View>
      </View>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flex: 1 },
  row: { flexDirection: 'row' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.xl },
  error: { padding: s.md },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  save: { minHeight: 40, minWidth: 68, borderRadius: 20, paddingHorizontal: s.lg, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth },
  side: { borderLeftWidth: StyleSheet.hairlineWidth },
  wrap: { flexWrap: 'wrap' },
  sidePanel: { paddingBottom: s.lg },
  panel: { paddingHorizontal: s.md, paddingTop: s.sm, gap: s.xs, minHeight: 64 },
  chips: { flexDirection: 'row', flexWrap: 'nowrap', gap: s.sm, paddingVertical: s.xs },
  chip: { minHeight: 40, borderRadius: 20, paddingHorizontal: s.lg, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '600' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: s.sm, minHeight: 44 },
  sliderLabel: { width: 84, fontSize: 13, fontWeight: '500' },
  sliderValue: { width: 36, fontSize: 12, textAlign: 'right', fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, lineHeight: 16, paddingVertical: s.xs },
  tabRow: { paddingHorizontal: s.sm, paddingVertical: s.sm, gap: 4 },
  tabColumn: { paddingVertical: s.sm, paddingHorizontal: 4, gap: 6 },
  tab: { width: 64, alignItems: 'center', gap: 4 },
  tabIcon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 11, fontWeight: '500' },
});

import { useEditHistory } from '../editor/use-edit-history';
import { useEditorDraft } from '../editor/use-editor-draft';
import { EditorOption } from '@/components/editor-option';
import { ImageWorkspaceTools, useImageWorkspace } from './image-workspace';
import { DEFAULT_RESIZE, ImageResizeControls, resolveResize } from './image-resize-controls';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type SetStateAction } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppLoader, withLoading } from '@/components/app-loader';
import { router, Stack } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { Host, Slider } from '@expo/ui';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { ScreenHeader } from '@/components/screen-header';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { toolColors } from '@/theme/tool-colors';
import { useAppearance, usePalette } from '@/theme/colors';
import { getGradients, radius, spacing as s } from '@/theme/dashboard';
import { useScreenActive } from '@/hooks/use-screen-active';
import ImageEditorView, { hasNativeImageEditor, type ImageCrop } from '../../../modules/file-engine/src/ImageEditorView';
import { FileEngine } from '../../../modules/file-engine';
import { type RecentFile } from './recent-files';
import { askSaveOptions, newFileName, saveEditedOutput } from './save-file';
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
type IconChoice = { id: string; label: string; icon: Pick<ComponentProps<typeof UniversalIcon>, 'ios' | 'android'> };
const ASPECTS: IconChoice[] = [
  { id: 'none', label: 'Original', icon: { ios: 'aspectratio', android: 'aspect-ratio' } },
  { id: 'free', label: 'Free', icon: { ios: 'crop', android: 'crop-free' } },
  { id: '1:1', label: 'Square', icon: { ios: 'square', android: 'crop-square' } },
  { id: '4:3', label: '4:3', icon: { ios: 'rectangle', android: 'crop-landscape' } },
  { id: '3:4', label: '3:4', icon: { ios: 'rectangle.portrait', android: 'crop-portrait' } },
  { id: '16:9', label: '16:9', icon: { ios: 'rectangle', android: 'crop-16-9' } },
  { id: '9:16', label: '9:16', icon: { ios: 'rectangle.portrait', android: 'crop-portrait' } },
];
const FILTERS: IconChoice[] = [
  { id: 'none', label: 'None', icon: { ios: 'circle.slash', android: 'block' } },
  { id: 'mono', label: 'Mono', icon: { ios: 'circle.lefthalf.filled', android: 'filter-b-and-w' } },
  { id: 'sepia', label: 'Sepia', icon: { ios: 'camera.filters', android: 'filter-vintage' } },
  { id: 'vivid', label: 'Vivid', icon: { ios: 'sparkles', android: 'auto-awesome' } },
  { id: 'fade', label: 'Fade', icon: { ios: 'drop.halffull', android: 'opacity' } },
  { id: 'cool', label: 'Cool', icon: { ios: 'snowflake', android: 'ac-unit' } },
];
type Format = 'jpeg' | 'png' | 'webp' | 'heic' | 'tiff';
const EXTENSIONS: Record<Format, string> = { jpeg: '.jpg', png: '.png', webp: '.webp', heic: '.heic', tiff: '.tiff' };
const outputDirectory = () => new Directory(Paths.document, 'Versara Images');
type EditorState = { edits: Edits; aspect: string; crop: ImageCrop | null; resize: typeof DEFAULT_RESIZE; format: Format; quality: number };
const hasResize = (state: EditorState) => state.resize.mode === 'pixels' || state.resize.percent !== '100';
const hasChanges = (state: EditorState) => JSON.stringify(state.edits) !== JSON.stringify(NEUTRAL) || !!state.crop || hasResize(state) || state.format !== 'jpeg' || state.quality !== 92;
function resizeSourceFor(size: { width: number; height: number } | null, state: EditorState) {
  if (!size) return undefined;
  const radians = state.edits.rotation * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians)), sine = Math.abs(Math.sin(radians));
  return {
    width: Math.max(1, Math.round((size.width * cosine + size.height * sine) * (state.crop?.width ?? 1))),
    height: Math.max(1, Math.round((size.width * sine + size.height * cosine) * (state.crop?.height ?? 1))),
  };
}
const SLIDERS = {
  brightness: { label: 'Brightness', min: -0.5, max: 0.5, format: (value: number) => `${Math.round(value * 200)}` },
  contrast: { label: 'Contrast', min: 0.5, max: 1.5, format: (value: number) => `${Math.round((value - 1) * 200)}` },
  saturation: { label: 'Saturation', min: 0, max: 2, format: (value: number) => `${Math.round((value - 1) * 100)}` },
  warmth: { label: 'Warmth', min: -1, max: 1, format: (value: number) => `${Math.round(value * 100)}` },
  straighten: { label: 'Straighten', min: -44, max: 44, format: (value: number) => `${Math.round(value)} deg` },
  quality: { label: 'Quality', min: 40, max: 100, format: (value: number) => `${Math.round(value)}` },
};
type SliderSetting = keyof typeof SLIDERS;

// An active slider should not repeatedly reconcile every sibling native Host.
// Values still enter history immediately, so Save/Undo never wait for a debounce.
const ImageAdjustmentSlider = memo(function ImageAdjustmentSlider({ setting, value, disabled, onChange }: {
  setting: SliderSetting; value: number; disabled: boolean; onChange: (setting: SliderSetting, value: number) => void;
}) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const config = SLIDERS[setting];
  const handleChange = useCallback((next: number) => onChange(setting, next), [onChange, setting]);
  return <View style={styles.sliderRow}>
    <ThemedText style={styles.sliderLabel}>{config.label}</ThemedText>
    <View style={styles.grow}><Host colorScheme={mode} seedColor={colors.accent} matchContents={{ vertical: true }}><Slider value={value} min={config.min} max={config.max} onValueChange={handleChange} disabled={disabled} /></Host></View>
    <ThemedText style={[styles.sliderValue, { color: colors.secondaryLabel }]}>{config.format(value)}</ThemedText>
  </View>;
});

function validDraft(value: unknown): value is EditorState {
  if (!value || typeof value !== 'object') return false;
  const item = value as EditorState;
  return !!item.edits && ['rotation','brightness','contrast','saturation','warmth'].every(key => Number.isFinite(item.edits[key as keyof Edits]))
    && typeof item.edits.flipH === 'boolean' && typeof item.edits.flipV === 'boolean' && FILTERS.some(filter => filter.id === item.edits.filter)
    && ASPECTS.some(aspect => aspect.id === item.aspect) && typeof item.format === 'string' && item.format in EXTENSIONS && Number.isFinite(item.quality) && item.quality >= 40 && item.quality <= 100
    && !!item.resize && typeof item.resize.locked === 'boolean' && ['pixels','percent'].includes(item.resize.mode) && ['percent','width','height'].every(key => typeof item.resize[key as keyof typeof DEFAULT_RESIZE] === 'string')
    && (item.crop === null || !!item.crop && ['x','y','width','height'].every(key => Number.isFinite(item.crop![key as keyof ImageCrop])) && item.crop.x >= 0 && item.crop.y >= 0 && item.crop.width > 0 && item.crop.height > 0 && item.crop.x + item.crop.width <= 1.00001 && item.crop.y + item.crop.height <= 1.00001);
}


/** Controls in React; decoding, preview, crop handles and export all run natively. */
export function ImageEditorScreen({ id, initialTab = 'crop' }: { id: string; initialTab?: EditorTab }) {
  const workspace = useImageWorkspace(id);
  const [formats, setFormats] = useState<Format[]>(Platform.OS === 'android' ? ['jpeg','png','webp'] : ['jpeg','png']);
  const colors = usePalette();
  const active = useScreenActive();
  const [file, setFile] = useState<RecentFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const locked = useRef(false);
  const history = useEditHistory<EditorState>({ edits: NEUTRAL, aspect: initialTab === 'crop' ? 'free' : 'none', crop: null, resize: DEFAULT_RESIZE, format: 'jpeg', quality: initialTab === 'export' ? 80 : 92 });
  const historyUpdate = useRef(history.update);
  useLayoutEffect(() => { historyUpdate.current = history.update; }, [history.update]);
  const onSliderChange = useCallback((setting: SliderSetting, value: number) => {
    if (locked.current || !Number.isFinite(value)) return;
    const config = SLIDERS[setting];
    const next = Math.max(config.min, Math.min(config.max, value));
    historyUpdate.current(current => {
      if (setting === 'quality') return { ...current, quality: Math.round(next) };
      if (setting === 'straighten') {
        const straighten = ((current.edits.rotation + 45) % 90) - 45;
        return { ...current, edits: { ...current.edits, rotation: (current.edits.rotation - straighten + Math.round(next) + 360) % 360 } };
      }
      return { ...current, edits: { ...current.edits, [setting]: next } };
    }, setting === 'straighten' ? 'rotation' : setting);
  }, []);
  const { edits, aspect, crop, resize, format, quality } = history.value;
  const setField = <K extends keyof EditorState>(key: K, next: SetStateAction<EditorState[K]>) => {
    if (!locked.current) history.update(current => ({ ...current, [key]: typeof next === 'function' ? (next as (previous: EditorState[K]) => EditorState[K])(current[key]) : next }), key);
  };
  const setAspect = (value: string) => setField('aspect', value);
  const setCrop = (value: ImageCrop | null) => setField('crop', value);
  const setResize = (value: typeof DEFAULT_RESIZE) => setField('resize', value);
  const setFormat = (value: Format) => setField('format', value);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [compare, setCompare] = useState(false);
  const [cropRequest, setCropRequest] = useState('');
  const restoreCrop = (value: ImageCrop | null) => setCropRequest(JSON.stringify({ ...(value ?? { reset: true }), revision: Date.now() }));
  const [busy, setBusy] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const { width, height: windowHeight, fontScale } = useWindowDimensions();
  const sideWidth = Math.round(Math.min(440, Math.max(300, width * 0.4)));
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void workspace.resolve().then(async value => {
      if (!mounted.current) return;
      if (!value || !new File(value.uri).exists) setError('This image is no longer available. Open it again from your files.');
      else {
        setFile(value);
        if (FileEngine?.nativeImageToolsVersion) {
          const info = await FileEngine.processImage(`formats-${Date.now()}`, JSON.stringify({ action: 'info', uri: value.uri }));
          if (mounted.current && Array.isArray(info.formats)) setFormats(info.formats.filter((format: string) => format in EXTENSIONS) as Format[]);
        }
      }
    }).catch(cause => { if (mounted.current) setError((cause as Error).message); });
    return () => { mounted.current = false; };
  }, [id, workspace]);

  const closeRef = useRef(() => {});
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => subscription.remove();
  }, []);

  const update = (next: Partial<Edits>) => { if (!locked.current) history.update(current => ({ ...current, edits: { ...current.edits, ...next } }), Object.keys(next).join(',')); };
  const changed = hasChanges(history.value);
  const draft = useEditorDraft({ id: FileEngine?.nativeImageHistoryVersion ? `image:${id}:basic` : null, uri: file?.uri, value: history.value, dirty: changed, restore: value => { history.restore(value); restoreCrop(value.crop); }, validate: validDraft });
  const straighten = ((edits.rotation + 45) % 90) - 45;
  const resizeSource = resizeSourceFor(size, history.value);

  function close() { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }
  function requestClose() {
    if (locked.current || busy) return;
    if (!changed && !workspace.changed) { close(); return; }
    showDialog('Discard edits?', 'Your changes to this image have not been saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { void Promise.all([draft.clear(), workspace.discard()]).then(close).catch(cause => setError((cause as Error).message)); } }], { ios: 'photo', android: 'image' });
  }
  useEffect(() => { closeRef.current = requestClose; });

  async function save() {
    if (!file || locked.current || busy || !draft.ready || !FileEngine) return;
    const snapshot = history.getCurrent();
    locked.current = true; setBusy(true);
    Keyboard.dismiss();
    try {
      let dimensions: ReturnType<typeof resolveResize>;
      if (hasResize(snapshot) || tab === 'resize') {
        if (!FileEngine.nativeImageResizeVersion) throw new Error('Install a new development build to save custom image sizes.');
        dimensions = resolveResize(resizeSourceFor(size, snapshot), snapshot.resize);
        if (!dimensions) throw new Error('Wait for the image dimensions to load.');
      }
      const options = await askSaveOptions(file.name, file.mimeType.includes('*') ? 'image/jpeg' : file.mimeType, newFileName(file.name.replace(/\.[a-zA-Z0-9]{1,8}$/, '') + EXTENSIONS[snapshot.format]));
      if (!options || !mounted.current) return;
      const { mode } = options;
      setError(null);
      const base = file.name.replace(/\.[a-zA-Z0-9]{1,8}$/, '').replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 60) || 'Image';
      const stamp = new Date().toISOString().replace(/[T:.]/g, '-').replace(/Z$/, '');
      const name = `${base}-edited-${stamp}${EXTENSIONS[snapshot.format]}`;
      const directory = outputDirectory();
      directory.create({ intermediates: true, idempotent: true });
      const output = new File(directory, name);
      const engine = FileEngine;
      const { result, saved } = await withLoading('Saving your image…', async () => {
        const rendered = await engine.editImage(JSON.stringify({ uri: file.uri, outputUri: output.uri, edits: snapshot.edits, crop: snapshot.crop, ...dimensions, format: snapshot.format, quality: snapshot.quality }));
        const stored = await saveEditedOutput({ output: rendered.uri, mimeType: rendered.mimeType, kind: 'image', mode, origin: workspace.origin ?? file, name: options.name });
        return { result: rendered, saved: stored };
      });
      await draft.clear(); await workspace.discard();
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
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function applyToWorkspace() {
    if (!file || !FileEngine || locked.current || busy || !draft.ready) throw new Error('Wait for the image to finish loading.');
    const snapshot = history.getCurrent();
    if (!hasChanges(snapshot)) return;
    locked.current = true;
    Keyboard.dismiss(); setBusy(true);
    try {
      const dimensions = hasResize(snapshot) ? resolveResize(resizeSourceFor(size, snapshot), snapshot.resize) : undefined;
      if (hasResize(snapshot) && !dimensions) throw new Error('Wait for the image dimensions to load.');
      await workspace.apply(outputUri => FileEngine!.editImage(JSON.stringify({ uri: file.uri, outputUri, edits: snapshot.edits, crop: snapshot.crop, ...dimensions, format: 'png', quality: 100 })), file);
      await draft.clear();
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const controlsDisabled = busy || !draft.ready || compare;
  const slider = (setting: SliderSetting, value: number) => <ImageAdjustmentSlider key={setting} setting={setting} value={value} disabled={busy || !draft.ready || compare} onChange={onSliderChange} />;

  const chipRow = (children: ReactNode) => landscape
    ? <View style={[styles.chips, styles.wrap]}>{children}</View>
    : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{children}</ScrollView>;
  const panel = <View style={styles.panel}>
    {!!FileEngine?.nativeImageHistoryVersion && <View style={[styles.chips, styles.wrap]}>
      <EditorOption label="Undo" disabled={busy || !draft.ready || !history.canUndo} onPress={() => { if (locked.current) return; setCompare(false); restoreCrop(history.undo().crop); }} />
      <EditorOption label="Redo" disabled={busy || !draft.ready || !history.canRedo} onPress={() => { if (locked.current) return; setCompare(false); restoreCrop(history.redo().crop); }} />
      <EditorOption label="Original" selected={compare} disabled={busy || !draft.ready} onPress={() => { if (locked.current) return; restoreCrop(compare ? crop : null); setCompare(value => !value); }} />
    </View>}
    {!!draft.error && <ThemedText accessibilityRole="alert" style={styles.note}>{draft.error}</ThemedText>}

    {tab === 'crop' && chipRow(<>{ASPECTS.map(item => <EditorOption key={item.id} selected={aspect === item.id} label={item.label} icon={item.icon} disabled={controlsDisabled} onPress={() => { setAspect(item.id); if (item.id === 'none') setCrop(null); }} />)}</>)}
    {tab === 'rotate' && chipRow(<>
      <EditorOption label="Rotate left" disabled={controlsDisabled} onPress={() => update({ rotation: (edits.rotation + 270) % 360 })} />
      <EditorOption label="Rotate right" disabled={controlsDisabled} onPress={() => update({ rotation: (edits.rotation + 90) % 360 })} />
      <EditorOption label="Flip horizontal" selected={edits.flipH} disabled={controlsDisabled} onPress={() => update({ flipH: !edits.flipH })} />
      <EditorOption label="Flip vertical" selected={edits.flipV} disabled={controlsDisabled} onPress={() => update({ flipV: !edits.flipV })} />
      <EditorOption label="Reset" disabled={controlsDisabled} onPress={() => update({ rotation: 0, flipH: false, flipV: false })} />
    </>)}
    {tab === 'rotate' && !!FileEngine?.nativeImageToolsVersion && slider('straighten', straighten)}
    {tab === 'adjust' && <>
      {slider('brightness', edits.brightness)}
      {slider('contrast', edits.contrast)}
      {slider('saturation', edits.saturation)}
      {slider('warmth', edits.warmth)}
      <View style={styles.chips}><EditorOption label="Reset adjustments" disabled={controlsDisabled} onPress={() => update({ brightness: 0, contrast: 1, saturation: 1, warmth: 0 })} /></View>
    </>}
    {tab === 'filters' && chipRow(<>{FILTERS.map(item => <EditorOption key={item.id} selected={edits.filter === item.id} label={item.label} icon={item.icon} disabled={controlsDisabled} onPress={() => update({ filter: item.id })} />)}</>)}
    {tab === 'resize' && <>
      <ImageResizeControls source={resizeSource} value={resize} disabled={busy || !draft.ready || compare} onChange={setResize} />
      <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>Dimensions include your crop and rotation. Unlock proportions to stretch to an exact size.</ThemedText>
    </>}
    {tab === 'export' && <>
      {chipRow(<>{formats.map(value => <EditorOption key={value} selected={format === value} label={value.toUpperCase()} disabled={controlsDisabled} onPress={() => setFormat(value)} />)}</>)}
      {!['png', 'tiff'].includes(format) && slider('quality', quality)}
      <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>Saving creates a new image without location or camera details. Lower quality makes smaller files.</ThemedText>
    </>}
  </View>;

  const tabs = <View style={landscape ? styles.tabColumn : [styles.tabRow, { flexDirection: 'row', flexWrap: 'wrap' }]}>
    {TABS.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} disabled={!draft.ready || busy || compare} onPress={() => { if (locked.current) return; setTab(item.id); if (item.id === 'crop' && aspect === 'none') setAspect('free'); }} style={[styles.tab, !landscape && { width: fontScale >= 1.4 ? '31%' : '15.5%' }]}>
      <View style={[styles.tabIcon, { backgroundColor: tab === item.id ? toolColors(item.id, colors).ink : toolColors(item.id, colors).surface }]}>
        <UniversalIcon ios={item.ios} android={item.android} size={20} color={tab === item.id ? colors.systemBackground : toolColors(item.id, colors).ink} />
      </View>
      <ThemedText style={styles.tabLabel}>{item.title}</ThemedText>
    </Pressable>)}
  </View>;

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <Stack.Screen options={{ orientation: landscape ? 'landscape' : 'portrait' }} />
    <ScreenHeader title={file ? 'Edit image' : 'Image editor'} onBack={requestClose}>
      <ImageWorkspaceTools id={id} current={tab} disabled={!file || busy || !draft.ready || compare} onApply={applyToWorkspace} />
      <Pressable accessibilityRole="button" accessibilityLabel={landscape ? 'Switch to portrait view' : 'Switch to landscape view'} onPress={() => setLandscape(value => !value)} style={styles.headerButton}>
        <UniversalIcon ios="rotate.right" android="screen-rotation" size={22} color={colors.systemBlue} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Save edited image" disabled={!file || busy || !draft.ready || compare} onPress={() => { void save(); }} style={[styles.save, getGradients(colors).module, (!file || busy || !draft.ready || compare) && styles.disabled]}>
        {busy ? <AppLoader color={colors.moduleText} /> : <ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>Save</ThemedText>}
      </Pressable>
    </ScreenHeader>
    {error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
    {!hasNativeImageEditor || !ImageEditorView ? <View style={styles.center}><ThemedText style={styles.note}>Install a new development build to edit images.</ThemedText></View>
      : !file ? <View style={styles.center}>{!error && <AppLoader />}</View>
      : <View style={[styles.grow, landscape && styles.row]}>
        <View pointerEvents={busy ? 'none' : 'auto'} style={[styles.grow, { backgroundColor: colors.secondarySystemBackground }]}>
          {active && draft.ready && <ImageEditorView key={`${history.revision}:${compare}`} style={styles.grow} source={compare ? (workspace.origin ?? file).uri : file.uri} edits={JSON.stringify(compare ? NEUTRAL : edits)} aspect={compare ? 'none' : aspect} cropRequest={FileEngine?.nativeImageHistoryVersion ? cropRequest : undefined}
            onLoad={({ nativeEvent }) => { if (!compare) setSize(nativeEvent); }} onError={({ nativeEvent }) => setError(nativeEvent.message)}
            onCropChange={({ nativeEvent }) => { if (!compare && draft.ready) setCrop(nativeEvent.width ? nativeEvent as ImageCrop : null); }} />}
        </View>
        <View style={[landscape ? [styles.side, { width: sideWidth }] : styles.bottom, { borderColor: colors.separator }]}>
          {landscape ? <View style={[styles.row, styles.grow]}>{tabs}<ScrollView style={styles.grow} contentContainerStyle={styles.sidePanel}>{panel}</ScrollView></View> : <><ScrollView style={{ maxHeight: windowHeight * 0.4, flexGrow: 0 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag">{panel}</ScrollView>{tabs}</>}
        </View>
      </View>}
  </KeyboardAvoidingView>;
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

import { BatchImagePreview } from './batch-image-preview';
import { useEditHistory } from '../editor/use-edit-history';
import { useEditorDraft } from '../editor/use-editor-draft';
import { responsiveToolbarStyles, useResponsiveEditorToolbar } from '../editor/responsive-editor-toolbar';
import { EditorMenu } from '@/components/editor-menu';
import { HeaderHistoryButtons } from '@/components/header-history';
import { EditorOption } from '@/components/editor-option';
import { optionIcon } from '@/theme/editor-icons';
import { BrushControls, BRUSHES } from '../pdf/brush-controls';
import { useMarkHistory, isMarkHistorySnapshot } from '../pdf/use-mark-history';
import { ImageWorkspaceTools, useImageWorkspace } from './image-workspace';
import { DEFAULT_RESIZE, ImageResizeControls, resolveResize } from './image-resize-controls';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import { useSliderValue } from '@/hooks/use-slider-value';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { Host, Slider } from '@expo/ui';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { FileEngine } from '../../../modules/file-engine';
import { PdfEngine } from '../../../modules/pdf-engine';
import PdfMarkupView, { type PdfMark, type PdfMarkChange } from '../../../modules/pdf-engine/src/PdfMarkupView';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { AppLoader } from '@/components/app-loader';
import { ColorSwatches, hexColor } from '@/components/color-swatches';
import { showDialog } from '@/components/app-dialog';
import { IMAGE_SECTIONS } from '@/constants/image-methods';
import { useAppearance, usePalette } from '@/theme/colors';
import { forgetRecentUri, rememberFile, type RecentFile } from './recent-files';
import { browseFiles, createImportDirectory, disposeImports, formatSize, shareFile, shareNamedFile, shareRenderedFile, type LocalFile } from './file-storage';
import { ToolActionRow, ToolRowButton } from '@/components/tool-action-row';
import { OptionSheet } from '@/components/option-sheet';
import { FitSlotButton } from '@/components/fit-slot';
import { askNewFileName, askSaveOptions, saveEditedOutput, type SaveMode } from './save-file';
import { PdfPagePreview, PdfPreviewFooter, PdfPreviewStage } from '../pdf/pdf-preview';
import { SHAPES, ShapePicker } from '../pdf/shape-picker';
import { MarkupZoomButtons, useMarkupZoom } from '../pdf/markup-zoom';
import { usePdfScreenActive } from '../pdf/use-pdf-screen-active';

type Info = { width: number; height: number; size: number; mimeType: string; formats: string[]; camera: string; taken: string; hasLocation: boolean };
type Output = { uri: string; width: number; height: number; size: number; mimeType: string; name: string; location?: string; sourceUri?: string; saveMode?: SaveMode };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const extension = (format: string) => format === 'jpeg' ? 'jpg' : format;
const presets = [{ label: 'Square', width: 1080, height: 1080 }, { label: 'Portrait', width: 1080, height: 1350 }, { label: 'Story', width: 1080, height: 1920 }, { label: 'Landscape', width: 1920, height: 1080 }, { label: 'Profile', width: 512, height: 512 }];
const CURVE_CHANNELS = [{ id: 'rgb', label: 'RGB' }, { id: 'red', label: 'Red' }, { id: 'green', label: 'Green' }, { id: 'blue', label: 'Blue' }] as const;
const CURVE_POINTS = ['Blacks', 'Shadows', 'Midtones', 'Highlights', 'Whites'];
const NEUTRAL_CURVE = [0, .25, .5, .75, 1];
const HSL_BANDS = [
  { id: 'red', label: 'Red', color: '#E5484D' }, { id: 'orange', label: 'Orange', color: '#EF7F38' },
  { id: 'yellow', label: 'Yellow', color: '#C8A600' }, { id: 'green', label: 'Green', color: '#39A86B' },
  { id: 'aqua', label: 'Aqua', color: '#00A5AE' }, { id: 'blue', label: 'Blue', color: '#4879E8' },
  { id: 'purple', label: 'Purple', color: '#9558D8' }, { id: 'magenta', label: 'Magenta', color: '#D450A4' },
] as const;
type CurveChannel = (typeof CURVE_CHANNELS)[number]['id'];
type HslBand = (typeof HSL_BANDS)[number]['id'];
type HslAdjustment = { hue: number; saturation: number; lightness: number };
const NEUTRAL_HSL = Object.fromEntries(HSL_BANDS.map(band => [band.id, { hue: 0, saturation: 0, lightness: 0 }])) as Record<HslBand, HslAdjustment>;
const NEUTRAL_LEVELS = { black: 0, gamma: 1, white: 1 };
const LEVEL_POINTS = [{ id: 'black', label: 'Black point' }, { id: 'gamma', label: 'Midtones' }, { id: 'white', label: 'White point' }] as const;
const HSL_PARTS = [{ id: 'hue', label: 'Hue' }, { id: 'saturation', label: 'Saturation' }, { id: 'lightness', label: 'Lightness' }] as const;
// Short controls stay docked under the live preview instead of a sheet that covers it.
const DOCKED_TOOLS = new Set(['exposure', 'curves', 'levels', 'hsl', 'sharpen', 'blur', 'canvas']);
const CURVE_HEIGHT = 104;
const AnimatedCurvePath = Animated.createAnimatedComponent(Path);
const AnimatedCurvePoint = Animated.createAnimatedComponent(Circle);
const colorStyles = StyleSheet.create({
  range: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  dot: { width: 14, height: 14, borderRadius: 7 },
});

function CurvePoint({ values, selected, index, color }: { values: SharedValue<number[]>; selected: SharedValue<number>; index: number; color: string }) {
  const props = useAnimatedProps(() => ({ cy: 128 - values.get()[index] * 120, r: selected.get() === index ? 6 : 4 }));
  return <AnimatedCurvePoint cx={8 + index * 60} animatedProps={props} fill={color} />;
}

function AdjustmentSlider({ label, value, min, max, onChange, display, disabled }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; display: string; disabled: boolean }) {
  const mode = useAppearance(state => state.mode);
  const bounded = max > min;
  const [shown, change] = useSliderValue(Math.max(min, Math.min(max, value)), onChange, (max - min) / 200);
  return <View style={styles.field}><View style={styles.row}><ThemedText style={[styles.label, styles.grow]}>{label}</ThemedText><ThemedText>{display}</ThemedText></View><Host colorScheme={mode} matchContents={{ vertical: true }}><Slider min={min} max={bounded ? max : min + 1} value={shown} onValueChange={next => { if (!disabled && bounded && Number.isFinite(next)) change(Math.max(min, Math.min(max, next))); }} disabled={disabled || !bounded} /></Host></View>;
}

function AdjustmentInput({ label, value, onChange, numeric = true, disabled }: { label: string; value: string; onChange: (value: string) => void; numeric?: boolean; disabled: boolean }) {
  const colors = usePalette();
  return <View style={styles.field}><ThemedText style={styles.label}>{label}</ThemedText><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled} keyboardType={numeric ? 'number-pad' : 'default'} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} maxLength={numeric ? 6 : 200} style={[styles.input, { color: colors.label, backgroundColor: colors.fieldSurface }]} /></View>;
}

// Stable JS callbacks keep native gestures attached while React publishes previews.
function useCurveCallback<Args extends unknown[]>(callback: (...args: Args) => void) {
  const current = useRef(callback);
  useLayoutEffect(() => { current.current = callback; }, [callback]);
  return useCallback((...args: Args) => current.current(...args), []);
}

function CurveGraph({ values, selected, disabled, onBegin, onPreview, onCommit, onCancel }: {
  values: number[]; selected: number; disabled: boolean;
  onBegin: (token: number, index: number) => void;
  onPreview: (token: number, index: number, value: number) => void;
  onCommit: (token: number, index: number, value: number) => void;
  onCancel: (token: number) => void;
}) {
  const colors = usePalette();
  const [tokenSeed] = useState(() => Date.now() * 1000 + Math.floor(Math.random() * 1000));
  const points = useSharedValue(values), selection = useSharedValue(selected), width = useSharedValue(0), height = useSharedValue(CURVE_HEIGHT);
  const dragIndex = useSharedValue(-1), serial = useSharedValue(tokenSeed), lastPublished = useSharedValue(0);
  const original = useSharedValue(values), grabOffset = useSharedValue(0);
  const begin = useCurveCallback(onBegin), preview = useCurveCallback(onPreview);
  const commit = useCurveCallback(onCommit), cancel = useCurveCallback(onCancel);
  useEffect(() => { if (dragIndex.get() < 0) points.set(values); }, [values, points, dragIndex]);
  useEffect(() => { selection.set(selected); }, [selected, selection]);
  const path = useAnimatedProps(() => {
    'worklet';
    // A nested map callback can be hoisted by the React compiler into an RN
    // function. Build the path entirely in this worklet, without remote calls.
    const values = points.get();
    let d = '';
    for (let index = 0; index < values.length; index++) {
      d += `${index ? ' L' : 'M'}${8 + index * 60} ${128 - values[index] * 120}`;
    }
    return { d };
  });
  useAnimatedReaction(() => {
    const index = dragIndex.get();
    return { index, value: index >= 0 ? points.get()[index] : 0, token: serial.get() };
  }, current => {
    // The graph never waits for React. Only coarse preview snapshots cross runtimes.
    const now = Date.now();
    if (current.index >= 0 && now - lastPublished.get() >= 60) {
      lastPublished.set(now);
      scheduleOnRN(preview, current.token, current.index, current.value);
    }
  });
  const gesture = useMemo(() => Gesture.Manual().enabled(!disabled)
    .onTouchesDown((event, manager) => {
      if (event.numberOfTouches !== 1 || dragIndex.get() >= 0 || width.get() <= 0) { manager.fail(); return; }
      const touch = event.changedTouches[0];
      if (!touch) { manager.fail(); return; }
      // The SVG uses a 256 x 144 view box stretched to the layout; touches are in layout points.
      const scaleY = height.get() / 144;
      const index = Math.max(0, Math.min(4, Math.round((touch.x / width.get() * 256 - 8) / 60)));
      const x = (8 + index * 60) / 256 * width.get(), y = (128 - points.get()[index] * 120) * scaleY;
      if (Math.hypot(touch.x - x, touch.y - y) > 28) { manager.fail(); return; }
      grabOffset.set((touch.y - y) / scaleY);
      original.set(points.get()); serial.set(serial.get() + 1); selection.set(index); dragIndex.set(index); lastPublished.set(0);
      manager.begin(); manager.activate(); scheduleOnRN(begin, serial.get(), index);
    })
    .onTouchesMove((event, manager) => {
      const index = dragIndex.get(), touch = event.changedTouches[0];
      if (index < 0 || !touch) return;
      if (event.numberOfTouches !== 1) { manager.fail(); return; }
      const value = Math.round(Math.max(0, Math.min(1, (128 - touch.y / (height.get() / 144) + grabOffset.get()) / 120)) * 100) / 100;
      const next = [...points.get()]; next[index] = value; points.set(next);
    })
    .onTouchesUp((event, manager) => {
      const index = dragIndex.get(), touch = event.changedTouches[0];
      if (index >= 0 && touch) {
        const next = [...points.get()]; next[index] = Math.round(Math.max(0, Math.min(1, (128 - touch.y / (height.get() / 144) + grabOffset.get()) / 120)) * 100) / 100; points.set(next);
      }
      manager.end();
    })
    .onTouchesCancelled((_, manager) => manager.fail())
    .onFinalize((_, success) => {
      const index = dragIndex.get();
      if (index < 0) return;
      if (success) scheduleOnRN(commit, serial.get(), index, points.get()[index]);
      else { points.set(original.get()); scheduleOnRN(cancel, serial.get()); }
      dragIndex.set(-1);
    }), [disabled, dragIndex, width, height, points, original, grabOffset, serial, selection, lastPublished, begin, commit, cancel]);
  return <GestureDetector gesture={gesture}><View collapsable={false} onLayout={event => { width.set(event.nativeEvent.layout.width); height.set(event.nativeEvent.layout.height); }} accessibilityLabel="Tone curve. Drag a point up or down to change that tone.">
    <Svg pointerEvents="none" width="100%" height={CURVE_HEIGHT} viewBox="0 0 256 144" preserveAspectRatio="none">
      <Path d="M8 8H248V128H8Z M68 8V128 M128 8V128 M188 8V128 M8 38H248 M8 68H248 M8 98H248" stroke={colors.separator} strokeWidth={1} fill="none" />
      <Path d="M8 128L248 8" stroke={colors.secondaryLabel} strokeWidth={1} strokeDasharray="4 4" fill="none" />
      <AnimatedCurvePath animatedProps={path} stroke={colors.accent} strokeWidth={3} fill="none" />
      {[0, 1, 2, 3, 4].map(index => <CurvePoint key={index} index={index} values={points} selected={selection} color={colors.accent} />)}
    </Svg>
  </View></GestureDetector>;
}

function settingsMatch(template: Record<string, unknown>, value: unknown): value is typeof template {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.entries(template).every(([key, expected]) => {
    const actual = candidate[key];
    // Older local drafts predate these optional operations; restore supplies neutral defaults.
    if (['curves', 'hsl', 'levels'].includes(key) && actual === undefined) return true;
    if (expected === null) return actual === null || typeof actual === 'number' && Number.isFinite(actual);
    if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && actual.every((item, index) => typeof item === typeof expected[index] && (typeof item === 'string' ? item.length < 32 : typeof item === 'number' && Number.isFinite(item)));
    if (typeof expected === 'object') return settingsMatch(expected as Record<string, unknown>, actual);
    return typeof actual === typeof expected && (typeof actual !== 'number' || Number.isFinite(actual)) && (typeof actual !== 'string' || actual.length <= 1000);
  });
}

/** One image at a time, on native workers. Settings/paths are the only JS payloads. */
export function AdvancedImageToolScreen({ id, tool }: { id: string; tool: string }) {
  const workspace = useImageWorkspace(id);
  const colors = usePalette(); const active = usePdfScreenActive();
  const window = useWindowDimensions();
  const landscape = window.width > window.height + 80;
  const title = IMAGE_SECTIONS.flatMap(section => [...section.tools]).find(item => item.id === tool)?.title ?? 'Image tools';
  const batch = tool === 'batch' || tool === 'batch_compress';
  const drawing = tool === 'draw' || tool === 'redact';
  const sizing = ['resize', 'social', 'batch'].includes(tool);
  const compressing = ['compress', 'batch_compress', 'batch'].includes(tool);
  const colorAdjusting = ['curves', 'hsl', 'levels'].includes(tool);
  const [directory] = useState(createImportDirectory);
  const [file, setFile] = useState<RecentFile | null>(null);
  const [info, setInfo] = useState<Info>();
  const [extra, setExtra] = useState<LocalFile[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const previewFile = batch && batchIndex > 0 ? extra[batchIndex - 1] ?? file : file;
  const [preview, setPreview] = useState<Output>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<Output[]>([]);
  const initialSettings = { format: drawing || colorAdjusting || tool === 'metadata' ? 'png' : 'jpeg', quality: 85, target: '', resize: DEFAULT_RESIZE, resizeMode: 'fit', exposure: 0, sharpen: 0.5, blur: 0.008, blurArea: false, padding: 0.06, background: 0xffffff, corners: ['0','0','100','0','100','100','0','100'], watermark: '', opacity: 0.5, markSize: 0.06, x: 0.5, y: 0.5, ink: 0x1d4ed8, fill: null as number | null, inkWidth: 0.005, shape: 'pen', brushType: 'pen', pattern: 'solid', inkOpacity: 1,
    curves: { rgb: NEUTRAL_CURVE, red: NEUTRAL_CURVE, green: NEUTRAL_CURVE, blue: NEUTRAL_CURVE } as Record<CurveChannel, number[]>, hsl: NEUTRAL_HSL, levels: NEUTRAL_LEVELS };
  const optionHistory = useEditHistory(initialSettings);
  const { format, quality, target, resize, resizeMode, exposure, sharpen, blur, blurArea, padding, background, corners, watermark, opacity, markSize, x, y, ink, fill, inkWidth, shape, brushType, pattern, inkOpacity, curves, hsl, levels } = optionHistory.value;
  const [curveChannel, setCurveChannel] = useState<CurveChannel>('rgb');
  const [curvePoint, setCurvePoint] = useState(2);
  const [hslBand, setHslBand] = useState<HslBand>('red');
  const [hslPart, setHslPart] = useState<keyof HslAdjustment>('saturation');
  const [levelPoint, setLevelPoint] = useState<(typeof LEVEL_POINTS)[number]['id']>('black');
  const docked = DOCKED_TOOLS.has(tool);
  const [curveDraft, setCurveDraft] = useState<{ channel: CurveChannel; index: number; value: number } | null>(null);
  const activeCurveDrag = useRef<{ token: number; channel: CurveChannel; index: number } | null>(null);
  const setOption = <K extends keyof typeof initialSettings>(key: K, next: SetStateAction<(typeof initialSettings)[K]>) => { if (mounted.current && !locked.current && !activeCurveDrag.current) optionHistory.update(current => ({ ...current, [key]: typeof next === 'function' ? (next as (previous: (typeof initialSettings)[K]) => (typeof initialSettings)[K])(current[key]) : next }), key); };
  const setFormat = (value: SetStateAction<string>) => setOption('format', value);
  const setQuality = (value: SetStateAction<number>) => setOption('quality', value);
  const setTarget = (value: SetStateAction<string>) => setOption('target', value);
  const setResize = (value: SetStateAction<typeof DEFAULT_RESIZE>) => setOption('resize', value);
  const setResizeMode = (value: SetStateAction<string>) => setOption('resizeMode', value);
  const setExposure = (value: SetStateAction<number>) => setOption('exposure', value);
  const setSharpen = (value: SetStateAction<number>) => setOption('sharpen', value);
  const setBlur = (value: SetStateAction<number>) => setOption('blur', value);
  const setBlurArea = (value: SetStateAction<boolean>) => setOption('blurArea', value);
  const setPadding = (value: SetStateAction<number>) => setOption('padding', value);
  const setBackground = (value: SetStateAction<number>) => setOption('background', value);
  const setCorners = (value: SetStateAction<string[]>) => setOption('corners', value);
  const setWatermark = (value: SetStateAction<string>) => setOption('watermark', value);
  const setOpacity = (value: SetStateAction<number>) => setOption('opacity', value);
  const setMarkSize = (value: SetStateAction<number>) => setOption('markSize', value);
  const setX = (value: SetStateAction<number>) => setOption('x', value);
  const setY = (value: SetStateAction<number>) => setOption('y', value);
  const setInk = (value: SetStateAction<number>) => setOption('ink', value);
  const setFill = (value: SetStateAction<number | null>) => setOption('fill', value);
  const setInkWidth = (value: SetStateAction<number>) => setOption('inkWidth', value);
  const setShape = (value: SetStateAction<string>) => setOption('shape', value);
  const setBrushType = (value: SetStateAction<string>) => setOption('brushType', value);
  const setPattern = (value: SetStateAction<string>) => setOption('pattern', value);
  const setInkOpacity = (value: SetStateAction<number>) => setOption('inkOpacity', value);  const setHslValue = (key: keyof HslAdjustment, value: number) => optionHistory.update(current => ({ ...current, hsl: { ...current.hsl, [hslBand]: { ...current.hsl[hslBand], [key]: Math.round(value) } } }), `hsl:${hslBand}:${key}`);

  const [area, setArea] = useState<PdfMark>();
  const [selectingArea, setSelectingArea] = useState(false);

  const [logo, setLogo] = useState<LocalFile>();

  const history = useMarkHistory(); const { marks } = history;
  const [selecting, setSelecting] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const markupEditing = !!PdfEngine?.nativeMarkupEditingVersion && !!FileEngine?.nativeMarkupEditingVersion;
  const selectedMark = selecting ? marks.find(mark => mark.id === selectedId) : undefined;
  function styleSelection(patch: Partial<PdfMark>) { if (selectedMark?.id) edit(() => history.update(selectedMark.id!, patch)); }
  function selectMark(serialized: string) {
    if (!markupEditing) return;
    try { const mark = serialized ? JSON.parse(serialized) as PdfMark : null; setSelectedId(mark?.id); if (mark) { setInk(parseInt(mark.color.slice(1),16)); setInkWidth(mark.width); setFill(mark.fillColor ? parseInt(mark.fillColor.slice(1),16) : null); setInkOpacity(mark.opacity ?? (mark.brush === 'highlighter' ? .3 : mark.brush === 'pencil' ? 170/255 : mark.brush === 'marker' ? 210/255 : 1)); setBrushType(mark.brush ?? 'pen'); setPattern(mark.pattern ?? 'solid'); } } catch { setSelectedId(undefined); }
  }
  const [settings, setSettings] = useState(tool === 'watermark'); const [compare, setCompare] = useState(false); const [fit, setFit] = useState(0); const [retry, setRetry] = useState(0);
  const markupZoom = useMarkupZoom(String(fit));
  // Without a selection, the size buttons act on the newest shape so a tiny one can grow straight after drawing.
  const resizeTarget = selectedMark ?? (drawing && tool !== 'redact' && shape !== 'pen' && !selecting && !erasing ? marks.findLast(mark => mark.kind === 'polygon' || mark.kind === 'line') : undefined);
  const mounted = useRef(true); const locked = useRef(false); const cancelled = useRef(false); const jobs = useRef(new Map<string, Promise<unknown>>()); const frames = useRef<string[]>([]);
  const initialized = useRef(false);
  const [saved, setSaved] = useState(false);
  const [changed, setChanged] = useState(false);
  // Output tools make a file by design; every other tool applies to the working image, which the preview saves once.
  const exportTool = batch || ['compress', 'convert', 'metadata', 'rename', 'info'].includes(tool);
  const saveTitle = batch ? `Save ${1 + extra.length} images` : exportTool ? 'Save' : 'Apply';
  // Existing icon-only settings control: 22px symbol, 12px side padding and 1px border.
  const toolbar = useResponsiveEditorToolbar([48], [...(drawing ? ['Undo', 'Redo'] : []), saveTitle]);
  const available = !!FileEngine?.nativeImageToolsVersion && (!colorAdjusting || (FileEngine?.nativeImageColorVersion ?? 0) >= (tool === 'levels' ? 2 : 1));
  const recovery = useEditorDraft({ id: !drawing && !batch && !logo ? `image:${id}:${tool}` : null, uri: file?.uri, value: optionHistory.value, dirty: changed && !saved,
    validate: (value): value is typeof initialSettings => settingsMatch(initialSettings, value), restore: value => { optionHistory.restore({ ...initialSettings, ...value }); setChanged(true); } });
  const markRecoveryValue = { history: history.snapshot, settings: optionHistory.value };
  const markRecovery = useEditorDraft({ id: drawing ? `image:${id}:${tool}` : null, uri: file?.uri, value: markRecoveryValue, dirty: changed && !saved,
    validate: (value): value is typeof markRecoveryValue => !!value && typeof value === 'object' && 'history' in value && 'settings' in value && isMarkHistorySnapshot(value.history) && settingsMatch(initialSettings, value.settings),
    restore: value => { history.restoreSnapshot(value.history); optionHistory.restore({ ...initialSettings, ...value.settings }); setChanged(true); } });
  const closeRef = useRef(() => {});
  function leave() { if (router.canGoBack()) router.back(); else router.replace('/(modules)/image'); }
  function close() {
    if (busy) { cancelled.current = true; jobs.current.forEach((_, id) => FileEngine?.cancelImageJob(id)); return; }
    if (changed && !saved) showDialog('Discard image changes?', exportTool ? 'Your current settings have not been saved.' : 'Changes in this tool have not been applied. Changes applied earlier stay.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { void Promise.all([recovery.clear(), markRecovery.clear()]).then(leave).catch(cause => setError((cause as Error).message)); } }]);
    else leave();
  }
  /** Applies this tool to the working image and returns to its preview, where everything is saved once. */
  async function applyAndReturn() {
    try {
      if (changed) {
        if (tool === 'blur' && optionHistory.getCurrent().blurArea && !area) throw new Error('Select the area to blur first.');
        await applyToWorkspace();
      }
      if (mounted.current) router.dismissTo({ pathname: '/file-preview', params: { id } });
    } catch (cause) { if (mounted.current) setError((cause as Error).message || 'Could not apply the changes.'); }
  }
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    mounted.current = true;
    const pendingJobs = jobs.current;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => { mounted.current = false; listener.remove(); queueMicrotask(() => {
      if (mounted.current) return;
      pendingJobs.forEach((_, id) => FileEngine?.cancelImageJob(id));
      void Promise.allSettled([...pendingJobs.values()]).then(() => { if (!mounted.current) disposeImports(directory); });
    }); };
  }, [directory]);
  const run = useCallback((request: Record<string, unknown>, job = uid()) => {
    if (!FileEngine?.nativeImageToolsVersion) return Promise.reject(new Error('Install a new development build for the image tools.'));
    const promise = FileEngine.processImage(job, JSON.stringify(request)); jobs.current.set(job, promise);
    return promise.finally(() => jobs.current.delete(job));
  }, []);
  useEffect(() => {
    if (!active || !available || initialized.current) return;
    initialized.current = true;
    void workspace.resolve().then(async value => {
      if (!mounted.current) return;
      if (!value || !new File(value.uri).exists) throw new Error('Open this image again from your files.');
      directory.create({ intermediates: true, idempotent: true });
      const details = await run({ action: 'info', uri: value.uri }) as unknown as Info;
      if (mounted.current) { setFile(value); setInfo(details); }
    }).catch(cause => { if (mounted.current) setError((cause as Error).message); });
  }, [id, active, available, directory, run, retry, workspace]);
  function edit(action: () => void, allowLocked = false) { if (!mounted.current || locked.current && !allowLocked || activeCurveDrag.current) return; setChanged(true); setSaved(false); action(); }
  function beginCurveDrag(token: number, index: number) {
    if (locked.current || !mounted.current || !active || compare || busy) return;
    activeCurveDrag.current = { token, channel: curveChannel, index };
    setCurvePoint(index); setCurveDraft({ channel: curveChannel, index, value: optionHistory.getCurrent().curves[curveChannel][index] });
  }
  function previewCurveDrag(token: number, index: number, value: number) {
    const drag = activeCurveDrag.current;
    if (!drag || drag.token !== token || locked.current || !mounted.current) return;
    setCurveDraft({ channel: drag.channel, index, value });
  }
  function finishCurveDrag(token: number, index: number, value?: number) {
    const drag = activeCurveDrag.current;
    if (!drag || drag.token !== token) return;
    activeCurveDrag.current = null;
    if (!mounted.current) return;
    setCurveDraft(null);
    if (value !== undefined && !locked.current && active && !compare && !busy) edit(() => optionHistory.update(current => ({ ...current, curves: { ...current.curves, [drag.channel]: current.curves[drag.channel].map((item, point) => point === index ? value : item) } }), `curve-drag:${token}`));
  }
  useEffect(() => () => {
    if (!activeCurveDrag.current) return;
    activeCurveDrag.current = null;
    queueMicrotask(() => { if (mounted.current) setCurveDraft(null); });
  }, [active, file?.uri, compare, busy, available, settings, curveChannel]);
  function parameters(includeMarks = true, state = optionHistory.value): Record<string, unknown> {
    const { format, quality, resize, resizeMode, background, target, exposure, curves, hsl, levels, sharpen, blur, blurArea, padding, corners, watermark, markSize, ink, opacity, x, y } = state;
    const options: Record<string, unknown> = { format, quality };
    if (sizing) {
      const output = resolveResize(info, resize);
      if (output) { options.width = output.width; options.height = output.height; options.resizeMode = resizeMode; options.background = hexColor(background); }
      if (batch && resize.mode === 'percent') {
        if (!FileEngine?.nativeImageResizeVersion) throw new Error('Install a new development build for percentage-based batch resizing.');
        options.percent = Number(resize.percent.replace(',', '.'));
        delete options.width; delete options.height;
      }
    }
    if (compressing && target) {
      if (!/^\d+$/.test(target) || Number(target) < 10 || Number(target) > 50000) throw new Error('Choose a target from 10 to 50,000 KB.');
      if (['png', 'tiff'].includes(format)) throw new Error('Choose a lossy format for target-size compression.');
      options.targetBytes = Number(target) * 1024;
    }
    if (tool === 'exposure') options.exposure = exposure;
    if (colorAdjusting && !FileEngine?.nativeImageColorVersion) throw new Error('Install a new development build for native tone curves and HSL.');
    if (tool === 'levels' && (FileEngine?.nativeImageColorVersion ?? 0) < 2) throw new Error('Install a new development build for native Levels.');
    if (tool === 'curves') options.curves = curves;
    if (tool === 'hsl') options.hsl = hsl;
    if (tool === 'levels') options.levels = levels;
    if (tool === 'sharpen') options.sharpen = sharpen;
    if (tool === 'blur') {
      options.blur = blurArea && !area ? 0 : blur;
      if (blurArea && area) {
        const xs = area.points.map(point => point[0]), ys = area.points.map(point => point[1]);
        options.blurRect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }
    }
    if (tool === 'canvas') { options.padding = padding; options.background = hexColor(background); }
    if (tool === 'perspective') {
      const values = corners.map(Number);
      if (corners.some(value => !value.trim()) || values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error('Enter corner positions from 0 to 100%.');
      const points = [0,2,4,6].map(index => [values[index] / 100, values[index + 1] / 100]);
      if (points.some((a,i) => { const b = points[(i+1)%4], c = points[(i+2)%4]; return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]) <= 0.0001; })) throw new Error('Keep the four corners in clockwise order without overlapping.');
      options.perspective = points;
    }
    if (tool === 'watermark') options.watermark = { text: watermark, imageUri: logo?.uri ?? '', size: markSize, imageScale: markSize * 4, color: hexColor(ink), opacity, x, y };
    if (drawing && includeMarks) options.marks = marks;
    if (tool === 'rename') { options.format = 'png'; options.quality = 100; }
    return options;
  }
  let request = ''; let issue = '';
  const previewSettings = curveDraft ? { ...optionHistory.value, curves: { ...curves, [curveDraft.channel]: curves[curveDraft.channel].map((value, index) => index === curveDraft.index ? curveDraft.value : value) } } : optionHistory.value;
  try { request = JSON.stringify(compare ? { format: 'png', quality: 100 } : parameters(false, previewSettings)); } catch (cause) { issue = (cause as Error).message; request = JSON.stringify({ format: 'png', quality: 100 }); }
  const previewPending = useRef<{ request: string; uri: string; epoch: number } | null>(null);
  const previewRunning = useRef(false);
  const previewEpoch = useRef(0);
  const previewScope = useRef('');
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewJob = useRef<string | null>(null);
  const pumpPreview = useCallback(async () => {
    if (previewRunning.current || !mounted.current) return;
    previewRunning.current = true; setPreviewBusy(true);
    try {
      while (previewPending.current && mounted.current) {
        await Promise.allSettled([...jobs.current.values()]);
        const next = previewPending.current;
        if (!next || !mounted.current || locked.current) break;
        previewPending.current = null;
        const job = uid(); previewJob.current = job;
        const options = JSON.parse(next.request) as Record<string, unknown>;
        const image = new File(directory, `preview-${job}.${extension(String(options.format))}`);
        try {
          const value = await run({ ...options, action: 'preview', uri: next.uri, outputUri: image.uri }, job);
          // Publish completed frames during a continuous drag. A different source,
          // compare mode or screen lifetime always invalidates the old frame.
          if (next.epoch !== previewEpoch.current || !mounted.current || locked.current) { if (image.exists) image.delete(); continue; }
          setPreview({ ...value as unknown as Output, sourceUri: next.uri }); setError(''); frames.current.push(image.uri);
          while (frames.current.length > 3) { try { new File(frames.current.shift()!).delete(); } catch { /* Session cleanup retries. */ } }
        } catch (cause) {
          if (next.epoch === previewEpoch.current && mounted.current && !previewPending.current) setError((cause as Error).message);
          try { if (image.exists) image.delete(); } catch { /* Session cleanup retries. */ }
        } finally { if (previewJob.current === job) previewJob.current = null; }
      }
    } finally { previewRunning.current = false; if (mounted.current) setPreviewBusy(false); }
  }, [directory, run]);
  useEffect(() => {
    const scope = JSON.stringify([active, available, previewFile?.uri, busy, picking, results.length, tool, compare, retry]);
    if (scope !== previewScope.current) {
      previewScope.current = scope; previewEpoch.current++;
      previewPending.current = null;
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = null;
      if (previewJob.current) FileEngine?.cancelImageJob(previewJob.current);
    }
    if (!active || !available || !previewFile || busy || picking || results.length || !request || tool === 'info') return;
    previewPending.current = { request, uri: previewFile.uri, epoch: previewEpoch.current };
    if (previewRunning.current || previewTimer.current) return;
    previewTimer.current = setTimeout(() => { previewTimer.current = null; void pumpPreview(); }, 40);
  }, [active, available, previewFile, batch, busy, picking, results.length, request, retry, tool, compare, pumpPreview]);
  useEffect(() => () => {
    previewPending.current = null;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (previewJob.current) FileEngine?.cancelImageJob(previewJob.current);
  }, []);
  async function chooseImages(watermarkImage = false) {
    if (locked.current) return;
    try {
      locked.current = true; setPicking(true);
      jobs.current.forEach((_, job) => FileEngine?.cancelImageJob(job));
      await Promise.allSettled([...jobs.current.values()]);
      if (!mounted.current) return;
      const picked = await browseFiles(directory, true, watermarkImage ? 1 : 9, false);
      if (!mounted.current || !picked.length) return;
      for (const old of watermarkImage ? (logo ? [logo] : []) : extra) {
        try { const previous = new File(old.uri); if (previous.exists) previous.delete(); } catch { /* Session teardown retries. */ }
      }
      edit(() => { if (watermarkImage) setLogo(picked[0]); else { setExtra(picked); setBatchIndex(0); } }, true);
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { locked.current = false; if (mounted.current) setPicking(false); else disposeImports(directory); }
  }
  async function removeLogo() {
    if (locked.current || !logo) return;
    locked.current = true; setPicking(true);
    try {
      jobs.current.forEach((_, job) => FileEngine?.cancelImageJob(job));
      await Promise.allSettled([...jobs.current.values()]);
      const image = new File(logo.uri); if (image.exists) image.delete();
      if (mounted.current) edit(() => setLogo(undefined), true);
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { locked.current = false; if (mounted.current) setPicking(false); }
  }
  async function save() {
    if (!file || locked.current || activeCurveDrag.current || !recovery.ready || !markRecovery.ready) return;
    locked.current = true; Keyboard.dismiss();
    try {
      const snapshot = optionHistory.getCurrent();
      const options = parameters(true, snapshot);
      if (tool === 'watermark' && !snapshot.watermark.trim() && !logo) throw new Error('Enter watermark text or choose an image.');
      if (drawing && !marks.length && !workspace.changed) throw new Error('Draw on the image before saving.');
      if (tool === 'blur' && snapshot.blurArea && !area) throw new Error('Select the area to blur first.');
      const ext = tool === 'rename' ? file.name.match(/\.([^.]+)$/)?.[1] ?? 'jpg' : extension(snapshot.format);
      const suggested = `${file.name.replace(/\.[^.]+$/, '')}${tool === 'rename' ? '' : ' - ' + tool.replace(/_/g, ' ')}.${ext}`;
      const origin = workspace.origin ?? file;
      const outputMime = tool === 'rename' ? info!.mimeType : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const namingOnly = batch || tool === 'rename';
      const choice = namingOnly ? null : await askSaveOptions(origin.name, outputMime, suggested);
      // The physical output extension must match its encoder, even when Save changes format.
      const chosen = namingOnly ? await askNewFileName(suggested) : choice?.mode === 'replace'
        ? `${origin.name.replace(/\.[^.]+$/, '')}.${ext}` : choice?.name;
      if (!chosen || !mounted.current) return;
      setBusy(true); setError(''); cancelled.current = false;
      jobs.current.forEach((_, job) => FileEngine?.cancelImageJob(job));
      await Promise.allSettled([...jobs.current.values()]);
      const inputs = batch ? [file, ...extra] : [file]; const outputs: Output[] = [];
      const folder = new Directory(Paths.document, 'Versara Images'); folder.create({ intermediates: true, idempotent: true });
      for (let index = 0; index < inputs.length; index++) {
        if (cancelled.current || !mounted.current) break;
        setProgress(`Processing ${index + 1} of ${inputs.length}`);
        let name = inputs.length > 1 ? chosen.replace(/\.[^.]+$/, ` - ${String(index + 1).padStart(2,'0')}.${ext}`) : chosen;
        let suffix = 2; while (new File(folder, name).exists) name = chosen.replace(/\.[^.]+$/, ` (${suffix++}).${ext}`);
        const output = new File(folder, name); let accepted = false;
        try {
          let result: Output;
          if (tool === 'rename') { await new File(inputs[index].uri).copy(output); result = { uri: output.uri, width: info!.width, height: info!.height, size: output.size, mimeType: info!.mimeType, name }; }
          else result = { ...(await run({ ...options, action: 'export', uri: inputs[index].uri, outputUri: output.uri }) as unknown as Output), name };
          if (!mounted.current || cancelled.current) break;
          // Keep generated bytes available for retry if publication fails.
          result = { ...result, saveMode: choice?.mode ?? 'new' };
          accepted = true; outputs.push(result); if (mounted.current) setResults([...outputs]);
          const saved = await saveEditedOutput({ output: result.uri, mimeType: result.mimeType, kind: 'image', mode: result.saveMode!, origin: batch ? undefined : origin, name });
          outputs[outputs.length - 1] = { ...result, uri: saved.file.uri, name: saved.file.name, location: saved.device.location };
          if (mounted.current) setResults([...outputs]);
        } finally { if (!accepted) { await forgetRecentUri(output.uri); if (output.exists) output.delete(); } }
      }
      if (outputs.length === inputs.length) { await recovery.clear(); await markRecovery.clear(); await workspace.discard(); }
      if (mounted.current) setSaved(outputs.length === inputs.length);
    } catch (cause) { if (mounted.current) setError((cause as Error).message || 'Could not save this image.'); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); setPreviewBusy(false); setRetry(value => value + 1); } }
  }
  async function saveResult(result: Output) {
    if (locked.current || result.location) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const saved = await saveEditedOutput({ output: result.uri, mimeType: result.mimeType, kind: 'image', mode: result.saveMode ?? 'new', origin: batch ? undefined : workspace.origin ?? file, name: result.name });
      if (mounted.current) setResults(current => current.map(item => item.uri === result.uri ? { ...item, uri: saved.file.uri, name: saved.file.name, location: saved.device.location } : item));
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const strip = (children: ReactNode) => <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.strip}>{children}</ScrollView>;
  const panel = <View style={docked ? styles.dockPanel : styles.panel}>
    {!drawing && !docked && <View style={styles.wrap}><EditorOption label="Reset" disabled={busy || !!curveDraft || !changed} onPress={()=>edit(()=>optionHistory.update(initialSettings))} /></View>}
    {!!(recovery.error || markRecovery.error) && <ThemedText accessibilityRole="alert">{recovery.error || markRecovery.error}</ThemedText>}
    {batch && <><ThemedText>{1 + extra.length} of 10 images</ThemedText><ToolButton title="Choose more images" secondary disabled={busy} onPress={() => void chooseImages()} />{extra.map((item,index) => <ThemedText key={item.uri} numberOfLines={1}>{index + 2}. {item.name}</ThemedText>)}<ThemedText style={styles.note}>Settings apply to every image. Files process one at a time.</ThemedText></>}
    {sizing && <>
      <ImageResizeControls source={info} value={resize} disabled={busy || picking} inSheet onChange={value => edit(() => setResize(value))} />
      <View style={styles.wrap}>{presets.map(item => <EditorOption key={item.label} label={item.label} selected={resize.mode === 'pixels' && Number(resize.width)===item.width && Number(resize.height)===item.height} disabled={busy || !!curveDraft} onPress={() => edit(() => { setResize({ ...resize, mode: 'pixels', width: String(item.width), height: String(item.height), locked: false }); setResizeMode('fill'); })} />)}</View>
      <View style={styles.wrap}>{['fit','fill','stretch'].map(value => <EditorOption key={value} label={value} selected={resizeMode===value} disabled={busy || !!curveDraft} onPress={() => edit(()=>setResizeMode(value))} />)}</View><ThemedText style={styles.note}>Fit adds space; fill crops edges; stretch changes proportions.</ThemedText>{resizeMode === 'fit' && <><ThemedText>Background color</ThemedText><ColorSwatches value={background} disabled={busy} onChange={value => edit(() => setBackground(value ?? 0xffffff))} /></>}{batch && <ThemedText style={styles.note}>Percentage applies to each image separately. The dimensions above are for the first image.</ThemedText>}
    </>}
    {compressing && <>{<AdjustmentInput label={'Target size in KB (optional)'} value={target} onChange={value=>edit(()=>setTarget(value))} numeric={true} disabled={busy || !!curveDraft} />}<ThemedText style={styles.note}>Target compression lowers quality, then dimensions if needed.</ThemedText></>}
    {tool === 'exposure' && <AdjustmentSlider label={'Exposure'} value={exposure} min={-3} max={3} onChange={next => edit(() => (setExposure)(next))} display={`${exposure.toFixed(1)} EV`} disabled={busy || !!curveDraft} />}
    {tool === 'curves' && <>
      {strip(<>{CURVE_CHANNELS.map(channel => <EditorOption key={channel.id} compact label={channel.label} selected={curveChannel === channel.id} disabled={busy || !!curveDraft} icon={{ ios: 'chart.xyaxis.line', android: 'show-chart' }} onPress={() => { if (!locked.current && !activeCurveDrag.current) setCurveChannel(channel.id); }} />)}<EditorOption compact label="Reset channel" disabled={busy || !!curveDraft} icon={{ ios: 'arrow.counterclockwise', android: 'restart-alt' }} onPress={() => edit(() => setOption('curves', current => ({ ...current, [curveChannel]: NEUTRAL_CURVE })))} /></>)}
      <CurveGraph key={`${file?.uri}:${curveChannel}`} values={curves[curveChannel]} selected={curvePoint} disabled={busy || !active || compare || !recovery.ready} onBegin={beginCurveDrag} onPreview={previewCurveDrag} onCommit={finishCurveDrag} onCancel={token => finishCurveDrag(token, 0)} />
      <ThemedText style={styles.note}>{CURVE_POINTS[curvePoint]} {Math.round(previewSettings.curves[curveChannel][curvePoint] * 100)}%. Drag a point up or down.</ThemedText>
    </>}
    {tool === 'levels' && <>
      {strip(<>{LEVEL_POINTS.map(item => <EditorOption key={item.id} compact label={item.label} selected={levelPoint === item.id} disabled={busy} onPress={() => setLevelPoint(item.id)} />)}<EditorOption compact label="Reset levels" disabled={busy} icon={{ ios: 'arrow.counterclockwise', android: 'restart-alt' }} onPress={() => edit(() => setOption('levels', NEUTRAL_LEVELS))} /></>)}
      {levelPoint === 'black' && <AdjustmentSlider key="black" label={'Black point'} value={levels.black * 255} min={0} max={Math.max(0, Math.round(levels.white * 255) - 1)} onChange={next => edit(() => setOption('levels', current => ({ ...current, black: Math.max(0, Math.min(Math.round(next), Math.round(current.white * 255) - 1)) / 255 })))} display={`${Math.round(levels.black * 255)} / 255`} disabled={busy || !!curveDraft} />}
      {levelPoint === 'gamma' && <AdjustmentSlider key="gamma" label={'Midtone gamma'} value={levels.gamma} min={.1} max={3} onChange={next => edit(() => (value => setOption('levels', current => ({ ...current, gamma: Math.round(value * 100) / 100 })))(next))} display={levels.gamma.toFixed(2)} disabled={busy || !!curveDraft} />}
      {levelPoint === 'white' && <AdjustmentSlider key="white" label={'White point'} value={levels.white * 255} min={Math.min(255, Math.round(levels.black * 255) + 1)} max={255} onChange={next => edit(() => setOption('levels', current => ({ ...current, white: Math.min(255, Math.max(Math.round(next), Math.round(current.black * 255) + 1)) / 255 })))} display={`${Math.round(levels.white * 255)} / 255`} disabled={busy || !!curveDraft} />}
    </>}
    {tool === 'hsl' && <>
      {strip(<>{HSL_BANDS.map(band => <Pressable key={band.id} accessibilityRole="button" accessibilityLabel={`${band.label} color range`} accessibilityState={{ selected: hslBand === band.id, disabled: busy }} disabled={busy} onPress={() => setHslBand(band.id)} style={[colorStyles.range, { backgroundColor: hslBand === band.id ? colors.accentSurface : colors.fieldSurface, borderColor: hslBand === band.id ? colors.accent : colors.separator }]}><View style={[colorStyles.dot, { backgroundColor: band.color }]} /><ThemedText style={{ fontSize: 13, color: hslBand === band.id ? colors.accent : colors.label }}>{band.label}</ThemedText></Pressable>)}</>)}
      {strip(<>{HSL_PARTS.map(item => <EditorOption key={item.id} compact label={item.label} selected={hslPart === item.id} disabled={busy} onPress={() => setHslPart(item.id)} />)}<EditorOption compact label="Reset color" disabled={busy} icon={{ ios: 'arrow.counterclockwise', android: 'restart-alt' }} onPress={() => edit(() => setOption('hsl', current => ({ ...current, [hslBand]: { hue: 0, saturation: 0, lightness: 0 } })))} /></>)}
      <AdjustmentSlider key={`${hslBand}:${hslPart}`} label={HSL_PARTS.find(item => item.id === hslPart)!.label} value={hsl[hslBand][hslPart]} min={hslPart === 'hue' ? -180 : -100} max={hslPart === 'hue' ? 180 : 100} onChange={next => edit(() => setHslValue(hslPart, next))} display={`${hsl[hslBand][hslPart] > 0 ? '+' : ''}${hsl[hslBand][hslPart]}${hslPart === 'hue' ? '°' : '%'}`} disabled={busy || !!curveDraft} />
    </>}
    {tool === 'sharpen' && <AdjustmentSlider label={'Sharpness'} value={sharpen} min={0} max={2} onChange={next => edit(() => (setSharpen)(next))} display={sharpen.toFixed(1)} disabled={busy || !!curveDraft} />}
    {tool === 'blur' && <>{<AdjustmentSlider label={'Blur'} value={blur} min={0} max={.035} onChange={next => edit(() => (setBlur)(next))} display={`${Math.round(blur*1000)}`} disabled={busy || !!curveDraft} />}<View style={styles.wrap}>{<EditorOption key={'Whole image'} label={'Whole image'} selected={!blurArea} disabled={busy || !!curveDraft} onPress={() => edit(()=>{setBlurArea(false);setSelectingArea(false);})} />}{<EditorOption key={area?'Reselect area':'Select area'} label={area?'Reselect area':'Select area'} selected={blurArea} disabled={busy || !!curveDraft} onPress={() => edit(()=>{setBlurArea(true);setSelectingArea(true);setSettings(false);setCompare(false);})} />}</View>{blurArea && <ThemedText style={styles.note}>Drag a rectangle in the preview to choose the area.</ThemedText>}</>}
    {tool === 'canvas' && <>{<AdjustmentSlider label={'Border width'} value={padding} min={0} max={.3} onChange={next => edit(() => (setPadding)(next))} display={`${Math.round(padding*100)}%`} disabled={busy || !!curveDraft} />}<ThemedText>Border color</ThemedText><ColorSwatches value={background} onChange={value=>edit(()=>setBackground(value??0xffffff))} disabled={busy} /></>}
    {tool === 'perspective' && <><ThemedText style={styles.note}>Move the four source corners using percentages. The selected area becomes a rectangle.</ThemedText>{['Top left','Top right','Bottom right','Bottom left'].map((label,index)=><View key={label}><ThemedText>{label}</ThemedText><View style={styles.row}><View style={styles.grow}>{<AdjustmentInput label={'X %'} value={corners[index*2]} onChange={value=>edit(()=>setCorners(current=>current.map((item,i)=>i===index*2?value:item)))} numeric={true} disabled={busy || !!curveDraft} />}</View><View style={styles.grow}>{<AdjustmentInput label={'Y %'} value={corners[index*2+1]} onChange={value=>edit(()=>setCorners(current=>current.map((item,i)=>i===index*2+1?value:item)))} numeric={true} disabled={busy || !!curveDraft} />}</View></View></View>)}</>}
    {tool === 'watermark' && <>{<AdjustmentInput label={'Watermark text'} value={watermark} onChange={value=>edit(()=>setWatermark(value))} numeric={false} disabled={busy || !!curveDraft} />}<ToolButton title={logo ? 'Change watermark image' : 'Choose watermark image'} secondary disabled={busy} onPress={()=>void chooseImages(true)} />{logo && <ToolButton title="Use text instead" secondary disabled={busy||picking} onPress={()=>void removeLogo()} />}{<AdjustmentSlider label={'Opacity'} value={opacity} min={.05} max={1} onChange={next => edit(() => (setOpacity)(next))} display={`${Math.round(opacity*100)}%`} disabled={busy || !!curveDraft} />}{<AdjustmentSlider label={logo?'Image size':'Text size'} value={markSize} min={.01} max={.2} onChange={next => edit(() => (setMarkSize)(next))} display={`${Math.round(markSize*100)}%`} disabled={busy || !!curveDraft} />}{<AdjustmentSlider label={'Horizontal position'} value={x} min={0} max={1} onChange={next => edit(() => (setX)(next))} display={`${Math.round(x*100)}%`} disabled={busy || !!curveDraft} />}{<AdjustmentSlider label={'Vertical position'} value={y} min={0} max={1} onChange={next => edit(() => (setY)(next))} display={`${Math.round(y*100)}%`} disabled={busy || !!curveDraft} />}<ColorSwatches value={ink} onChange={value=>{edit(()=>setInk(value??0));styleSelection({color:hexColor(value??0)});}} disabled={busy} /></>}
    {markupEditing && selectedMark?.id && <View style={styles.wrap}><EditorOption label="Duplicate" disabled={busy || marks.length >= 300} onPress={()=>edit(()=>{if(!history.duplicate(selectedMark.id!))setError('Save before adding more marks.');})} /><EditorOption label="Delete" disabled={busy} onPress={()=>edit(()=>{history.remove(selectedMark.id!);setSelectedId(undefined);})} /></View>}
    {drawing && tool !== 'redact' && <><View style={styles.wrap}>{<EditorOption key={'Select & resize'} label={'Select & resize'} selected={selecting} disabled={busy || !!curveDraft} onPress={() => edit(()=>{setErasing(false);setSelectedId(undefined);setSelecting(value=>!value);})} />}{<EditorOption key={'Pen'} label={'Pen'} selected={shape==='pen'} disabled={busy || !!curveDraft} onPress={() => edit(()=>{setShape('pen');setSelecting(false);})} />}{<EditorOption key={'Shapes'} label={'Shapes'} selected={shape!=='pen'} disabled={busy || !!curveDraft} onPress={() => edit(()=>setShape('rectangle'))} />}</View>{shape==='pen' && <BrushControls patternsAvailable={!!PdfEngine?.nativeStrokePatternsVersion && !!FileEngine?.nativeStrokePatternsVersion} brush={brushType} pattern={pattern} disabled={busy} editingAvailable={markupEditing} opacity={inkOpacity} onOpacity={value=>{setInkOpacity(value);styleSelection({opacity:value});}} erasing={erasing} onEraser={()=>{setErasing(value=>!value);setSelecting(false);}} onBrush={(value,width,opacity)=>{setErasing(false);setBrushType(value);setInkWidth(width);setInkOpacity(opacity);styleSelection({brush:value,width,opacity});}} onPattern={value=>{setPattern(value);styleSelection({pattern:value});}} />}{shape!=='pen' && <ShapePicker value={shape} disabled={busy} onChange={value=>edit(()=>setShape(value))} />}<ColorSwatches value={ink} disabled={busy} onChange={value=>{edit(()=>setInk(value??0));styleSelection({color:hexColor(value??0)});}} />{shape!=='pen' && <><ThemedText>Fill</ThemedText><ColorSwatches value={fill} original={{label:'None',value:null}} disabled={busy} onChange={value=>{edit(()=>setFill(value));styleSelection({fillColor:value===null?'':hexColor(value)});}} /></>}{<AdjustmentSlider label={'Thickness'} value={inkWidth} min={.002} max={.05} onChange={next => edit(() => (value=>{setInkWidth(value);styleSelection({width:value});})(next))} display={`${Math.round(inkWidth*1000)}`} disabled={busy || !!curveDraft} />}</>}
    {tool === 'metadata' && <ThemedText>Creates a new raster image without source EXIF, GPS or camera tags. Visible information stays in the image.</ThemedText>}
    {tool === 'rename' && <ThemedText>Save an identical copy with a new name. The original stays unchanged.</ThemedText>}
    {exportTool && tool !== 'rename' && <ThemedText style={styles.note}>Exports keep the original resolution unless you resize or set a compression target. Images that exceed device memory need a smaller size.</ThemedText>}
    {!exportTool && !docked && <ThemedText style={styles.note}>Apply adds this change to the image. Save once from the image preview when you are done.</ThemedText>}
    {exportTool && tool !== 'rename' && <><ThemedText style={styles.label}>Output format</ThemedText><View style={styles.wrap}>{info?.formats.map(value=><EditorOption key={value.toUpperCase()} label={value.toUpperCase()} selected={format===value} disabled={busy || !!curveDraft} onPress={() => edit(()=>setFormat(value))} />)}</View><ThemedText style={styles.note}>Available formats use the native encoders on your device.</ThemedText>{!['png','tiff'].includes(format) && <AdjustmentSlider label={'Quality'} value={quality} min={10} max={100} onChange={next => edit(() => (value=>setQuality(Math.round(value)))(next))} display={`${quality}%`} disabled={busy || !!curveDraft} />}</>}
  </View>;
  async function applyToWorkspace() {
    if (!recovery.ready || !markRecovery.ready) throw new Error('Wait for draft recovery to finish.');
    if (!file || !info || locked.current || activeCurveDrag.current) throw new Error('Wait for the image change to finish.');
    if (batch && extra.length) throw new Error('Export this batch before switching tools.');
    if (tool === 'info' || tool === 'rename') return;
    locked.current = true; setBusy(true);
    try {
      const snapshot = optionHistory.getCurrent();
      if (tool === 'watermark' && !snapshot.watermark.trim() && !logo) throw new Error('Enter a watermark or choose an image first.');
      const options = parameters(true, snapshot);
      jobs.current.forEach((_, job) => FileEngine?.cancelImageJob(job));
      await Promise.allSettled([...jobs.current.values()]);
      // Preserve requested compression/conversion; other intermediate operations stay lossless.
      const outputOptions = compressing || tool === 'convert' ? options : { ...options, targetBytes: 0, format: 'png', quality: 100 };
      await workspace.apply(outputUri => run({ ...outputOptions, action: 'export', uri: file.uri, outputUri }) as unknown as Promise<Output>, file, String(outputOptions.format));
      await recovery.clear(); await markRecovery.clear();
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  /** Shares a saved result, otherwise a fresh export with the current settings and marks. */
  async function shareImage() {
    if (!file || !info || locked.current || activeCurveDrag.current || !recovery.ready || !markRecovery.ready) return;
    if (results.length) { const output = results[0]; await shareNamedFile({ uri: output.uri, name: output.name, mimeType: output.mimeType, size: output.size }); return; }
    if (tool === 'rename' || tool === 'info') { await shareNamedFile({ uri: file.uri, name: file.name, mimeType: info.mimeType, size: file.size }); return; }
    const snapshot = optionHistory.getCurrent();
    if (tool === 'watermark' && !snapshot.watermark.trim() && !logo) throw new Error('Enter watermark text or choose an image.');
    if (tool === 'blur' && snapshot.blurArea && !area) throw new Error('Select the area to blur first.');
    const options = parameters(true, snapshot);
    const ext = extension(String(options.format ?? snapshot.format));
    const base = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Image';
    locked.current = true; setBusy(true); Keyboard.dismiss();
    try {
      jobs.current.forEach((_, job) => FileEngine?.cancelImageJob(job));
      await Promise.allSettled([...jobs.current.values()]);
      await shareRenderedFile(`${base} - ${tool.replace(/_/g, ' ')}.${ext}`, ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, outputUri => run({ ...options, action: 'export', uri: file.uri, outputUri }));
    } finally { locked.current = false; if (mounted.current) { setBusy(false); setRetry(value => value + 1); } }
  }
  const cancel = () => { cancelled.current = true; jobs.current.forEach((_,job)=>FileEngine?.cancelImageJob(job)); };
  const activeBrush = BRUSHES.find(item => item.id === brushType) ?? BRUSHES[0];
  const toggleSettings = () => { Keyboard.dismiss(); setSettings(value => !value); };
  const settingsAction = drawing
    ? <ToolRowButton label="Style and colour" icon={{ ios: 'paintpalette', android: 'palette' }} selected={settings} expanded={settings} disabled={busy} onPress={toggleSettings} />
    : docked ? null : <ToolRowButton label="Image options" icon={{ ios: 'slider.horizontal.3', android: 'tune' }} selected={settings} expanded={settings} disabled={busy || tool === 'rename'} onPress={toggleSettings} />;
  // Drawing controls sit in one icon row, like the PDF markup tools.
  const drawActions = drawing && <>
    {tool !== 'redact' && <EditorMenu iconOnly tintedItems grid={3} label={`Brush: ${activeBrush.label}`} icon={optionIcon(activeBrush.label)} colorKey={activeBrush.colorKey} disabled={busy} items={BRUSHES.map(item => ({ id: item.id, label: item.label, colorKey: item.colorKey, selected: brushType === item.id && shape === 'pen' && !erasing, onPress: () => edit(() => { setErasing(false); setSelecting(false); setShape('pen'); setBrushType(item.id); setInkWidth(item.width); setInkOpacity(item.opacity); styleSelection({ brush: item.id, width: item.width, opacity: item.opacity }); }) }))} />}
    {tool !== 'redact' && <ShapePicker iconOnly value={shape} onChange={value => edit(() => { setShape(value); setSelecting(false); setErasing(false); })} disabled={busy} />}
    {markupEditing && <ToolRowButton label={erasing ? 'Stop erasing' : 'Stroke eraser'} icon={{ ios: 'eraser', android: 'auto-fix-normal' }} selected={erasing} disabled={busy} onPress={() => { setErasing(value => !value); setSelecting(false); }} />}
  </>;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.screen,{backgroundColor:colors.systemBackground}]}>
    {toolbar.measurements}
    <Stack.Screen options={{ gestureEnabled: false }} />
    <ScreenHeader title={title} onBack={close} share={{ onPress: shareImage, disabled: busy || picking || !!curveDraft || !file || !info, label: results.length ? 'Share saved image' : tool === 'rename' || tool === 'info' ? 'Share image' : 'Share edited image' }}
      save={{ onPress: () => exportTool ? save() : applyAndReturn(), label: saveTitle, disabled: busy || picking || !!curveDraft || !file || !info || !available || results.length > 0 || !!issue || ((drawing || blurArea) && !PdfMarkupView) }} />
    <ToolActionRow
      left={<><FitSlotButton /><HeaderHistoryButtons disabled={busy || !!curveDraft || !recovery.ready || !!results.length} canUndo={drawing ? history.canUndo : optionHistory.canUndo} canRedo={drawing ? history.canRedo : optionHistory.canRedo} onUndo={() => edit(drawing ? () => { history.undo(); } : optionHistory.undo)} onRedo={() => edit(drawing ? () => { history.redo(); } : optionHistory.redo)} /></>}
      right={<ImageWorkspaceTools id={id} current={tool} disabled={busy || picking || !!curveDraft || !file || !info || !!results.length} onApply={applyToWorkspace} />} />
    {!available ? <View style={styles.empty}><ThemedText>Install a new development build to use these native image tools.</ThemedText></View> : !file || !info ? <View style={styles.empty}>{error ? <><ThemedText accessibilityRole="alert">{error}</ThemedText><ToolButton title="Try again" secondary onPress={()=>{initialized.current=false;setError('');setRetry(value=>value+1);}} /></> : <AppLoader />}</View> : results.length ? <ScrollView contentContainerStyle={styles.panel}><ThemedText style={styles.heading}>{busy ? progress : results.some(result => !result.location) ? 'Your images are ready' : `${results.length} image${results.length===1?'':'s'} saved`}</ThemedText>{results.map(result=><View key={result.uri} style={[styles.result,{backgroundColor:colors.catalogSurface}]}><ThemedText>{result.name}</ThemedText><ThemedText>{result.width} x {result.height} - {formatSize(result.size)}</ThemedText><ToolButton title="Open image" disabled={busy} onPress={()=>void rememberFile(result,'image').then(value=>router.replace({pathname:'/file-preview',params:{id:value.id}}))} />{result.location ? <ThemedText selectable>Saved to {result.location}</ThemedText> : <ToolButton title="Save" secondary disabled={busy} onPress={()=>void saveResult(result)} />}<ToolButton title="Share" secondary disabled={busy} onPress={()=>void shareFile(result).catch(cause=>setError((cause as Error).message))} /></View>)}{!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}{busy ? <ToolButton title="Cancel remaining images" secondary onPress={cancel} /> : <ToolButton title="Return to tool" secondary onPress={()=>setResults([])} />}</ScrollView> : tool === 'info' ? <ScrollView contentContainerStyle={styles.panel}>{Object.entries({Name:file.name,Dimensions:`${info.width} x ${info.height} px`,Size:formatSize(info.size),Format:info.mimeType,Camera:info.camera||'Not recorded',Taken:info.taken||'Not recorded',Location:info.hasLocation?'GPS metadata present':'Not recorded'}).map(([key,value])=><View key={key} style={styles.field}><ThemedText style={styles.label}>{key}</ThemedText><ThemedText selectable>{value}</ThemedText></View>)}</ScrollView> : <View style={[styles.grow, landscape && styles.landscape]}>
      <View style={styles.grow}>
      <View style={styles.previewHeader}><ThemedText numberOfLines={1} style={[styles.grow,styles.note]}>{batch ? 'Settings apply to all selected images' : `${info.width} x ${info.height} - ${formatSize(info.size)}`}</ThemedText>{!drawing && tool !== 'rename' && <ToolRowButton label={compare ? 'Show changes' : 'Compare with original'} icon={{ ios: 'square.split.2x1', android: 'compare' }} selected={compare} onPress={() => setCompare(value => !value)} />}{drawActions}{settingsAction}</View>
      {batch ? <BatchImagePreview image={preview?.sourceUri === previewFile?.uri ? preview : undefined} name={previewFile?.name ?? file.name} index={batchIndex} count={1 + extra.length} active={active} disabled={busy || picking} updating={previewBusy} onSelect={setBatchIndex} /> : (drawing || selectingArea) && preview && PdfMarkupView ? <PdfPreviewStage hint={selectingArea?'Drag a rectangle around the area to blur.':tool==='redact'?'Drag a solid cover over private information.':'Draw with one finger. Zoom and pan with two.'} onFit={()=>setFit(value=>value+1)}>{active && <PdfMarkupView key={fit} style={styles.grow} source={preview.uri} zoomRequest={markupZoom.request} onZoom={markupZoom.onZoom} marks={JSON.stringify((selectingArea ? (area ? [area] : []) : marks).map(mark=>({...mark,kind:mark.kind==='redact'?'polygon':mark.kind})))} brush={brushType} pattern={pattern} inkOpacity={markupEditing ? inkOpacity : undefined} onSelection={markupEditing ? event=>selectMark(event.nativeEvent.mark) : undefined} mode={erasing ? 'erase' : selecting ? 'select' : selectingArea||tool==='redact'||shape!=='pen'?(shape==='line'?'line':'polygon'):'draw'} shapePath={JSON.stringify(SHAPES.find(item=>item.id===(selectingArea||tool==='redact'?'rectangle':shape))?.points??[])} fillColor={selectingArea?'':tool==='redact'?'#000000':fill===null?'':hexColor(fill)} inkColor={tool==='redact'?'#000000':hexColor(ink)} inkWidth={inkWidth} disabled={busy||!markRecovery.ready||(!selecting&&!erasing&&marks.length>=300)} onMark={({nativeEvent})=>{try {const mark=JSON.parse(nativeEvent.mark) as PdfMarkChange;if('deleted' in mark){edit(()=>history.commit(mark));return;}if(selectingArea){edit(()=>{setArea(mark);setSelectingArea(false);});return;}if(marks.filter(item=>item.id!==mark.id).reduce((total,item)=>total+item.points.length,0)+mark.points.length>20000) throw new Error('Save before adding more strokes.');edit(()=>{history.commit({...mark,page:1,kind:tool==='redact'?'redact':mark.kind});});} catch(cause){setError((cause as Error).message);}}} />}{active && !selectingArea && (selecting || !!resizeTarget) && <MarkupZoomButtons showZoom={selecting} zoom={markupZoom.zoom} onZoomBy={markupZoom.zoomBy} disabled={busy} selection={resizeTarget?.points} onResize={points => { const id = resizeTarget?.id; if (id) edit(() => history.update(id, { points })); }} />}</PdfPreviewStage> : preview ? <PdfPagePreview image={preview} active={active} preserveViewport hint={previewBusy?'Updating preview...':compare||issue?'Original image preview':'Preview - pinch to zoom, drag to move.'} /> : <View style={styles.empty}>{previewBusy ? <AppLoader /> : <ThemedText>{tool==='rename'?'Choose Save to enter a new name.':'Preparing image preview...'}</ThemedText>}</View>}
      {!!(issue||error) && <View style={styles.error}><ThemedText accessibilityRole="alert">{issue||error}</ThemedText>{!issue && <ToolButton title="Retry preview" secondary disabled={busy} onPress={()=>setRetry(value=>value+1)} />}</View>}
      </View>
      <View style={landscape ? styles.side : undefined}>
      {docked ? landscape ? <ScrollView style={styles.grow} keyboardShouldPersistTaps="handled">{panel}</ScrollView> : <View style={[styles.dockBar, { borderColor: colors.separator }]}>{panel}</View>
        : <OptionSheet title={drawing ? 'Style and colour' : `${title} options`} icon={drawing ? { ios: 'paintpalette', android: 'palette' } : { ios: 'slider.horizontal.3', android: 'tune' }} isPresented={settings && tool !== 'rename'} dim={false} keyboardInput={sizing} onClose={() => setSettings(false)}>{panel}</OptionSheet>}
      <PdfPreviewFooter>
        <View onLayout={toolbar.onBottomLayout} style={responsiveToolbarStyles.row}>
          {busy ? <><AppLoader /><ThemedText style={styles.grow}>{progress}</ThemedText><ToolButton title="Cancel" secondary onPress={cancel} /></> : <>
            {drawing && <>
              <EditorOption compact label={tool === 'redact' ? 'Cover' : 'Draw'} selected={!selecting && !erasing} disabled={busy} icon={{ ios: 'pencil.tip', android: 'draw' }} onPress={() => { setSelecting(false); setErasing(false); setSelectedId(undefined); }} />
              <EditorOption compact label="Select & resize" selected={selecting} disabled={busy} icon={{ ios: 'arrow.up.and.down.and.arrow.left.and.right', android: 'open-with' }} onPress={() => { setSelecting(true); setErasing(false); }} />
            </>}
            <View style={[responsiveToolbarStyles.primary, { minWidth: toolbar.primaryMinWidth }]}><ToolButton title={saveTitle} disabled={picking||!!curveDraft||!!issue||((drawing||blurArea)&&!PdfMarkupView)} onPress={()=>void (exportTool ? save() : applyAndReturn())} /></View>
          </>}
        </View>
      </PdfPreviewFooter>
      </View>
    </View>}
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({screen:{flex:1},grow:{flex:1,minWidth:0},landscape:{flexDirection:'row',alignItems:'stretch'},side:{width:300,flexGrow:0},row:{flexDirection:'row',alignItems:'center',gap:8},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},previewHeader:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,gap:8},panel:{padding:16,gap:14},field:{gap:6},label:{fontSize:14,fontWeight:'600'},heading:{fontSize:22,fontWeight:'600'},input:{minHeight:44,borderRadius:12,paddingHorizontal:12,fontSize:16},chip:{minHeight:44,borderRadius:12,paddingHorizontal:12,borderWidth:1,alignItems:'center',justifyContent:'center'},note:{fontSize:12,lineHeight:17},dockBar:{borderTopWidth:StyleSheet.hairlineWidth},dockPanel:{paddingHorizontal:12,paddingVertical:8,gap:6},strip:{flexDirection:'row',alignItems:'center',gap:8},empty:{flex:1,justifyContent:'center',alignItems:'center',padding:24,gap:12},error:{padding:8,gap:6},result:{padding:16,gap:10,borderRadius:16}});

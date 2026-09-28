import { EditorOption } from '@/components/editor-option';
import { BrushControls } from '../pdf/brush-controls';
import { useMarkHistory } from '../pdf/use-mark-history';
import { ImageWorkspaceTools, useImageWorkspace } from './image-workspace';
import { DEFAULT_RESIZE, ImageResizeControls, resolveResize } from './image-resize-controls';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { Host, Slider } from '@expo/ui';
import { FileEngine } from '../../../modules/file-engine';
import PdfMarkupView, { type PdfMark } from '../../../modules/pdf-engine/src/PdfMarkupView';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { AppLoader } from '@/components/app-loader';
import { ColorSwatches, hexColor } from '@/components/color-swatches';
import { showDialog } from '@/components/app-dialog';
import { IMAGE_SECTIONS } from '@/constants/image-methods';
import { useAppearance, usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';
import { forgetRecentUri, rememberFile, type RecentFile } from './recent-files';
import { recordEditedFile } from './edited-files';
import { browseFiles, createImportDirectory, disposeImports, formatSize, shareFile, type LocalFile } from './file-storage';
import { askNewFileName, saveToDevice } from './save-file';
import { PdfPagePreview, PdfPreviewFooter, PdfPreviewStage } from '../pdf/pdf-preview';
import { SHAPES, ShapePicker } from '../pdf/shape-picker';
import { usePdfScreenActive } from '../pdf/use-pdf-screen-active';

type Info = { width: number; height: number; size: number; mimeType: string; formats: string[]; camera: string; taken: string; hasLocation: boolean };
type Output = { uri: string; width: number; height: number; size: number; mimeType: string; name: string };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const extension = (format: string) => format === 'jpeg' ? 'jpg' : format;
const presets = [{ label: 'Square', width: 1080, height: 1080 }, { label: 'Portrait', width: 1080, height: 1350 }, { label: 'Story', width: 1080, height: 1920 }, { label: 'Landscape', width: 1920, height: 1080 }, { label: 'Profile', width: 512, height: 512 }];

/** One image at a time, on native workers. Settings/paths are the only JS payloads. */
export function AdvancedImageToolScreen({ id, tool }: { id: string; tool: string }) {
  const workspace = useImageWorkspace(id);
  const colors = usePalette(); const mode = useAppearance(state => state.mode); const active = usePdfScreenActive();
  const title = IMAGE_SECTIONS.flatMap(section => [...section.tools]).find(item => item.id === tool)?.title ?? 'Image tools';
  const tint = toolColors(tool, colors);
  const batch = tool === 'batch' || tool === 'batch_compress';
  const drawing = tool === 'draw' || tool === 'redact';
  const sizing = ['resize', 'social', 'batch'].includes(tool);
  const compressing = ['compress', 'batch_compress', 'batch'].includes(tool);
  const [directory] = useState(createImportDirectory);
  const [file, setFile] = useState<RecentFile | null>(null);
  const [info, setInfo] = useState<Info>();
  const [extra, setExtra] = useState<LocalFile[]>([]);
  const [preview, setPreview] = useState<Output>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<Output[]>([]);
  const [format, setFormat] = useState(drawing || tool === 'metadata' ? 'png' : 'jpeg');
  const [quality, setQuality] = useState(85);
  const [target, setTarget] = useState('');
  const [resize, setResize] = useState(DEFAULT_RESIZE);
  const [resizeMode, setResizeMode] = useState('fit');
  const [exposure, setExposure] = useState(0); const [sharpen, setSharpen] = useState(0.5); const [blur, setBlur] = useState(0.008);
  const [blurArea, setBlurArea] = useState(false);
  const [area, setArea] = useState<PdfMark>();
  const [selectingArea, setSelectingArea] = useState(false);
  const [padding, setPadding] = useState(0.06); const [background, setBackground] = useState(0xffffff);
  const [corners, setCorners] = useState(['0','0','100','0','100','100','0','100']);
  const [watermark, setWatermark] = useState(''); const [logo, setLogo] = useState<LocalFile>();
  const [opacity, setOpacity] = useState(0.5); const [markSize, setMarkSize] = useState(0.06); const [x, setX] = useState(0.5); const [y, setY] = useState(0.5);
  const [ink, setInk] = useState(0x1d4ed8); const [fill, setFill] = useState<number | null>(null); const [inkWidth, setInkWidth] = useState(0.005);
  const [shape, setShape] = useState('pen'); const history = useMarkHistory(); const { marks } = history;
  const [brushType, setBrushType] = useState('pen'); const [pattern, setPattern] = useState('solid'); const [selecting, setSelecting] = useState(false);
  const [settings, setSettings] = useState(!drawing); const [compare, setCompare] = useState(false); const [fit, setFit] = useState(0); const [retry, setRetry] = useState(0);
  const mounted = useRef(true); const locked = useRef(false); const cancelled = useRef(false); const jobs = useRef(new Map<string, Promise<unknown>>()); const frames = useRef<string[]>([]);
  const initialized = useRef(false);
  const [saved, setSaved] = useState(false);
  const [changed, setChanged] = useState(false);
  const available = !!FileEngine?.nativeImageToolsVersion;
  const closeRef = useRef(() => {});
  function leave() { if (router.canGoBack()) router.back(); else router.replace('/(modules)/image'); }
  function close() {
    if (busy) { cancelled.current = true; jobs.current.forEach((_, id) => FileEngine?.cancelImageJob(id)); return; }
    if ((changed || workspace.changed) && !saved) showDialog('Discard image changes?', 'Your current settings and marks have not been saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: leave }]);
    else leave();
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
  function edit(action: () => void) { setChanged(true); setSaved(false); action(); }
  function parameters(includeMarks = true): Record<string, unknown> {
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
  try { request = JSON.stringify(compare ? { format: 'png', quality: 100 } : parameters(false)); } catch (cause) { issue = (cause as Error).message; request = JSON.stringify({ format: 'png', quality: 100 }); }
  useEffect(() => {
    if (!active || !file || busy || picking || results.length || !request || tool === 'info') return;
    let current = true; const job = uid(); const image = new File(directory, `preview-${job}.${extension((JSON.parse(request) as { format: string }).format)}`);
    const timer = setTimeout(() => {
      setPreviewBusy(true);
      void Promise.allSettled([...jobs.current.values()]).then(() => {
        if (!current || !mounted.current || locked.current) return;
        return run({ ...JSON.parse(request), action: 'preview', uri: file.uri, outputUri: image.uri }, job).then(value => {
        if (!current || !mounted.current) { if (image.exists) image.delete(); return; }
        setPreview(value as unknown as Output); setError(''); frames.current.push(image.uri);
        while (frames.current.length > 3) { try { new File(frames.current.shift()!).delete(); } catch { /* Session cleanup retries. */ } }
        });
      }).catch(cause => { if (current && mounted.current) setError((cause as Error).message); try { if (image.exists) image.delete(); } catch { /* Cleared on teardown. */ } })
        .finally(() => { if (current && mounted.current) setPreviewBusy(false); });
    }, 160);
    return () => { current = false; clearTimeout(timer); FileEngine?.cancelImageJob(job); };
  }, [active, file, busy, picking, results.length, request, directory, retry, tool, run]);
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
      edit(() => { if (watermarkImage) setLogo(picked[0]); else setExtra(picked); });
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
      if (mounted.current) edit(() => setLogo(undefined));
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { locked.current = false; if (mounted.current) setPicking(false); }
  }
  async function save() {
    if (!file || locked.current) return;
    locked.current = true; Keyboard.dismiss();
    try {
      const options = parameters();
      if (tool === 'watermark' && !watermark.trim() && !logo) throw new Error('Enter watermark text or choose an image.');
      if (drawing && !marks.length) throw new Error('Draw on the image before saving.');
      if (tool === 'blur' && blurArea && !area) throw new Error('Select the area to blur first.');
      const ext = tool === 'rename' ? file.name.match(/\.([^.]+)$/)?.[1] ?? 'jpg' : extension(format);
      const chosen = await askNewFileName(`${file.name.replace(/\.[^.]+$/, '')}${tool === 'rename' ? '' : ' - ' + tool.replace(/_/g, ' ')}.${ext}`);
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
          await rememberFile({ ...result, name }, 'image');
          await recordEditedFile({ ...result, kind: 'image', deviceUri: '', location: 'Versara - app storage' });
          accepted = true; outputs.push(result); if (mounted.current) setResults([...outputs]);
        } finally { if (!accepted) { await forgetRecentUri(output.uri); if (output.exists) output.delete(); } }
      }
      if (mounted.current) setSaved(outputs.length === inputs.length);
    } catch (cause) { if (mounted.current) setError((cause as Error).message || 'Could not save this image.'); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); setPreviewBusy(false); } }
  }
  const input = (label: string, value: string, onChange: (value: string) => void, numeric = true) => <View style={styles.field}><ThemedText style={styles.label}>{label}</ThemedText><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!busy} keyboardType={numeric ? 'number-pad' : 'default'} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} maxLength={numeric ? 6 : 200} style={[styles.input, { color: colors.label, backgroundColor: colors.fieldSurface }]} /></View>;
  const slider = (label: string, value: number, min: number, max: number, onChange: (value: number) => void, display: string) => <View style={styles.field}><View style={styles.row}><ThemedText style={[styles.label, styles.grow]}>{label}</ThemedText><ThemedText>{display}</ThemedText></View><Host colorScheme={mode} matchContents={{ vertical: true }}><Slider min={min} max={max} value={value} onValueChange={next => edit(() => onChange(next))} disabled={busy} /></Host></View>;
  const choice = (label: string, selected: boolean, action: () => void) => <EditorOption key={label} label={label} selected={selected} disabled={busy} onPress={() => edit(action)} />;
  const panel = <View style={styles.panel}>
    {batch && <><ThemedText>{1 + extra.length} of 10 images</ThemedText><ToolButton title="Choose more images" secondary disabled={busy} onPress={() => void chooseImages()} />{extra.map((item,index) => <ThemedText key={item.uri} numberOfLines={1}>{index + 2}. {item.name}</ThemedText>)}<ThemedText style={styles.note}>Settings apply to every image. Files process one at a time.</ThemedText></>}
    {sizing && <>
      <ImageResizeControls source={info} value={resize} disabled={busy || picking} onChange={value => edit(() => setResize(value))} />
      <View style={styles.wrap}>{presets.map(item => choice(item.label, resize.mode === 'pixels' && Number(resize.width)===item.width && Number(resize.height)===item.height, () => { setResize({ ...resize, mode: 'pixels', width: String(item.width), height: String(item.height), locked: false }); setResizeMode('fill'); }))}</View>
      <View style={styles.wrap}>{['fit','fill','stretch'].map(value => choice(value,resizeMode===value,()=>setResizeMode(value)))}</View><ThemedText style={styles.note}>Fit adds space; fill crops edges; stretch changes proportions.</ThemedText>{resizeMode === 'fit' && <><ThemedText>Background color</ThemedText><ColorSwatches value={background} disabled={busy} onChange={value => edit(() => setBackground(value ?? 0xffffff))} /></>}{batch && <ThemedText style={styles.note}>Percentage applies to each image separately. The dimensions above are for the first image.</ThemedText>}
    </>}
    {compressing && <>{input('Target size in KB (optional)',target,value=>edit(()=>setTarget(value)))}<ThemedText style={styles.note}>Target compression lowers quality, then dimensions if needed.</ThemedText></>}
    {tool === 'exposure' && slider('Exposure',exposure,-3,3,setExposure,`${exposure.toFixed(1)} EV`)}
    {tool === 'sharpen' && slider('Sharpness',sharpen,0,2,setSharpen,sharpen.toFixed(1))}
    {tool === 'blur' && <>{slider('Blur',blur,0,.035,setBlur,`${Math.round(blur*1000)}`)}<View style={styles.wrap}>{choice('Whole image',!blurArea,()=>{setBlurArea(false);setSelectingArea(false);})}{choice(area?'Reselect area':'Select area',blurArea,()=>{setBlurArea(true);setSelectingArea(true);setSettings(false);setCompare(false);})}</View>{blurArea && <ThemedText style={styles.note}>Drag a rectangle in the preview to choose the area.</ThemedText>}</>}
    {tool === 'canvas' && <>{slider('Border width',padding,0,.3,setPadding,`${Math.round(padding*100)}%`)}<ThemedText>Border color</ThemedText><ColorSwatches value={background} onChange={value=>edit(()=>setBackground(value??0xffffff))} disabled={busy} /></>}
    {tool === 'perspective' && <><ThemedText style={styles.note}>Move the four source corners using percentages. The selected area becomes a rectangle.</ThemedText>{['Top left','Top right','Bottom right','Bottom left'].map((label,index)=><View key={label}><ThemedText>{label}</ThemedText><View style={styles.row}><View style={styles.grow}>{input('X %',corners[index*2],value=>edit(()=>setCorners(current=>current.map((item,i)=>i===index*2?value:item))))}</View><View style={styles.grow}>{input('Y %',corners[index*2+1],value=>edit(()=>setCorners(current=>current.map((item,i)=>i===index*2+1?value:item))))}</View></View></View>)}</>}
    {tool === 'watermark' && <>{input('Watermark text',watermark,value=>edit(()=>setWatermark(value)),false)}<ToolButton title={logo ? 'Change watermark image' : 'Choose watermark image'} secondary disabled={busy} onPress={()=>void chooseImages(true)} />{logo && <ToolButton title="Use text instead" secondary disabled={busy||picking} onPress={()=>void removeLogo()} />}{slider('Opacity',opacity,.05,1,setOpacity,`${Math.round(opacity*100)}%`)}{slider(logo?'Image size':'Text size',markSize,.01,.2,setMarkSize,`${Math.round(markSize*100)}%`)}{slider('Horizontal position',x,0,1,setX,`${Math.round(x*100)}%`)}{slider('Vertical position',y,0,1,setY,`${Math.round(y*100)}%`)}<ColorSwatches value={ink} onChange={value=>edit(()=>setInk(value??0))} disabled={busy} /></>}
    {drawing && tool !== 'redact' && <><View style={styles.wrap}>{choice('Select & resize',selecting,()=>setSelecting(value=>!value))}{choice('Pen',shape==='pen',()=>{setShape('pen');setSelecting(false);})}{choice('Shapes',shape!=='pen',()=>setShape('rectangle'))}</View>{shape==='pen' && <BrushControls brush={brushType} pattern={pattern} disabled={busy} onBrush={(value,width)=>{setBrushType(value);setInkWidth(width);}} onPattern={setPattern} />}{shape!=='pen' && <ShapePicker value={shape} disabled={busy} onChange={value=>edit(()=>setShape(value))} />}<ColorSwatches value={ink} disabled={busy} onChange={value=>edit(()=>setInk(value??0))} />{shape!=='pen' && <><ThemedText>Fill</ThemedText><ColorSwatches value={fill} original={{label:'None',value:null}} disabled={busy} onChange={value=>edit(()=>setFill(value))} /></>}{slider('Thickness',inkWidth,.002,.05,setInkWidth,`${Math.round(inkWidth*1000)}`)}</>}
    {tool === 'metadata' && <ThemedText>Creates a new raster image without source EXIF, GPS or camera tags. Visible information stays in the image.</ThemedText>}
    {tool === 'rename' && <ThemedText>Save an identical copy with a new name. The original stays unchanged.</ThemedText>}
    {tool !== 'rename' && <><ThemedText style={styles.label}>Output format</ThemedText><View style={styles.wrap}>{info?.formats.map(value=>choice(value.toUpperCase(),format===value,()=>setFormat(value)))}</View><ThemedText style={styles.note}>Available formats use the native encoders on your device.</ThemedText>{!['png','tiff'].includes(format) && slider('Quality',quality,10,100,value=>setQuality(Math.round(value)),`${quality}%`)}</>}
  </View>;
  async function applyToWorkspace() {
    if (!file || !info || locked.current) throw new Error('Wait for the image to finish loading.');
    if (batch && extra.length) throw new Error('Export this batch before switching tools.');
    if (tool === 'info' || tool === 'rename') return;
    if (tool === 'watermark' && !watermark.trim() && !logo) throw new Error('Enter a watermark or choose an image first.');
    const options = parameters();
    locked.current = true; setBusy(true);
    try {
      jobs.current.forEach((_, job) => FileEngine?.cancelImageJob(job));
      await Promise.allSettled([...jobs.current.values()]);
      // Preserve requested compression/conversion; other intermediate operations stay lossless.
      const outputOptions = compressing || tool === 'convert' ? options : { ...options, targetBytes: 0, format: 'png', quality: 100 };
      const result = await workspace.render(outputUri => run({ ...outputOptions, action: 'export', uri: file.uri, outputUri }), String(outputOptions.format)) as unknown as Output;
      workspace.accept(result, file);
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const cancel = () => { cancelled.current = true; jobs.current.forEach((_,job)=>FileEngine?.cancelImageJob(job)); };
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.screen,{backgroundColor:colors.systemBackground}]}>
    <Stack.Screen options={{ gestureEnabled: false }} /><ScreenHeader title={title} onBack={close}><ImageWorkspaceTools id={id} current={tool} disabled={busy || picking || !file || !info || !!results.length} onApply={applyToWorkspace} /></ScreenHeader>
    {!available ? <View style={styles.empty}><ThemedText>Install a new development build to use these native image tools.</ThemedText></View> : !file || !info ? <View style={styles.empty}>{error ? <><ThemedText accessibilityRole="alert">{error}</ThemedText><ToolButton title="Try again" secondary onPress={()=>{initialized.current=false;setError('');setRetry(value=>value+1);}} /></> : <AppLoader />}</View> : results.length ? <ScrollView contentContainerStyle={styles.panel}><ThemedText style={styles.heading}>{busy ? progress : `${results.length} image${results.length===1?'':'s'} saved`}</ThemedText>{results.map(result=><View key={result.uri} style={[styles.result,{backgroundColor:colors.catalogSurface}]}><ThemedText>{result.name}</ThemedText><ThemedText>{result.width} x {result.height} - {formatSize(result.size)}</ThemedText><ToolButton title="Open image" disabled={busy} onPress={()=>void rememberFile(result,'image').then(value=>router.replace({pathname:'/file-preview',params:{id:value.id}}))} /><ToolButton title="Save to device" secondary disabled={busy} onPress={()=>void saveToDevice(result.uri,result.name,result.mimeType).then(async device=>{await recordEditedFile({...result,kind:'image',deviceUri:device.uri,location:device.location});showDialog('Saved',device.location);}).catch(cause=>setError((cause as Error).message))} /><ToolButton title="Share" secondary disabled={busy} onPress={()=>void shareFile(result).catch(cause=>setError((cause as Error).message))} /></View>)}{!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}{busy ? <ToolButton title="Cancel remaining images" secondary onPress={cancel} /> : <ToolButton title="Return to tool" secondary onPress={()=>setResults([])} />}</ScrollView> : tool === 'info' ? <ScrollView contentContainerStyle={styles.panel}>{Object.entries({Name:file.name,Dimensions:`${info.width} x ${info.height} px`,Size:formatSize(info.size),Format:info.mimeType,Camera:info.camera||'Not recorded',Taken:info.taken||'Not recorded',Location:info.hasLocation?'GPS metadata present':'Not recorded'}).map(([key,value])=><View key={key} style={styles.field}><ThemedText style={styles.label}>{key}</ThemedText><ThemedText selectable>{value}</ThemedText></View>)}</ScrollView> : <>
      <View style={styles.previewHeader}><ThemedText numberOfLines={1} style={[styles.grow,styles.note]}>{info.width} x {info.height} - {formatSize(info.size)}</ThemedText>{!drawing && tool !== 'rename' && <Pressable accessibilityRole="button" accessibilityLabel={compare?'Show changes':'Compare original'} onPress={()=>setCompare(value=>!value)} style={styles.chip}><ThemedText>{compare?'Show changes':'Original'}</ThemedText></Pressable>}<Pressable accessibilityRole="button" accessibilityLabel="Image options" accessibilityState={{expanded:settings}} onPress={()=>{Keyboard.dismiss();setSettings(value=>!value);}} style={styles.chip}><UniversalIcon ios="slider.horizontal.3" android="tune" size={22} color={tint.ink} /></Pressable></View>
      {(drawing || selectingArea) && preview && PdfMarkupView ? <PdfPreviewStage hint={selectingArea?'Drag a rectangle around the area to blur.':tool==='redact'?'Drag a solid cover over private information.':'Draw with one finger. Zoom and pan with two.'} onFit={()=>setFit(value=>value+1)}>{active && <PdfMarkupView key={fit} style={styles.grow} source={preview.uri} marks={JSON.stringify((selectingArea ? (area ? [area] : []) : marks).map(mark=>({...mark,kind:mark.kind==='redact'?'polygon':mark.kind})))} brush={brushType} pattern={pattern} mode={selecting ? 'select' : selectingArea||tool==='redact'||shape!=='pen'?(shape==='line'?'line':'polygon'):'draw'} shapePath={JSON.stringify(SHAPES.find(item=>item.id===(selectingArea||tool==='redact'?'rectangle':shape))?.points??[])} fillColor={selectingArea?'':tool==='redact'?'#000000':fill===null?'':hexColor(fill)} inkColor={tool==='redact'?'#000000':hexColor(ink)} inkWidth={inkWidth} disabled={busy||(!selecting&&marks.length>=300)} onMark={({nativeEvent})=>{try {const mark=JSON.parse(nativeEvent.mark) as PdfMark;if(selectingArea){edit(()=>{setArea(mark);setSelectingArea(false);});return;}if(marks.filter(item=>item.id!==mark.id).reduce((total,item)=>total+item.points.length,0)+mark.points.length>20000) throw new Error('Save before adding more strokes.');edit(()=>{history.commit({...mark,page:1,kind:tool==='redact'?'redact':mark.kind});});} catch(cause){setError((cause as Error).message);}}} />}</PdfPreviewStage> : preview ? <PdfPagePreview image={preview} active={active} preserveViewport hint={previewBusy?'Updating preview...':compare||issue?'Original image preview':'Preview - pinch to zoom, drag to move.'} /> : <View style={styles.empty}>{previewBusy ? <AppLoader /> : <ThemedText>{tool==='rename'?'Choose Save copy to enter a new name.':'Preparing image preview...'}</ThemedText>}</View>}
      {!!(issue||error) && <View style={styles.error}><ThemedText accessibilityRole="alert">{issue||error}</ThemedText>{!issue && <ToolButton title="Retry preview" secondary disabled={busy} onPress={()=>setRetry(value=>value+1)} />}</View>}
      {settings && <ScrollView style={styles.dock} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>{panel}</ScrollView>}
      <PdfPreviewFooter>{busy ? <View style={styles.row}><AppLoader /><ThemedText style={styles.grow}>{progress}</ThemedText><ToolButton title="Cancel" secondary onPress={cancel} /></View> : <>{tool !== 'rename' && <ThemedText style={styles.note}>Large images are limited to 3-6 MP to fit device memory. Check the saved dimensions.</ThemedText>}<View style={styles.row}>{drawing && <><ToolButton title="Undo" secondary disabled={!history.canUndo} onPress={()=>edit(()=>{history.undo();})} /><ToolButton title="Redo" secondary disabled={!history.canRedo} onPress={()=>edit(()=>{history.redo();})} /></>}<View style={styles.grow}><ToolButton title={batch?`Save ${1+extra.length} images`:'Save copy'} disabled={picking||!!issue||((drawing||blurArea)&&!PdfMarkupView)} onPress={()=>void save()} /></View></View></>}</PdfPreviewFooter>
    </>}
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({screen:{flex:1},grow:{flex:1,minWidth:0},row:{flexDirection:'row',alignItems:'center',gap:8},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},previewHeader:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,gap:8},panel:{padding:16,gap:14},field:{gap:6},label:{fontSize:14,fontWeight:'600'},heading:{fontSize:22,fontWeight:'600'},input:{minHeight:44,borderRadius:12,paddingHorizontal:12,fontSize:16},chip:{minHeight:44,borderRadius:12,paddingHorizontal:12,borderWidth:1,alignItems:'center',justifyContent:'center'},note:{fontSize:12,lineHeight:17},dock:{maxHeight:'38%',flexGrow:0},empty:{flex:1,justifyContent:'center',alignItems:'center',padding:24,gap:12},error:{padding:8,gap:6},result:{padding:16,gap:10,borderRadius:16}});

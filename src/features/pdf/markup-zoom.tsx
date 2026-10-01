import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import PdfEngine from '../../../modules/pdf-engine/src/PdfEngineModule';

const MAX_ZOOM = 6;
const STEP = 1.5;
const SIZE_STEP = 1.2;
const MIN_MARK = 0.01;
export const markupZoomAvailable = (PdfEngine?.nativeMarkupZoomVersion ?? 0) >= 1;

/** Drives the markup view's zoom buttons. A new `resetKey` (a remounted view) starts again at 1x. */
export function useMarkupZoom(resetKey: string) {
  const [state, setState] = useState({ key: resetKey, serial: 0, factor: 1, zoom: 1 });
  const current = state.key === resetKey ? state : { key: resetKey, serial: state.serial, factor: 1, zoom: 1 };
  if (current !== state) setState(current);
  const zoomBy = useCallback((factor: number) => setState(value => ({ ...value, serial: value.serial + 1, factor })), []);
  const onZoom = useCallback((event: { nativeEvent: { zoom: number } }) => {
    const zoom = event.nativeEvent.zoom;
    if (Number.isFinite(zoom)) setState(value => ({ ...value, zoom }));
  }, []);
  return { request: `${current.serial}:${current.factor}`, zoom: current.zoom, zoomBy, onZoom };
}

function extent(points: [number, number][]) {
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const left = Math.min(...xs), top = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Whether the mark can still grow (`factor` > 1) or shrink on the 0-1 page. */
export function canResizeMark(points: [number, number][] | undefined, factor: number) {
  if (!points?.length) return false;
  const box = extent(points), size = Math.max(box.width, box.height);
  return factor > 1 ? box.width < 0.999 && box.height < 0.999 : size * factor >= MIN_MARK;
}

/** Scales a mark around its centre, capped to the page and shifted back inside it. */
export function resizeMarkPoints(points: [number, number][], factor: number): [number, number][] {
  const box = extent(points);
  const limit = Math.min(box.width > 0 ? 1 / box.width : Infinity, box.height > 0 ? 1 / box.height : Infinity);
  const scale = Math.min(factor, limit);
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  const width = box.width * scale, height = box.height * scale;
  const left = Math.min(Math.max(cx - width / 2, 0), 1 - width), top = Math.min(Math.max(cy - height / 2, 0), 1 - height);
  return points.map(([x, y]) => [
    Math.min(1, Math.max(0, box.width > 0 ? left + (x - box.left) * scale : x)),
    Math.min(1, Math.max(0, box.height > 0 ? top + (y - box.top) * scale : y)),
  ]);
}

type Icon = { ios: 'plus.magnifyingglass' | 'minus.magnifyingglass' | 'plus' | 'minus'; android: 'zoom-in' | 'zoom-out' | 'add' | 'remove' };

/**
 * Floating controls at the bottom right of the page while selecting: Larger and Smaller for the selected
 * mark (small shapes are hard to pinch), and Zoom in and out of the page.
 */
export function MarkupZoomButtons({ zoom, onZoomBy, disabled, selection, onResize, showZoom = true }: {
  zoom: number; onZoomBy: (factor: number) => void; disabled?: boolean; showZoom?: boolean;
  selection?: [number, number][]; onResize?: (points: [number, number][]) => void;
}) {
  const colors = usePalette();
  const button = (label: string, icon: Icon, off: boolean, onPress: () => void) =>
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off }} disabled={off} onPress={onPress} hitSlop={4}
      style={({ pressed }) => [styles.button, { backgroundColor: colors.systemBackground, borderColor: colors.separator, opacity: off ? 0.4 : pressed ? 0.6 : 1 }]}>
      <UniversalIcon {...icon} size={22} color={colors.systemBlue} />
    </Pressable>;
  const resize = (factor: number) => { if (selection && onResize && canResizeMark(selection, factor)) onResize(resizeMarkPoints(selection, factor)); };
  const sized = !!selection?.length && !!onResize;
  const zoomable = showZoom && markupZoomAvailable;
  if (!sized && !zoomable) return null;
  return <View pointerEvents="box-none" style={styles.stack}>
    {sized && <View style={styles.row}>
      {button('Make shape smaller', { ios: 'minus', android: 'remove' }, !!disabled || !canResizeMark(selection, 1 / SIZE_STEP), () => resize(1 / SIZE_STEP))}
      {button('Make shape larger', { ios: 'plus', android: 'add' }, !!disabled || !canResizeMark(selection, SIZE_STEP), () => resize(SIZE_STEP))}
    </View>}
    {zoomable && <View style={styles.row}>
      {button('Zoom out', { ios: 'minus.magnifyingglass', android: 'zoom-out' }, !!disabled || zoom <= 1.01, () => onZoomBy(1 / STEP))}
      {button('Zoom in', { ios: 'plus.magnifyingglass', android: 'zoom-in' }, !!disabled || zoom >= MAX_ZOOM - 0.01, () => onZoomBy(STEP))}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', right: 10, bottom: 10, gap: 8, alignItems: 'flex-end' },
  row: { flexDirection: 'row', gap: 8 },
  button: { width: 44, height: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
});

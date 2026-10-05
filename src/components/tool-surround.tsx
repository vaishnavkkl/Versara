import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable as ClosePressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ThemedText } from './themed-text';
import { HelpPressable as Pressable } from './help-pressable';
import { UniversalIcon } from '@/components/universal-icon';
import type { RailTool } from '@/components/tool-rail';
import { usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';

// Tiles carry a small two-line name under the icon.
const TILE_WIDTH = 62;
const TILE_HEIGHT = 58;
const ROW_PITCH = TILE_WIDTH + 4;
const COLUMN_PITCH = TILE_HEIGHT + 4;
const ROW_BAND = TILE_HEIGHT + 6;
const COLUMN_BAND = TILE_WIDTH + 4;
const MAX_BOTTOM_ROWS = 3;
const ROW_INSET = 4;
const COLUMN_INSET = 2;
const CLOSE_ROW = 52;
type Side = 'bottom' | 'right' | 'left' | 'top';
const FILL_ORDER: Side[] = ['bottom', 'right', 'left', 'top'];
const REVEAL_ORDER: Side[] = ['bottom', 'right', 'top', 'left'];
const REVEAL_EASE = Easing.bezierFn(0.23, 1, 0.32, 1);
const REVEAL_MS = 240;

function RevealBand({ side, progress, active, rows = 1, children }: { side: Side; progress: SharedValue<number>; active: boolean; rows?: number; children: ReactNode }) {
  const x = side === 'right' ? -28 : side === 'left' ? 28 : 0;
  const y = side === 'bottom' ? -28 : side === 'top' ? 28 : 0;
  const tilt = side === 'right' || side === 'bottom' ? -3 : 3;
  const delay = REVEAL_ORDER.indexOf(side) * 20;
  const style = useAnimatedStyle(() => {
    const local = Math.max(0, Math.min(1, (progress.get() * REVEAL_MS - delay) / 180));
    const value = REVEAL_EASE(local);
    return { opacity: value, transform: [{ translateX: x * (1 - value) }, { translateY: y * (1 - value) }, { rotate: `${tilt * (1 - value)}deg` }, { scale: 0.9 + value * 0.1 }] };
  });
  const horizontal = side === 'top' || side === 'bottom';
  return <Animated.View pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} style={[horizontal ? { height: ROW_BAND * rows } : styles.columnBand, style]}>{children}</Animated.View>;
}

/**
 * Spreads tools over the four sides in proportion to the room each side has, keeping neighbours together.
 * When one row per side cannot hold every tool, the bottom gains rows (up to MAX_BOTTOM_ROWS) and the preview shrinks.
 */
function distribute(tools: RailTool[], width: number, height: number) {
  // Top and bottom rows run the full width; side columns fill the height left between them.
  const row = Math.max(1, Math.floor((width - 2 * ROW_INSET + 4) / ROW_PITCH));
  const columnFor = (bottomRows: number) => Math.max(1, Math.floor((height - (1 + bottomRows) * ROW_BAND - 2 * COLUMN_INSET + 4) / COLUMN_PITCH));
  let bottomRows = 1;
  while (bottomRows < MAX_BOTTOM_ROWS && row * (1 + bottomRows) + 2 * columnFor(bottomRows) < tools.length) bottomRows++;
  const column = columnFor(bottomRows);
  const capacity: Record<Side, number> = { bottom: row * bottomRows, top: row, left: column, right: column };
  const counts: Record<Side, number> = { bottom: 0, top: 0, left: 0, right: 0 };
  for (let index = 0; index < tools.length; index++) {
    const side = FILL_ORDER.reduce((best, item) => counts[item] / capacity[item] < counts[best] / capacity[best] ? item : best);
    counts[side]++;
  }
  const groups = {} as Record<Side, RailTool[]>;
  let start = 0;
  for (const side of FILL_ORDER) { groups[side] = tools.slice(start, start + counts[side]); start += counts[side]; }
  const overflow = (side: Side) => counts[side] > capacity[side];
  return { groups, bottomRows, perRow: row, overflow };
}

/** Splits a band's tools evenly over as few rows as fit, so no row is left nearly empty. */
function rowsOf(items: RailTool[], perRow: number, maxRows: number) {
  const rows = Math.max(1, Math.min(maxRows, Math.ceil(items.length / perRow)));
  const base = Math.floor(items.length / rows), extra = items.length % rows;
  let start = 0;
  return Array.from({ length: rows }, (_, index) => { const size = base + (index < extra ? 1 : 0); const chunk = items.slice(start, start + size); start += size; return chunk; });
}

/**
 * Frames its child with named tools on every side. The child keeps its identity when toggled.
 * In `naming` mode a tap shows the tool's name instead of opening it.
 */
export function ToolSurround({ active, naming = false, tools, disabled = false, showClose = true, onAction, onClose, onHidden, children }: { active: boolean; naming?: boolean; tools: RailTool[]; disabled?: boolean; showClose?: boolean; onAction: (id: string) => void; onClose: () => void; onHidden: () => void; children: ReactNode }) {
  const colors = usePalette();
  const reducedMotion = useReducedMotion();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  const [retained, setRetained] = useState(active);
  if (active && !retained) setRetained(true);
  const presented = active || retained;
  const latest = useRef({ active, onHidden });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { latest.current = { active, onHidden }; });
  const finishExit = useCallback(() => {
    if (!mounted.current || latest.current.active) return;
    setRetained(false);
    latest.current.onHidden();
  }, []);
  const revealing = active && !!size;
  useEffect(() => {
    cancelAnimation(progress);
    let frame: number | undefined;
    if (revealing && reducedMotion) progress.set(1);
    else if (revealing) {
      // Commit the final native preview layout before starting the UI-thread wave.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => progress.set(withTiming(1, { duration: REVEAL_MS, easing: Easing.linear })));
      });
    } else if (retained) {
      if (reducedMotion) { progress.set(0); finishExit(); }
      else progress.set(withTiming(0, { duration: 120, easing: Easing.linear }, finished => {
        if (finished) scheduleOnRN(finishExit);
      }));
    } else progress.set(0);
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); cancelAnimation(progress); };
  }, [revealing, retained, reducedMotion, progress, finishExit]);
  const layout = presented && size ? distribute(tools, size.width, size.height - (showClose ? CLOSE_ROW : 0)) : null;
  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { width, height } = nativeEvent.layout;
    setSize(current => current && Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height });
  };
  const tile = (tool: RailTool) => {
    const tint = toolColors(tool.id, colors);
    const off = disabled && !naming;
    return <Pressable key={tool.id} helpMode={naming} helpText={tool.title} helpOnLongPress accessibilityRole="button" accessibilityLabel={tool.accessibilityLabel ?? tool.title} accessibilityHint={naming ? 'Shows the tool name' : 'Long press to see the tool name'} accessibilityState={{ disabled: off }} disabled={off}
        onPress={() => onAction(tool.id)} hitSlop={3}
        style={({ pressed }) => [styles.button, { backgroundColor: tint.surface, borderColor: `${tint.ink}33`, opacity: off ? 0.4 : pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
        <UniversalIcon ios={tool.ios} android={tool.android} size={24} color={tint.ink} />
        <ThemedText numberOfLines={2} maxFontSizeMultiplier={1.2} style={[styles.name, { color: tint.ink }]}>{tool.title}</ThemedText>
      </Pressable>;
  };
  // A strip that cannot fit its tools keeps its scrollbar visible and shows a chevron, so scrolling is discoverable.
  const strip = (key: string, items: RailTool[], horizontal: boolean, overflow: boolean) => <View key={key} style={horizontal ? styles.rowStrip : styles.columnStrip}>
    <ScrollView style={styles.fill} horizontal={horizontal} persistentScrollbar={overflow} showsHorizontalScrollIndicator={overflow} showsVerticalScrollIndicator={overflow}
      contentContainerStyle={horizontal ? [styles.rowContent, overflow && styles.rowScrolling] : styles.columnContent}>
      {items.map(tile)}
    </ScrollView>
    {overflow && <View pointerEvents="none" style={horizontal ? styles.moreRight : styles.moreBottom}>
      <UniversalIcon ios={horizontal ? 'chevron.right' : 'chevron.down'} android={horizontal ? 'chevron-right' : 'expand-more'} size={16} color={colors.secondaryLabel} />
    </View>}
  </View>;
  const band = (side: Side) => {
    const items = layout?.groups[side];
    if (!layout || !items?.length) return null;
    const horizontal = side === 'top' || side === 'bottom';
    const chunks = horizontal ? rowsOf(items, layout.perRow, side === 'bottom' ? layout.bottomRows : 1) : [items];
    return <RevealBand key={side} side={side} progress={progress} active={active} rows={chunks.length}>
      {chunks.map((chunk, index) => strip(`${side}-${index}`, chunk, horizontal, horizontal ? chunk.length > layout.perRow : layout.overflow(side)))}
    </RevealBand>;
  };
  return <View style={styles.root} onLayout={onLayout}>
    {presented && showClose && <View style={styles.closeRow}>
      <ToolSurroundCloseButton disabled={!active} onPress={onClose} />
    </View>}
    {band('top')}
    <View style={styles.middle}>
      {band('left')}
      <View style={[styles.center, presented && [styles.framed, { borderColor: colors.separator, backgroundColor: colors.systemBackground }]]}>{children}</View>
      {band('right')}
    </View>
    {band('bottom')}
  </View>;
}

/** Closing stays available in help mode instead of showing a tool-name bubble. */
export function ToolSurroundCloseButton({ onPress, disabled = false, compact = false }: { onPress: () => void; disabled?: boolean; compact?: boolean }) {
  const colors = usePalette();
  return <ClosePressable accessibilityRole="button" accessibilityLabel="Hide tools around the page" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [compact ? styles.compactClose : styles.closeButton, { backgroundColor: colors.accentSurface, borderColor: colors.borderHighlight, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
    <UniversalIcon ios="xmark.circle.fill" android="close" size={20} color={colors.systemBlue} />
    {!compact && <ThemedText style={{ color: colors.systemBlue, fontWeight: '600' }}>Hide tools</ThemedText>}
  </ClosePressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  closeRow: { alignItems: 'center', paddingVertical: 2 },
  closeButton: { minHeight: 48, paddingHorizontal: 16, borderWidth: 1, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactClose: { minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, minHeight: 0, flexDirection: 'row' },
  center: { flex: 1, minWidth: 0, minHeight: 0 },
  framed: { margin: 4, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  columnBand: { width: COLUMN_BAND, overflow: 'hidden' },
  // The "more" chevron takes its own space beside the scroll area, never over a tile.
  rowStrip: { height: ROW_BAND, flexDirection: 'row' },
  columnStrip: { flex: 1, minHeight: 0 },
  fill: { flex: 1, minWidth: 0, minHeight: 0 },
  moreRight: { width: 18, alignItems: 'center', justifyContent: 'center' },
  moreBottom: { height: 18, alignItems: 'center', justifyContent: 'center' },
  // Equal gaps keep full rows aligned; shorter rows (often the top one) sit centred.
  rowContent: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: ROW_INSET },
  rowScrolling: { justifyContent: 'flex-start' },
  columnContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-evenly', gap: 4, paddingVertical: 2 },
  button: { width: TILE_WIDTH, height: TILE_HEIGHT, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 3 },
  name: { fontSize: 8, lineHeight: 10, fontWeight: '600', textAlign: 'center' },
});

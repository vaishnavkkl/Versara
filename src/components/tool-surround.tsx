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

const BUTTON = 44;
const PITCH = BUTTON + 6;
const BAND = BUTTON + 10;
type Side = 'bottom' | 'right' | 'left' | 'top';
const FILL_ORDER: Side[] = ['bottom', 'right', 'left', 'top'];
const REVEAL_ORDER: Side[] = ['bottom', 'right', 'top', 'left'];
const REVEAL_EASE = Easing.bezierFn(0.23, 1, 0.32, 1);
const REVEAL_MS = 240;

function RevealBand({ side, progress, active, children }: { side: Side; progress: SharedValue<number>; active: boolean; children: ReactNode }) {
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
  return <Animated.View pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} style={[horizontal ? styles.rowBand : styles.columnBand, style]}>{children}</Animated.View>;
}

/** Spreads tools over the four sides in proportion to the room each side has, keeping neighbours together. */
function distribute(tools: RailTool[], width: number, height: number) {
  const row = Math.max(1, Math.floor((width - 2 * BAND) / PITCH));
  const column = Math.max(1, Math.floor((height - 2 * BAND) / PITCH));
  const capacity: Record<Side, number> = { bottom: row, top: row, left: column, right: column };
  const counts: Record<Side, number> = { bottom: 0, top: 0, left: 0, right: 0 };
  for (let index = 0; index < tools.length; index++) {
    const side = FILL_ORDER.reduce((best, item) => counts[item] / capacity[item] < counts[best] / capacity[best] ? item : best);
    counts[side]++;
  }
  const groups = {} as Record<Side, RailTool[]>;
  let start = 0;
  for (const side of FILL_ORDER) { groups[side] = tools.slice(start, start + counts[side]); start += counts[side]; }
  return groups;
}

/**
 * Frames its child with icon-only tools on every side. The child keeps its identity when toggled.
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
  const groups = presented && size ? distribute(tools, size.width, size.height) : null;
  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { width, height } = nativeEvent.layout;
    setSize(current => current && Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height });
  };
  const band = (side: Side) => {
    const items = groups?.[side];
    if (!items?.length) return null;
    const horizontal = side === 'top' || side === 'bottom';
    return <RevealBand key={side} side={side} progress={progress} active={active}>
      <ScrollView horizontal={horizontal} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={horizontal ? styles.rowContent : styles.columnContent}>
        {items.map(tool => {
          const tint = toolColors(tool.id, colors);
          const off = disabled && !naming;
          return <Pressable key={tool.id} helpMode={naming} helpText={tool.title} helpOnLongPress accessibilityRole="button" accessibilityLabel={tool.accessibilityLabel ?? tool.title} accessibilityHint={naming ? 'Shows the tool name' : 'Long press to see the tool name'} accessibilityState={{ disabled: off }} disabled={off}
              onPress={() => onAction(tool.id)} hitSlop={3}
              style={({ pressed }) => [styles.button, { backgroundColor: tint.surface, borderColor: `${tint.ink}33`, opacity: off ? 0.4 : pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
              <UniversalIcon ios={tool.ios} android={tool.android} size={22} color={tint.ink} />
            </Pressable>;
        })}
      </ScrollView>
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
  rowBand: { height: BAND },
  columnBand: { width: BAND },
  rowContent: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', gap: 6, paddingHorizontal: BAND },
  columnContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-evenly', gap: 6, paddingVertical: 2 },
  button: { width: BUTTON, height: BUTTON, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
});

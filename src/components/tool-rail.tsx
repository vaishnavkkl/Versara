import { memo, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Easing, ReduceMotion, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { ToolboxSheet } from './toolbox-sheet';
import type { Method } from '@/constants/pdf-methods';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';
import { toolChrome } from '@/theme/dashboard';
import { AppGlyph, BrandGlyph } from '@/components/app-glyph';

export type RailTool = Pick<Method, 'id' | 'title' | 'ios' | 'android'> & { category?: string; soon?: boolean; requiresBuild?: boolean; highlighted?: boolean; accessibilityLabel?: string };
type Props = {
  tools: RailTool[]; busyId?: string | null; disabled?: boolean; landscape?: boolean; onAction: (id: string) => void; quickIds?: string[]; side?: 'left' | 'right'; showToolbox?: boolean;
  /** Replaces the Tools button's sheet with another action. When set, Tools sits in the middle of the recent tools. */
  toolsButton?: { label: string; accessibilityLabel: string; selected?: boolean; onPress: () => void };
};

/** Groups tools by category for the toolbox sheet. */
export function railSections(tools: RailTool[]) {
  const groups = new Map<string, { title: string; data: { id: string; title: string; ios: RailTool['ios']; android: RailTool['android']; subtitle: string; unavailable: boolean }[] }>();
  for (const tool of tools) {
    const title = tool.soon ? tool.requiresBuild ? 'Needs an app rebuild' : 'Coming later' : tool.category ?? 'View & file';
    if (!groups.has(title)) groups.set(title, { title, data: [] });
    groups.get(title)!.data.push({ ...tool, subtitle: tool.soon ? tool.requiresBuild ? 'Needs an app rebuild' : 'Coming soon' : tool.accessibilityLabel ?? tool.title, unavailable: !!tool.soon });
  }
  return [...groups.values()];
}

function ToolCell({ tool, busyId, disabled, landscape, onAction }: {
  tool: RailTool; busyId?: string | null; disabled: boolean; landscape: boolean; onAction: (id: string) => void;
}) {
  const colors = usePalette();
  const off = !tool.highlighted && (disabled || !!tool.soon);
  const working = busyId === tool.id;
  return <Pressable accessibilityRole="button" accessibilityLabel={tool.soon ? `${tool.title}, coming soon` : tool.accessibilityLabel ?? tool.title}
    accessibilityState={{ disabled: off, busy: working }} disabled={off}
    onPress={() => onAction(tool.id)}
    style={({ pressed }) => [styles.slot, !landscape && styles.slotFlex, { opacity: tool.soon ? 0.45 : off ? 0.5 : pressed ? 0.6 : 1 }]}>
    <AppGlyph id={tool.id} ios={tool.ios} android={tool.android} size={48} loading={working} />
    <ThemedText numberOfLines={2} style={styles.label}>{tool.title}</ThemedText>
    {tool.soon && <ThemedText style={[styles.soon, { color: colors.secondaryLabel }]}>Soon</ThemedText>}
  </Pressable>;
}

/** Center Tools control: slightly larger tile; the mark stays fixed, then spins once quickly every five seconds. */
function CenterToolsButton({ label, accessibilityLabel, selected, disabled, landscape, onPress }: {
  label: string; accessibilityLabel: string; selected?: boolean; disabled: boolean; landscape: boolean; onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduced) { turn.set(0); return; }
    // Stay at rest for 5s, snap through one fast turn, then reset without a slow unwind.
    turn.set(withRepeat(withSequence(
      withDelay(5000, withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System })),
      withTiming(0, { duration: 0, reduceMotion: ReduceMotion.System }),
    ), -1, false));
    return () => cancelAnimation(turn);
  }, [reduced, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected: !!selected }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.slot, !landscape && styles.slotFlex, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
    <BrandGlyph art="tools" size={52} selected={!!selected} iconStyle={spin} />
    <ThemedText style={[styles.label, styles.toolsLabel]}>{label}</ThemedText>
  </Pressable>;
}

type Slot = { key: string; kind: 'tool'; tool: RailTool } | { key: string; kind: 'tools' };

/** Icon tools in a horizontal bar, or a side rail in landscape so the content keeps its height. */
export const ToolRail = memo(function ToolRail({ tools, busyId, disabled = false, landscape = false, onAction, quickIds, side = 'right', showToolbox = true, toolsButton }: Props) {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  // A scroller that cannot scroll still claims slightly moving touches on Android and cancels the tap,
  // so it only scrolls when the tools overflow.
  const [extent, setExtent] = useState({ frame: 0, content: 0 });
  const overflow = extent.content > extent.frame + 1;
  const quick = quickIds ? quickIds.flatMap(id => tools.find(tool => tool.id === id && !tool.soon) ?? []) : tools.filter(tool => !tool.soon).slice(0, 4);
  const sections = useMemo(() => railSections(tools), [tools]);
  // One flat row of equal-width slots keeps edge padding and inter-tool gaps identical.
  const slots = useMemo((): Slot[] => {
    const items = quick.map(tool => ({ key: tool.id, kind: 'tool' as const, tool }));
    if (!showToolbox) return items;
    const toolsSlot: Slot = { key: 'tools', kind: 'tools' };
    if (!toolsButton) return [...items, toolsSlot];
    const mid = Math.floor(items.length / 2);
    return [...items.slice(0, mid), toolsSlot, ...items.slice(mid)];
  }, [quick, showToolbox, toolsButton]);

  const renderSlot = (slot: Slot) => {
    if (slot.kind === 'tools') {
      if (toolsButton) {
        return <CenterToolsButton key={slot.key} label={toolsButton.label} accessibilityLabel={toolsButton.accessibilityLabel}
          selected={toolsButton.selected} disabled={disabled} landscape={landscape} onPress={toolsButton.onPress} />;
      }
      return <Pressable key={slot.key} accessibilityRole="button" accessibilityLabel="Open toolbox" accessibilityState={{ expanded: open }}
        disabled={disabled} onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.slot, !landscape && styles.slotFlex, { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 }]}>
        <BrandGlyph art="tools" size={48} /><ThemedText style={styles.label}>Tools</ThemedText>
      </Pressable>;
    }
    return <ToolCell key={slot.key} tool={slot.tool} busyId={busyId} disabled={disabled} landscape={landscape} onAction={onAction} />;
  };

  // Portrait dock stays in normal layout (not absolute) and pads only for the system nav / home indicator.
  return <><View style={[landscape ? [styles.rail, side === 'left' ? styles.leftRail : styles.rightRail] : styles.bar, { borderColor: colors.separator, backgroundColor: colors.systemBackground }]}>
    <View style={[landscape ? styles.column : [styles.row, { paddingBottom: toolChrome.paddingVertical + insets.bottom }]]}>
      {landscape ? <ScrollView scrollEnabled={overflow} showsVerticalScrollIndicator={false}
        onLayout={event => { const frame = event.nativeEvent.layout.height; setExtent(current => current.frame === frame ? current : { ...current, frame }); }}
        onContentSizeChange={(_w, height) => setExtent(current => current.content === height ? current : { ...current, content: height })}
        style={styles.quickScroll} contentContainerStyle={styles.quickColumn}>
        {slots.map(renderSlot)}
      </ScrollView> : <ScrollView horizontal scrollEnabled={overflow} showsHorizontalScrollIndicator={false}
        onLayout={event => { const frame = event.nativeEvent.layout.width; setExtent(current => current.frame === frame ? current : { ...current, frame }); }}
        onContentSizeChange={width => setExtent(current => current.content === width ? current : { ...current, content: width })}
        style={styles.track} contentContainerStyle={styles.trackContent}>
        {slots.map(renderSlot)}
      </ScrollView>}
    </View>
  </View>{showToolbox && !toolsButton && <ToolboxSheet visible={open} title="Toolbox" subtitle={tools.some(tool => tool.requiresBuild) ? 'Dimmed image tools need a new app build' : 'Find your next action'} sections={sections} footer={<View />} onClose={() => setOpen(false)} onAction={onAction} />}</>;
});

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, flexShrink: 0 },
  rail: { width: 76, minHeight: 0, flexShrink: 0 },
  leftRail: { borderRightWidth: StyleSheet.hairlineWidth },
  rightRail: { borderLeftWidth: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: toolChrome.paddingHorizontal, paddingTop: toolChrome.paddingVertical },
  column: { flex: 1, minHeight: 0, paddingVertical: toolChrome.paddingVertical, alignItems: 'center' },
  track: { width: '100%' },
  // Equal flex slots share the full width; gap is the only horizontal rhythm between tools.
  trackContent: { flexGrow: 1, flexDirection: 'row', alignItems: 'flex-start', gap: toolChrome.gap, minWidth: '100%' },
  quickScroll: { flex: 1, width: '100%', minHeight: 0 },
  quickColumn: { alignItems: 'center', gap: 6 },
  slot: { minWidth: 64, maxWidth: 80, minHeight: 72, alignItems: 'center', gap: 4 },
  slotFlex: { flex: 1 },
  toolsLabel: { fontWeight: '600' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center' },
  soon: { fontSize: 10, lineHeight: 12 },
});

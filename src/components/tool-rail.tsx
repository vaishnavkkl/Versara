import { memo, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Easing, ReduceMotion, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { ToolboxSheet } from './toolbox-sheet';
import type { Method } from '@/constants/pdf-methods';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';
import { AppGlyph, BrandGlyph } from '@/components/app-glyph';

export type RailTool = Pick<Method, 'id' | 'title' | 'ios' | 'android'> & { category?: string; soon?: boolean; requiresBuild?: boolean; highlighted?: boolean; accessibilityLabel?: string };
type Props = {
  tools: RailTool[]; busyId?: string | null; disabled?: boolean; landscape?: boolean; onAction: (id: string) => void; quickIds?: string[]; side?: 'left' | 'right'; showToolbox?: boolean;
  /** Replaces the Tools button's sheet with another action. When set, Tools sits centered and slightly larger. */
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
    style={({ pressed }) => [styles.tool, !landscape && { flex: 1 }, { opacity: tool.soon ? 0.45 : off ? 0.5 : pressed ? 0.6 : 1 }]}>
    <AppGlyph id={tool.id} ios={tool.ios} android={tool.android} size={48} loading={working} />
    <ThemedText numberOfLines={2} style={styles.label}>{tool.title}</ThemedText>
    {tool.soon && <ThemedText style={[styles.soon, { color: colors.secondaryLabel }]}>Soon</ThemedText>}
  </Pressable>;
}

/** Center Tools control: larger tile; the mark alone spins quickly every five seconds. */
function CenterToolsButton({ label, accessibilityLabel, selected, disabled, landscape, onPress }: {
  label: string; accessibilityLabel: string; selected?: boolean; disabled: boolean; landscape: boolean; onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduced) { turn.set(0); return; }
    // Hold still for 5s, then a fast full turn; 0° and 360° match so the loop has no jump.
    turn.set(withRepeat(withSequence(
      withTiming(0, { duration: 5000, reduceMotion: ReduceMotion.System }),
      withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }),
    ), -1, false));
    return () => cancelAnimation(turn);
  }, [reduced, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected: !!selected }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.tool, styles.toolsCenter, !landscape && { flex: 1.2 }, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
    <BrandGlyph art="tools" size={56} selected={!!selected} iconStyle={spin} />
    <ThemedText style={[styles.label, styles.toolsLabel]}>{label}</ThemedText>
  </Pressable>;
}

/** Icon tools in a horizontal bar, or a side rail in landscape so the content keeps its height. */
export const ToolRail = memo(function ToolRail({ tools, busyId, disabled = false, landscape = false, onAction, quickIds, side = 'right', showToolbox = true, toolsButton }: Props) {
  const colors = usePalette();
  const [open, setOpen] = useState(false);
  // A scroller that cannot scroll still claims slightly moving touches on Android and cancels the tap,
  // so it only scrolls when the tools overflow.
  const [extent, setExtent] = useState({ frame: 0, content: 0 });
  const overflow = extent.content > extent.frame + 1;
  const quick = quickIds ? quickIds.flatMap(id => tools.find(tool => tool.id === id && !tool.soon) ?? []) : tools.filter(tool => !tool.soon).slice(0, 4);
  const sections = useMemo(() => railSections(tools), [tools]);
  const centerTools = !!toolsButton && showToolbox;
  const split = centerTools ? Math.ceil(quick.length / 2) : quick.length;
  const left = quick.slice(0, split);
  const right = centerTools ? quick.slice(split) : [];

  const renderQuick = (items: RailTool[]) => items.map(tool => (
    <ToolCell key={tool.id} tool={tool} busyId={busyId} disabled={disabled} landscape={landscape} onAction={onAction} />
  ));

  const scroll = (items: RailTool[], flex = true) => (
    <ScrollView horizontal={!landscape} scrollEnabled={overflow} showsHorizontalScrollIndicator={false}
      onLayout={event => { const frame = landscape ? event.nativeEvent.layout.height : event.nativeEvent.layout.width; setExtent(current => current.frame === frame ? current : { ...current, frame }); }}
      onContentSizeChange={(width, height) => { const content = landscape ? height : width; setExtent(current => current.content === content ? current : { ...current, content }); }}
      style={landscape ? styles.quickScroll : [styles.quickRow, flex && { flex: items.length || 1 }]}
      contentContainerStyle={landscape ? styles.quickColumn : styles.quickRowContent}>
      {renderQuick(items)}
    </ScrollView>
  );

  return <><View style={[landscape ? [styles.rail, side === 'left' ? styles.leftRail : styles.rightRail] : styles.bar, { borderColor: colors.separator, backgroundColor: colors.systemBackground }]}>
    <View style={landscape ? styles.column : styles.row}>
      {centerTools ? <>
        {scroll(left)}
        <CenterToolsButton label={toolsButton!.label} accessibilityLabel={toolsButton!.accessibilityLabel} selected={toolsButton!.selected}
          disabled={disabled} landscape={landscape} onPress={toolsButton!.onPress} />
        {scroll(right)}
      </> : <>
        {scroll(quick)}
        {showToolbox && <Pressable accessibilityRole="button" accessibilityLabel={toolsButton?.accessibilityLabel ?? 'Open toolbox'} accessibilityState={toolsButton ? { selected: !!toolsButton.selected } : { expanded: open }} disabled={disabled} onPress={toolsButton?.onPress ?? (() => setOpen(true))} style={[styles.tool, !landscape && { flex: 1 }]}>
          <BrandGlyph art="tools" size={48} selected={!!toolsButton?.selected} /><ThemedText style={styles.label}>{toolsButton?.label ?? 'Tools'}</ThemedText>
        </Pressable>}
      </>}
    </View>
  </View>{showToolbox && !toolsButton && <ToolboxSheet visible={open} title="Toolbox" subtitle={tools.some(tool => tool.requiresBuild) ? 'Dimmed image tools need a new app build' : 'Find your next action'} sections={sections} footer={<View />} onClose={() => setOpen(false)} onAction={onAction} />}</>;
});

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  rail: { width: 76, minHeight: 0 },
  leftRail: { borderRightWidth: StyleSheet.hairlineWidth },
  rightRail: { borderLeftWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2, gap: 4 },
  column: { flex: 1, minHeight: 0, paddingVertical: 8, alignItems: 'center', gap: 6 },
  quickScroll: { flex: 1, width: '100%', minHeight: 0 },
  quickColumn: { alignItems: 'center', gap: 6 },
  quickRow: { flex: 4 },
  quickRowContent: { flexGrow: 1, flexDirection: 'row', gap: 4 },
  tool: { minWidth: 0, minHeight: 68, maxWidth: 76, alignItems: 'center', gap: 4 },
  toolsCenter: { maxWidth: 80, zIndex: 1 },
  toolsLabel: { fontWeight: '600' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center' },
  soon: { fontSize: 10, lineHeight: 12 },
});

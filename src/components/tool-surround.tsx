import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { UniversalIcon } from '@/components/universal-icon';
import { toast } from '@/components/toast';
import type { RailTool } from '@/components/tool-rail';
import { usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';

const BUTTON = 44;
const PITCH = BUTTON + 6;
const BAND = BUTTON + 10;
type Side = 'bottom' | 'right' | 'left' | 'top';
const FILL_ORDER: Side[] = ['bottom', 'right', 'left', 'top'];

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
export function ToolSurround({ active, naming = false, tools, disabled = false, onAction, children }: { active: boolean; naming?: boolean; tools: RailTool[]; disabled?: boolean; onAction: (id: string) => void; children: ReactNode }) {
  const colors = usePalette();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const groups = active && size ? distribute(tools, size.width, size.height) : null;
  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { width, height } = nativeEvent.layout;
    setSize(current => current && Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height });
  };
  const band = (side: Side) => {
    const items = groups?.[side];
    if (!items?.length) return null;
    const horizontal = side === 'top' || side === 'bottom';
    return <View key={side} style={horizontal ? styles.rowBand : styles.columnBand}>
      <ScrollView horizontal={horizontal} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={horizontal ? styles.rowContent : styles.columnContent}>
        {items.map(tool => {
          const tint = toolColors(tool.id, colors);
          const off = disabled && !naming;
          return <Pressable key={tool.id} accessibilityRole="button" accessibilityLabel={tool.accessibilityLabel ?? tool.title} accessibilityHint={naming ? 'Shows the tool name' : 'Long press to see the tool name'} accessibilityState={{ disabled: off }} disabled={off}
            onPress={() => naming ? toast(tool.title) : onAction(tool.id)} onLongPress={() => toast(tool.title)} hitSlop={3}
            style={({ pressed }) => [styles.button, naming && styles.naming, { backgroundColor: tint.surface, borderColor: naming ? colors.systemBlue : `${tint.ink}33`, opacity: off ? 0.4 : pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
            <UniversalIcon ios={tool.ios} android={tool.android} size={22} color={tint.ink} />
          </Pressable>;
        })}
      </ScrollView>
    </View>;
  };
  return <View style={styles.root} onLayout={onLayout}>
    {band('top')}
    <View style={styles.middle}>
      {band('left')}
      <View style={[styles.center, active && [styles.framed, { borderColor: colors.separator, backgroundColor: colors.systemBackground, shadowColor: colors.label }]]}>{children}</View>
      {band('right')}
    </View>
    {band('bottom')}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  middle: { flex: 1, minHeight: 0, flexDirection: 'row' },
  center: { flex: 1, minWidth: 0, minHeight: 0 },
  framed: { margin: 4, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', elevation: 4, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  rowBand: { height: BAND },
  columnBand: { width: BAND },
  rowContent: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', gap: 6, paddingHorizontal: BAND },
  columnContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-evenly', gap: 6, paddingVertical: 2 },
  button: { width: BUTTON, height: BUTTON, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  naming: { borderWidth: 1.5, borderStyle: 'dashed' },
});

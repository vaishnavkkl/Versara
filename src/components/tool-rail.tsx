import { memo, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { ToolboxSheet } from './toolbox-sheet';
import type { Method } from '@/constants/pdf-methods';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';

export type RailTool = Pick<Method, 'id' | 'title' | 'ios' | 'android'> & { category?: string; soon?: boolean; requiresBuild?: boolean; highlighted?: boolean; accessibilityLabel?: string };
type Props = {
  tools: RailTool[]; busyId?: string | null; disabled?: boolean; landscape?: boolean; onAction: (id: string) => void; quickIds?: string[]; side?: 'left' | 'right'; showToolbox?: boolean;
  /** Replaces the Tools button's sheet with another action. */
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

/** Icon tools in a horizontal bar, or a side rail in landscape so the content keeps its height. */
export const ToolRail = memo(function ToolRail({ tools, busyId, disabled = false, landscape = false, onAction, quickIds, side = 'right', showToolbox = true, toolsButton }: Props) {
  const colors = usePalette();
  const [open, setOpen] = useState(false);
  const quick = quickIds ? quickIds.flatMap(id => tools.find(tool => tool.id === id && !tool.soon) ?? []) : tools.filter(tool => !tool.soon).slice(0, 4);
  const sections = useMemo(() => railSections(tools), [tools]);

  return <><View style={[landscape ? [styles.rail, side === 'left' ? styles.leftRail : styles.rightRail] : styles.bar, { borderColor: colors.separator, backgroundColor: colors.systemBackground }]}>
    <View style={landscape ? styles.column : styles.row}>
      <ScrollView horizontal={!landscape} showsHorizontalScrollIndicator={false} style={landscape ? styles.quickScroll : styles.quickRow} contentContainerStyle={landscape ? styles.quickColumn : styles.quickRowContent}>
      {quick.map(tool => {
        const off = !tool.highlighted && (disabled || !!tool.soon);
        const working = busyId === tool.id;
        const tint = toolColors(tool.id, colors);
        return <Pressable key={tool.id} accessibilityRole="button" accessibilityLabel={tool.soon ? `${tool.title}, coming soon` : tool.accessibilityLabel ?? tool.title}
          accessibilityState={{ disabled: off, busy: working }} disabled={off}
          onPress={() => onAction(tool.id)}
          style={({ pressed }) => [styles.tool, !landscape && { flex: 1 }, { opacity: tool.soon ? 0.45 : off ? 0.5 : pressed ? 0.6 : 1 }]}>
          <View style={[styles.icon, { backgroundColor: tint.surface }]}>
            {working ? <AppLoader /> : <UniversalIcon ios={tool.ios} android={tool.android} size={22} color={tint.ink} />}
          </View>
          <ThemedText numberOfLines={2} style={styles.label}>{tool.title}</ThemedText>
          {tool.soon && <ThemedText style={[styles.soon, { color: colors.secondaryLabel }]}>Soon</ThemedText>}
        </Pressable>;
      })}
      </ScrollView>
      {showToolbox && <Pressable accessibilityRole="button" accessibilityLabel={toolsButton?.accessibilityLabel ?? 'Open toolbox'} accessibilityState={toolsButton ? { selected: !!toolsButton.selected } : { expanded: open }} disabled={disabled} onPress={toolsButton?.onPress ?? (() => setOpen(true))} style={[styles.tool, !landscape && { flex: 1 }]}>
        <View style={[styles.icon, { backgroundColor: colors.systemBlue }]}><UniversalIcon ios="square.grid.2x2" android="grid-view" size={22} color={colors.systemBackground} /></View><ThemedText style={styles.label}>{toolsButton?.label ?? 'Tools'}</ThemedText>
      </Pressable>}
    </View>
  </View>{showToolbox && !toolsButton && <ToolboxSheet visible={open} title="Toolbox" subtitle={tools.some(tool => tool.requiresBuild) ? 'Dimmed image tools need a new app build' : 'Find your next action'} sections={sections} footer={<View />} onClose={() => setOpen(false)} onAction={onAction} />}</>;
});

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  rail: { width: 76, minHeight: 0 },
  leftRail: { borderRightWidth: StyleSheet.hairlineWidth },
  rightRail: { borderLeftWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 8, paddingVertical: 10, gap: 4 },
  column: { flex: 1, minHeight: 0, paddingVertical: 8, alignItems: 'center', gap: 6 },
  quickScroll: { flex: 1, width: '100%', minHeight: 0 },
  quickColumn: { alignItems: 'center', gap: 6 },
  quickRow: { flex: 4 },
  quickRowContent: { flexGrow: 1, flexDirection: 'row', gap: 4 },
  tool: { minWidth: 0, minHeight: 70, maxWidth: 76, alignItems: 'center', gap: 4 },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center' },
  soon: { fontSize: 10, lineHeight: 12 },
});

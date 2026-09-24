import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Method } from '@/constants/pdf-methods';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';

export type RailTool = Pick<Method, 'id' | 'title' | 'ios' | 'android'> & { soon?: boolean; highlighted?: boolean; accessibilityLabel?: string };
type Props = { tools: RailTool[]; busyId?: string | null; disabled?: boolean; landscape?: boolean; onAction: (id: string) => void };

/** Icon tools in a horizontal bar, or a side rail in landscape so the content keeps its height. */
export const ToolRail = memo(function ToolRail({ tools, busyId, disabled = false, landscape = false, onAction }: Props) {
  const colors = usePalette();
  return <View style={[landscape ? styles.rail : styles.bar, { borderColor: colors.separator, backgroundColor: colors.systemBackground }]}>
    <ScrollView horizontal={!landscape} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={landscape ? styles.column : styles.row}>
      {tools.map(tool => {
        const off = !tool.highlighted && (disabled || !!tool.soon);
        const working = busyId === tool.id;
        return <Pressable key={tool.id} accessibilityRole="button" accessibilityLabel={tool.soon ? `${tool.title}, coming soon` : tool.accessibilityLabel ?? tool.title}
          accessibilityState={{ disabled: off, busy: working }} disabled={off}
          onPress={() => onAction(tool.id)}
          style={({ pressed }) => [styles.tool, { opacity: tool.soon ? 0.45 : off ? 0.5 : pressed ? 0.6 : 1 }]}>
          <View style={[styles.icon, { backgroundColor: tool.highlighted ? colors.systemBlue : colors.accentSurface }]}>
            {working ? <AppLoader /> : <UniversalIcon ios={tool.ios} android={tool.android} size={22} color={tool.highlighted ? colors.systemBackground : colors.systemBlue} />}
          </View>
          <ThemedText numberOfLines={1} style={styles.label}>{tool.title}</ThemedText>
          {tool.soon && <ThemedText style={[styles.soon, { color: colors.secondaryLabel }]}>Soon</ThemedText>}
        </Pressable>;
      })}
    </ScrollView>
  </View>;
});

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  rail: { width: 92, borderLeftWidth: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: 8, paddingVertical: 10, gap: 4 },
  column: { paddingVertical: 8, alignItems: 'center', gap: 6 },
  tool: { width: 76, minHeight: 76, alignItems: 'center', gap: 4 },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center' },
  soon: { fontSize: 10, lineHeight: 12 },
});

import { useMemo, type ReactElement } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import type { Method } from '@/constants/pdf-methods';
import { usePalette } from '@/theme/colors';
import { getGradients, typography } from '@/theme/dashboard';

type Action = Method & { unavailable?: boolean };
export type ToolSection = { title: string; data: Action[] };

export function ToolGrid({ sections, onAction, footer }: { sections: ToolSection[]; onAction: (id: string) => void; footer: ReactElement }) {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const rows = useMemo(() => sections.map(section => ({ title: section.title,
    data: section.data.reduce<Action[][]>((result, item, index) => {
      if (index % 3 === 0) result.push([]);
      result[result.length - 1].push(item);
      return result;
    }, []),
  })), [sections]);
  return <SectionList<Action[]> sections={rows} keyExtractor={row => row.map(item => item.id).join('|')} style={[styles.list, { backgroundColor: colors.systemBackground }]}
    stickySectionHeadersEnabled={false} initialNumToRender={6} maxToRenderPerBatch={4} windowSize={3}
    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(16, insets.bottom), backgroundColor: colors.systemBackground }}
    renderSectionHeader={({ section }) => <ThemedText accessibilityRole="header" style={[styles.section, { color: colors.secondaryLabel }]}>{section.title}</ThemedText>}
    renderItem={({ item: row }) => <View style={styles.row}>{row.map(item => <Pressable key={item.id}
      accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.unavailable ? 'Coming later' : item.subtitle}`}
      accessibilityState={{ disabled: !!item.unavailable }} disabled={item.unavailable} onPress={() => onAction(item.id)}
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator, opacity: item.unavailable ? 0.55 : pressed ? 0.7 : 1 }]}>
      <View style={[styles.icon, getGradients(colors).module]}><UniversalIcon ios={item.ios} android={item.android} size={20} color={colors.moduleText} /></View>
      <ThemedText style={styles.label}>{item.title}</ThemedText>
      <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{item.unavailable ? 'Coming later' : item.subtitle}</ThemedText>
    </Pressable>)}{Array.from({ length: 3 - row.length }, (_, i) => <View key={i} style={styles.spacer} />)}</View>}
    ListFooterComponent={footer} />;
}
const styles = StyleSheet.create({
  list: { flex: 1 },
  section: { ...typography.caption, fontWeight: '700', paddingTop: 20, paddingBottom: 8 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tile: { flex: 1, minWidth: 0, minHeight: 104, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 4 },
  spacer: { flex: 1 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.label }, caption: { ...typography.caption },
});

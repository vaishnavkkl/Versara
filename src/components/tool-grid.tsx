import { useMemo, type ReactElement } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './themed-text';
import { ModuleCard } from './module-card';
import type { Method } from '@/constants/pdf-methods';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t, type ModuleTone } from '@/theme/dashboard';

type Action = Method & { unavailable?: boolean };
export type ToolSection = { title: string; data: Action[] };

type Props = { sections: ToolSection[]; onAction: (id: string) => void; footer: ReactElement; grid?: boolean; tone?: ModuleTone };
export function ToolGrid({ sections, onAction, footer, grid = true, tone = 'default' }: Props) {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const columns = grid ? 2 : 1;
  const rows = useMemo(() => sections.map(section => ({ title: section.title,
    data: section.data.reduce<Action[][]>((result, item, index) => {
      if (index % columns === 0) result.push([]);
      result[result.length - 1].push(item);
      return result;
    }, []),
  })), [sections, columns]);
  return <SectionList<Action[]> sections={rows} keyExtractor={row => row.map(item => item.id).join('|')} style={styles.list}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" stickySectionHeadersEnabled={false} initialNumToRender={6} maxToRenderPerBatch={4} windowSize={3}
    contentContainerStyle={{ paddingHorizontal: s.xl, paddingBottom: Math.max(s.xxl, insets.bottom) }}
    renderSectionHeader={({ section }) => <ThemedText accessibilityRole="header" style={[styles.section, { color: colors.secondaryLabel }]}>{section.title}</ThemedText>}
    renderItem={({ item: row }) => <View style={styles.row}>
      {row.map(item => <ModuleCard key={item.id} title={item.title} description={item.subtitle} ios={item.ios} android={item.android}
        variant={grid ? 'tool' : 'list'} tone={tone} disabled={item.unavailable} detail={item.unavailable ? 'Coming later' : undefined} onPress={() => onAction(item.id)} />)}
      {row.length < columns && <View style={styles.spacer} />}
    </View>}
    ListFooterComponent={footer} />;
}
const styles = StyleSheet.create({
  list: { flex: 1 },
  section: { ...t.label, paddingTop: s.md, paddingBottom: s.md },
  row: { flexDirection: 'row', gap: s.md, marginBottom: s.md },
  spacer: { flex: 1 },
});

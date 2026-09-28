import { useStableCallback } from '@/hooks/use-stable-callback';
import { memo, useCallback, useMemo, type ReactElement } from 'react';
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
  const selectAction = useStableCallback(onAction);
  const renderRow = useCallback(({ item: row }: { item: Action[] }) => <View style={styles.row}>
    {row.map(item => <ToolCard key={item.id} {...item} grid={grid} tone={tone} onAction={selectAction} />)}
    {row.length < columns && <View style={styles.spacer} />}
  </View>, [columns, grid, tone, selectAction]);
  return <SectionList<Action[]> sections={rows} keyExtractor={row => row.map(item => item.id).join('|')} style={styles.list}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" stickySectionHeadersEnabled={false} initialNumToRender={6} maxToRenderPerBatch={4} windowSize={3}
    contentContainerStyle={{ paddingHorizontal: s.xl, paddingBottom: Math.max(s.xxl, insets.bottom) }}
    renderSectionHeader={({ section }) => <ThemedText accessibilityRole="header" style={[styles.section, { color: colors.secondaryLabel }]}>{section.title}</ThemedText>}
    renderItem={renderRow}
    ListFooterComponent={footer} />;
}
const ToolCard = memo(function ToolCard({ id, title, subtitle, ios, android, unavailable, grid, tone, onAction }: Action & {
  grid: boolean; tone: ModuleTone; onAction: (id: string) => void;
}) {
  const onPress = useCallback(() => onAction(id), [id, onAction]);
  return <ModuleCard title={title} description={subtitle} ios={ios} android={android}
    variant={grid ? 'tool' : 'list'} tone={tone} disabled={unavailable} detail={unavailable ? 'Coming later' : undefined} onPress={onPress} />;
});

const styles = StyleSheet.create({
  list: { flex: 1 },
  section: { ...t.label, paddingTop: s.md, paddingBottom: s.md },
  row: { flexDirection: 'row', gap: s.md, marginBottom: s.md },
  spacer: { flex: 1 },
});

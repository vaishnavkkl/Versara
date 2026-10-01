import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Keyboard, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BottomSheetFlatList, BottomSheetTextInput, type BottomSheetFlatListMethods } from '@gorhom/bottom-sheet';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import type { ToolSection } from './tool-grid';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';

export type ToolboxProps = {
  visible: boolean; title: string; subtitle: string; caption?: string; sections: ToolSection[]; footer: ReactElement;
  onClose: () => void;
  /** Runs after the native sheet finishes closing. */
  onAction: (id: string) => void;
};
type Tool = ToolSection['data'][number];
type Row = { key: string; height: number; offset: number } & (
  { kind: 'heading'; title: string; count: number } | { kind: 'tools'; tools: Tool[] }
);
type ContentProps = Omit<ToolboxProps, 'visible' | 'onAction'> & { onSelect: (id: string) => void };
const keyExtractor = (row: Row) => row.key;
const getItemLayout = (data: ArrayLike<Row> | null | undefined, index: number) => ({ length: data?.[index]?.height ?? 0, offset: data?.[index]?.offset ?? 0, index });

/** The sole scroll owner inside a bounded native sheet. Never measure the whole catalog. */
export function ToolboxContent({ title, subtitle, sections, footer, onClose, onSelect }: ContentProps) {
  const colors = usePalette();
  const { fontScale } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const list = useRef<BottomSheetFlatListMethods>(null);
  const select = useStableCallback((id: string) => { Keyboard.dismiss(); onSelect(id); });
  const rowHeight = Math.max(96, Math.ceil(58 + 34 * fontScale)) + s.sm;
  const headingHeight = Math.ceil(18 * fontScale + s.xl);
  const total = sections.reduce((count, section) => count + section.data.length, 0);
  const rows = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const result: Row[] = [];
    let offset = 0;
    for (const section of sections) {
      const tools = section.data.filter(tool => terms.every(term => `${tool.title} ${tool.subtitle} ${section.title}`.toLowerCase().includes(term)));
      if (!tools.length) continue;
      result.push({ key: `heading:${section.title}`, kind: 'heading', title: section.title, count: tools.length, height: headingHeight, offset });
      offset += headingHeight;
      for (let index = 0; index < tools.length; index += 3) {
        result.push({ key: `${section.title}:${tools[index].id}`, kind: 'tools', tools: tools.slice(index, index + 3), height: rowHeight, offset });
        offset += rowHeight;
      }
    }
    return result;
  }, [sections, query, rowHeight, headingHeight]);
  useEffect(() => { list.current?.scrollToOffset({ offset: 0, animated: false }); }, [query]);
  const renderItem = useCallback(({ item }: { item: Row }) => item.kind === 'heading'
    ? <View style={[styles.section, { height: item.height }]}><ThemedText accessibilityRole="header" numberOfLines={1} style={[styles.sectionTitle, { color: colors.secondaryLabel }]}>{item.title}</ThemedText><ThemedText style={[styles.count, { color: colors.secondaryLabel }]}>{item.count}</ThemedText></View>
    : <View style={[styles.row, { height: item.height }]}>
      {item.tools.map(tool => <ToolTile key={tool.id} {...tool} onSelect={select} />)}
      {Array.from({ length: 3 - item.tools.length }, (_, index) => <View key={`space:${index}`} style={styles.cell} />)}
    </View>, [colors.secondaryLabel, select]);
  return <View style={[styles.sheet, { backgroundColor: colors.sheetBackground }]}>
    <View style={styles.header}>
      <View style={styles.grow}><ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText><ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>{subtitle}</ThemedText></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={() => { Keyboard.dismiss(); onClose(); }} style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.fieldSurface, opacity: pressed ? .65 : 1 }]}><UniversalIcon ios="xmark" android="close" size={20} color={colors.label} /></Pressable>
    </View>
    {total > 9 && <View style={[styles.search, { backgroundColor: colors.fieldSurface, borderColor: colors.separator }]}>
      <UniversalIcon ios="magnifyingglass" android="search" size={19} color={colors.secondaryLabel} />
      <BottomSheetTextInput accessibilityLabel="Search toolbox" placeholder="Find a tool" placeholderTextColor={colors.secondaryLabel} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={Keyboard.dismiss} style={[styles.input, { color: colors.label }]} />
      {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={styles.iconButton}><UniversalIcon ios="xmark.circle.fill" android="cancel" size={18} color={colors.secondaryLabel} /></Pressable>}
    </View>}
    <BottomSheetFlatList ref={list} data={rows} renderItem={renderItem} keyExtractor={keyExtractor} getItemLayout={getItemLayout}
      style={styles.catalog} contentContainerStyle={styles.catalogContent} initialNumToRender={5} maxToRenderPerBatch={2} windowSize={3}
      nestedScrollEnabled keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator indicatorStyle={colors.systemBackground === '#000000' ? 'white' : 'black'}
      ListEmptyComponent={<View style={styles.empty}><UniversalIcon ios="magnifyingglass" android="search" size={28} color={colors.secondaryLabel} /><ThemedText>No matching tools</ThemedText><ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Try another name or clear your search.</ThemedText></View>} />
    <View style={styles.footer}>{footer}</View>
  </View>;
}

const ToolTile = memo(function ToolTile({ id, title, subtitle, ios, android, unavailable, onSelect }: Tool & { onSelect: (id: string) => void }) {
  const colors = usePalette();
  const tint = toolColors(id, colors);
  return <View style={styles.cell}><Pressable accessibilityRole="button" accessibilityLabel={`${title}${unavailable ? ', ' + (subtitle || 'unavailable') : ''}`} accessibilityState={{ disabled: !!unavailable }} disabled={unavailable}
    onPress={() => onSelect(id)} style={({ pressed }) => [styles.tool, { backgroundColor: pressed ? colors.catalogPressed : colors.catalogSurface, borderColor: colors.catalogBorder, opacity: unavailable ? .45 : 1 }]}>
    <View style={[styles.toolIcon, { backgroundColor: tint.surface }]}><UniversalIcon ios={ios} android={android} size={22} color={tint.ink} /></View>
    <ThemedText numberOfLines={2} style={styles.toolLabel}>{title.replace(/ (Image|PDF)$/, '')}</ThemedText>
  </Pressable></View>;
});
const styles = StyleSheet.create({
  sheet: { flex: 1, minHeight: 0, paddingHorizontal: s.lg }, grow: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: s.md, paddingTop: s.sm, paddingBottom: s.md },
  title: { ...t.heading }, caption: { ...t.caption },
  iconButton: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: s.sm, paddingLeft: s.md, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, marginBottom: s.xs },
  input: { flex: 1, minWidth: 0, minHeight: 44, ...t.body },
  catalog: { flex: 1, minHeight: 0 }, catalogContent: { paddingBottom: s.sm },
  section: { flexDirection: 'row', alignItems: 'center', gap: s.sm }, sectionTitle: { ...t.caption, flex: 1, fontWeight: '600' }, count: { ...t.caption, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: s.sm, paddingBottom: s.sm }, cell: { flex: 1, flexBasis: 0, minWidth: 0 },
  tool: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: s.sm, paddingHorizontal: s.xs, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  toolIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontSize: 12, lineHeight: 17, textAlign: 'center', fontWeight: '600' },
  footer: { paddingVertical: s.sm }, empty: { paddingVertical: s.section, alignItems: 'center', justifyContent: 'center', gap: s.md },
});

import { useMemo, useState, type ReactElement } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import type { ToolSection } from './tool-grid';
import { usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';

export type ToolboxProps = {
  visible: boolean; title: string; subtitle: string; caption?: string; sections: ToolSection[]; footer: ReactElement;
  onClose: () => void;
  /** Runs after the native sheet finishes closing. */
  onAction: (id: string) => void;
};
type ContentProps = Omit<ToolboxProps, 'visible' | 'onAction'> & { onSelect: (id: string) => void; nativeScroll?: boolean; contentWidth?: number };

export function ToolboxContent({ title, subtitle, sections, footer, onClose, onSelect, nativeScroll = false, contentWidth }: ContentProps) {
  const colors = usePalette();
  const { fontScale } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const filteredSections = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/);
    return sections.map(section => ({ ...section, data: section.data.filter(tool => terms.every(term => `${tool.title} ${tool.subtitle} ${section.title}`.toLowerCase().includes(term))) })).filter(section => section.data.length);
  }, [sections, query]);
  const columns = 3;
  const cellHeight = Math.max(78, Math.ceil(48 + 30 * fontScale));
  const Catalog = nativeScroll ? View : ScrollView;
  return <View style={[styles.sheet, nativeScroll && { flex: 0, width: contentWidth }, { backgroundColor: colors.sheetBackground }]}>
    <View style={styles.header}>
      <View style={styles.grow}><ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText><ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>{subtitle}</ThemedText></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={() => { Keyboard.dismiss(); onClose(); }} style={[styles.iconButton, { backgroundColor: colors.fieldSurface }]}><UniversalIcon ios="xmark" android="close" size={20} color={colors.label} /></Pressable>
    </View>
    <View style={[styles.search, { backgroundColor: colors.fieldSurface }]}>
      <UniversalIcon ios="magnifyingglass" android="search" size={18} color={colors.secondaryLabel} />
      <TextInput accessibilityLabel="Search toolbox" placeholder="Find a tool" placeholderTextColor={colors.secondaryLabel} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={Keyboard.dismiss} style={[styles.input, { color: colors.label }]} />
      {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={styles.iconButton}><UniversalIcon ios="xmark.circle.fill" android="cancel" size={18} color={colors.secondaryLabel} /></Pressable>}
    </View>
    <Catalog style={nativeScroll ? undefined : styles.gridArea} {...(nativeScroll ? {} : { nestedScrollEnabled: true, keyboardShouldPersistTaps: 'handled' as const, contentContainerStyle: styles.gridContent })}>
      {!filteredSections.length ? <View style={styles.empty}><ThemedText>No matching tools</ThemedText></View> : filteredSections.map(section => <View key={section.title}>
        <ThemedText accessibilityRole="header" style={[styles.sectionTitle, { color: colors.secondaryLabel }]}>{section.title}</ThemedText>
        <View style={styles.grid}>{section.data.map(tool => {
          const tint = toolColors(tool.id, colors);
          return <Pressable key={tool.id} accessibilityRole="button" accessibilityLabel={`${tool.title}${tool.unavailable ? ', ' + (tool.subtitle || 'unavailable') : ''}`} accessibilityState={{ disabled: !!tool.unavailable }} disabled={tool.unavailable} onPress={() => { Keyboard.dismiss(); onSelect(tool.id); }} style={({ pressed }) => [styles.tool, { width: `${100 / columns}%`, height: cellHeight, opacity: tool.unavailable ? 0.4 : pressed ? 0.55 : 1 }]}>
            <View style={[styles.toolIcon, { backgroundColor: tint.surface }]}><UniversalIcon ios={tool.ios} android={tool.android} size={23} color={tint.ink} /></View>
            <ThemedText numberOfLines={2} style={styles.toolLabel}>{tool.title.replace(/ (Image|PDF)$/, '')}</ThemedText>
          </Pressable>;
        })}
      </View></View>)}
    </Catalog>
    {footer}
  </View>;
}
const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: s.lg, paddingBottom: s.sm }, grow: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: s.sm, paddingTop: s.xs, paddingBottom: s.sm },
  title: { ...t.heading }, caption: { ...t.caption },
  iconButton: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: s.sm, paddingLeft: s.md, borderRadius: radius.md, marginBottom: s.sm },
  input: { flex: 1, minWidth: 0, minHeight: 44, ...t.body },
  gridArea: { flex: 1, minHeight: 0 }, gridContent: { flexGrow: 1 }, grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tool: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 4 },
  toolIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontSize: 12, lineHeight: 16, textAlign: 'center', fontWeight: '500' },
  sectionTitle: { ...t.caption, fontWeight: '600', paddingTop: s.md, paddingBottom: s.xs },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

import { StyleSheet, View } from 'react-native';
import { HelpPressable as Pressable } from './help-pressable';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { catalog, radius, spacing as s, typography as t } from '@/theme/dashboard';

/** Visible entry to secondary controls, naming what is inside instead of just "Options". */
export function ToolSettingsSummary({ title, summary, onPress, disabled = false, expanded = false }: {
  title: string; summary: string; onPress: () => void; disabled?: boolean; expanded?: boolean;
}) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${summary}. Open details`}
    accessibilityState={{ disabled, expanded }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.row, { backgroundColor: colors.fieldSurface, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
    <UniversalIcon ios="slider.horizontal.3" android="tune" size={20} color={colors.systemBlue} />
    <View style={styles.text}>
      <ThemedText style={styles.title}>{title}</ThemedText>
      <ThemedText style={[styles.summary, { color: colors.secondaryLabel }]}>{summary}</ThemedText>
    </View>
    <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.secondaryLabel} />
  </Pressable>;
}
const styles = StyleSheet.create({
  row: { minHeight: catalog.touchTarget, flexDirection: 'row', alignItems: 'center', gap: s.sm, paddingHorizontal: s.md, paddingVertical: s.sm, borderRadius: radius.sm, borderCurve: 'continuous' },
  text: { flex: 1, minWidth: 0 },
  title: { ...t.catalogDescription, fontWeight: '600' },
  summary: { ...t.caption },
});

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import type { OptionIcon } from '@/theme/editor-icons';

/**
 * The row under a tool's header: history on the left, navigation centred, tool actions on the right.
 * `vertical` turns it into a left rail for landscape, matching the PDF preview's side rails.
 */
export function ToolActionRow({ left, center, right, below, style, vertical = false }: { left?: ReactNode; center?: ReactNode; right?: ReactNode; below?: ReactNode; style?: StyleProp<ViewStyle>; vertical?: boolean }) {
  const colors = usePalette();
  if (vertical) return <View style={[styles.rail, { borderColor: colors.separator, backgroundColor: colors.systemBackground }, style]}>
    <ScrollView style={styles.railScroll} contentContainerStyle={styles.railContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.railGroup}>{left}</View>
      {center && <View style={styles.railGroup}>{center}</View>}
      <View style={styles.railGroup}>{right}{below}</View>
    </ScrollView>
  </View>;
  return <View style={[styles.container, { borderColor: colors.separator }, style]}>
    <View style={styles.row}>
      <View style={[styles.side, styles.start]}>{left}</View>
      {center && <View style={styles.center}>{center}</View>}
      <View style={[styles.side, styles.end]}>{right}</View>
    </View>
    {below && <View style={styles.below}>{below}</View>}
  </View>;
}

/** Square icon button for the action row; `label` is spoken and shown under the icon when `caption` is set. */
export function ToolRowButton({ label, icon, onPress, selected = false, disabled = false, caption = false, expanded }: {
  label: string; icon: OptionIcon; onPress: () => void; selected?: boolean; disabled?: boolean; caption?: boolean; expanded?: boolean;
}) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled, expanded }} disabled={disabled} onPress={onPress} hitSlop={2}
    style={({ pressed }) => [styles.button, caption && styles.captioned, { backgroundColor: selected ? colors.accentSurface : 'transparent', borderColor: selected ? colors.accent : 'transparent', opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
    <UniversalIcon {...icon} size={22} color={colors.systemBlue} />
    {caption && <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.systemBlue }]}>{label}</ThemedText>}
  </Pressable>;
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 4, paddingVertical: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 4 },
  // Equal flexible sides keep the centre group centred; wide actions wrap within their side.
  side: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2 },
  start: { justifyContent: 'flex-start' },
  end: { justifyContent: 'flex-end' },
  center: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  below: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingBottom: 4 },
  button: { minWidth: 44, minHeight: 44, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  captioned: { minWidth: 52, paddingVertical: 2 },
  rail: { width: 84, borderRightWidth: StyleSheet.hairlineWidth },
  railScroll: { flex: 1 },
  railContent: { flexGrow: 1, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 10 },
  railGroup: { alignItems: 'center', gap: 4 },
  caption: { fontSize: 10, lineHeight: 12, fontWeight: '600' },
});

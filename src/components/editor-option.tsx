import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { optionColorKey, toolColors } from '@/theme/tool-colors';
import { optionIcon, type OptionIcon } from '@/theme/editor-icons';

export { optionIcon } from '@/theme/editor-icons';

export { optionColorKey } from '@/theme/tool-colors';

export function EditorOption({ label, selected = false, disabled = false, onPress, icon, compact = false, accessibilityLabel, style }: {
  label: string; selected?: boolean; disabled?: boolean; onPress: () => void; icon?: OptionIcon; compact?: boolean; accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
  const colors = usePalette();
  const tint = toolColors(optionColorKey(label), colors);
  const symbol = icon ?? optionIcon(label);
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.option, compact && styles.compact, { backgroundColor: selected ? colors.accentSurface : colors.fieldSurface, borderColor: selected ? colors.accent : colors.separator, opacity: disabled ? .4 : pressed ? .65 : 1 }, style]}>
    {symbol && <UniversalIcon {...symbol} size={compact ? 20 : 22} color={tint.ink} />}
    <ThemedText style={{ fontSize: compact ? 13 : 15, lineHeight: compact ? 17 : 21, color: selected ? colors.accent : colors.label }}>{label}</ThemedText>
  </Pressable>;
}
const styles = StyleSheet.create({ compact: { minHeight: 48, minWidth: 56, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'column', gap: 1 }, option: { minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' } });

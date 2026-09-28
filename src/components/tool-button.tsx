import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { optionIcon, type OptionIcon } from '@/theme/editor-icons';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing as s, typography as t } from '@/theme/dashboard';

export function ToolButton({ title, onPress, disabled = false, secondary = false, icon }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; icon?: OptionIcon }) {
  const colors = usePalette();
  const symbol = icon ?? optionIcon(title);
  // Never forward the press event — callers often treat the first argument as file input.
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => onPress()} style={({ pressed }) => [styles.button, { backgroundColor: secondary ? colors.accentSurface : colors.accent, opacity: disabled || pressed ? 0.5 : 1 }, !secondary && getGradients(colors).icon]}>{symbol && <UniversalIcon {...symbol} size={20} color={secondary ? colors.accent : colors.onAccent} />}<ThemedText style={[styles.text, { color: secondary ? colors.accent : colors.onAccent }]}>{title}</ThemedText></Pressable>;
}
const styles = StyleSheet.create({ button: { minHeight: 48, borderRadius: radius.sm, paddingHorizontal: s.md, paddingVertical: s.md, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }, text: { ...t.label, textAlign: 'center', flexShrink: 1 } });

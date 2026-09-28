import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { optionColorKey, optionIcon } from './editor-option';
import { toolColors } from '@/theme/tool-colors';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing as s, typography as t } from '@/theme/dashboard';

export function ToolButton({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  const colors = usePalette();
  const tint = toolColors(optionColorKey(title), colors);
  // Never forward the press event — callers often treat the first argument as file input.
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => onPress()} style={({ pressed }) => [styles.button, { backgroundColor: secondary ? tint.surface : colors.accent, opacity: disabled || pressed ? 0.5 : 1 }, !secondary && getGradients(colors).icon]}><UniversalIcon {...optionIcon(title)} size={20} color={secondary ? tint.ink : colors.onAccent} /><ThemedText style={[styles.text, { color: secondary ? colors.label : colors.onAccent }]}>{title}</ThemedText></Pressable>;
}
const styles = StyleSheet.create({ button: { minHeight: 48, borderRadius: radius.sm, paddingHorizontal: s.md, paddingVertical: s.md, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }, text: { ...t.label, textAlign: 'center', flexShrink: 1 } });

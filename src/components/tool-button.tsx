import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing as s, typography as t } from '@/theme/dashboard';

export function ToolButton({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  const colors = usePalette();
  // Never forward the press event — callers often treat the first argument as file input.
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => onPress()} style={({ pressed }) => [styles.button, { backgroundColor: secondary ? colors.accentSurface : colors.accent, opacity: disabled || pressed ? 0.5 : 1 }, !secondary && getGradients(colors).icon]}><ThemedText style={[styles.text, { color: secondary ? colors.systemBlue : colors.onAccent }]}>{title}</ThemedText></Pressable>;
}
const styles = StyleSheet.create({ button: { minHeight: 48, borderRadius: radius.sm, paddingHorizontal: s.lg, paddingVertical: s.md, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }, text: { ...t.label, textAlign: 'center' } });

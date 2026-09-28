import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';
import { optionIcon, type OptionIcon } from '@/theme/editor-icons';

export { optionIcon } from '@/theme/editor-icons';

export function optionColorKey(label: string) {
  const value = label.toLowerCase();
  if (/area|pencil|size|percent|fit|fill|stretch/.test(value)) return 'resize';
  if (/select|pen|solid|rotate|undo|redo/.test(value)) return 'rotate';
  if (/dotted|style|colour|color|heic|png|tiff|jpeg|webp|export|save|share/.test(value)) return 'export';
  if (/dashed|highlight|compress|balance/.test(value)) return 'compress';
  if (/draw|brush|marker|bold/.test(value)) return 'draw';
  if (/delete|remove|discard/.test(value)) return 'redact';
  return 'adjust';
}
export function EditorOption({ label, selected = false, disabled = false, onPress, icon, compact = false, accessibilityLabel }: {
  label: string; selected?: boolean; disabled?: boolean; onPress: () => void; icon?: OptionIcon; compact?: boolean; accessibilityLabel?: string;
}) {
  const colors = usePalette();
  const tint = toolColors(optionColorKey(label), colors);
  const symbol = icon ?? optionIcon(label);
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.option, compact && styles.compact, { backgroundColor: selected ? colors.accentSurface : colors.fieldSurface, borderColor: selected ? colors.accent : colors.separator, opacity: disabled ? .4 : pressed ? .65 : 1 }]}>
    {symbol && <UniversalIcon {...symbol} size={20} color={tint.ink} />}
    <ThemedText style={{ fontSize: compact ? 10 : 13, color: selected ? colors.accent : colors.label }}>{label}</ThemedText>
  </Pressable>;
}
const styles = StyleSheet.create({ compact: { minWidth: 44, paddingHorizontal: 5, paddingVertical: 4, flexDirection: 'column', gap: 1 }, option: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' } });

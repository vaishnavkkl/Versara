import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';
import type { ComponentProps } from 'react';
type Icon = Pick<ComponentProps<typeof UniversalIcon>, 'ios' | 'android'>;

export function optionIcon(label: string): Icon {
  const value = label.toLowerCase();
  const entries: [RegExp, Icon['ios'], Icon['android']][] = [
    [/undo/, 'arrow.uturn.backward', 'undo'], [/redo/, 'arrow.uturn.forward', 'redo'],
    [/select|resize|handle/, 'arrow.up.left.and.arrow.down.right', 'open-with'],
    [/area|rectangle/, 'rectangle.dashed', 'select-all'], [/dotted/, 'ellipsis', 'more-horiz'],
    [/dashed/, 'line.diagonal', 'power-input'], [/brush|marker|highlighter/, 'highlighter', 'brush'],
    [/pencil/, 'pencil', 'edit'], [/pen|draw|signature/, 'pencil.tip', 'draw'],
    [/watermark|stamp/, 'seal', 'branding-watermark'], [/number|page|top|bottom/, 'doc.text', 'format-list-numbered'],
    [/colour|color|style|format/, 'paintpalette', 'palette'], [/save|export|create|apply/, 'square.and.arrow.down', 'save-alt'],
    [/preview|original|compare|open/, 'eye', 'visibility'], [/share/, 'square.and.arrow.up', 'share'],
    [/delete|remove|discard/, 'trash', 'delete-outline'], [/cancel|close|hide/, 'xmark', 'close'],
    [/quality|max|lossless/, 'sparkles', 'high-quality'], [/small|compress|estimate|size|percent/, 'arrow.down.right.and.arrow.up.left', 'compress'],
    [/png|tiff|jpeg|jpg|heic|heif|webp/, 'photo', 'image'], [/balance|adjust|setting/, 'slider.horizontal.3', 'tune'],
    [/choose|insert|add/, 'plus', 'add'], [/retry|again/, 'arrow.clockwise', 'refresh'],
    [/back|return/, 'arrow.left', 'arrow-back'], [/^-$|thinner/, 'minus', 'remove'], [/^\+$|thicker/, 'plus', 'add'],
  ];
  const found = entries.find(([pattern]) => pattern.test(value));
  return found ? { ios: found[1], android: found[2] } : { ios: 'slider.horizontal.3', android: 'tune' };
}

export function optionColorKey(label: string) {
  const value = label.toLowerCase();
  return /pen|draw|brush|pencil|marker|solid|dotted|dashed/.test(value) ? 'draw' : /page|number|top|bottom|highlight/.test(value) ? 'numbers' : /size|percent|fit|fill|stretch/.test(value) ? 'resize' : /heic|png|tiff|jpeg|webp|export|save|share/.test(value) ? 'export' : /delete|remove|discard/.test(value) ? 'redact' : /rotate|undo|redo/.test(value) ? 'rotate' : 'adjust';
}
export function EditorOption({ label, selected = false, disabled = false, onPress, icon }: {
  label: string; selected?: boolean; disabled?: boolean; onPress: () => void; icon?: Icon;
}) {
  const colors = usePalette();
  const tint = toolColors(optionColorKey(label), colors);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.option, { backgroundColor: selected ? tint.surface : colors.fieldSurface, borderColor: selected ? tint.ink : colors.separator, opacity: disabled ? .4 : pressed ? .65 : 1 }]}>
    <UniversalIcon {...(icon ?? optionIcon(label))} size={20} color={tint.ink} />
    <ThemedText style={{ fontSize: 13, color: selected ? tint.ink : colors.label }}>{label}</ThemedText>
  </Pressable>;
}
const styles = StyleSheet.create({ option: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' } });

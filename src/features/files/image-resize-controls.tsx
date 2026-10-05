import { EditorOption } from '@/components/editor-option';
import { Keyboard, StyleSheet, View } from 'react-native';
import { HelpTextInput as TextInput } from '@/components/help-text-input';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Host, Switch } from '@expo/ui';
import { ThemedText } from '@/components/themed-text';
import { useAppearance, usePalette } from '@/theme/colors';

export type ImageSize = { width: number; height: number };
export type ResizeSettings = { mode: 'percent' | 'pixels'; percent: string; width: string; height: string; locked: boolean };
export const DEFAULT_RESIZE: ResizeSettings = { mode: 'percent', percent: '100', width: '', height: '', locked: true };

export function resolveResize(source: ImageSize | undefined, settings: ResizeSettings): ImageSize | undefined {
  if (!source) return undefined;
  let width: number, height: number;
  if (settings.mode === 'percent') {
    const text = settings.percent.replace(',', '.');
    const percent = Number(text);
    if (!/^\d+(\.\d+)?$/.test(text) || percent < 0.1 || percent > 400) throw new Error('Enter a percentage from 0.1 to 400.');
    width = Math.max(1, Math.round(source.width * percent / 100));
    height = Math.max(1, Math.round(source.height * percent / 100));
  } else {
    if ([settings.width, settings.height].some(value => value && !/^\d+$/.test(value))) throw new Error('Enter whole pixels for width and height.');
    width = settings.width ? Number(settings.width) : settings.height ? Math.round(Number(settings.height) * source.width / source.height) : Math.round(source.width);
    height = settings.height ? Number(settings.height) : Math.round(width * source.height / source.width);
  }
  if (width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error('Output dimensions must be between 1 and 8192 pixels.');
  if (width * height > 6_000_000) throw new Error('Choose a smaller size: output is limited to 6 MP, or 3 MP on low-memory devices.');
  return { width, height };
}

export function ImageResizeControls({ source, value, onChange, disabled = false, inSheet = false }: {
  source?: ImageSize; value: ResizeSettings; onChange: (value: ResizeSettings) => void; disabled?: boolean; inSheet?: boolean;
}) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  let size: ImageSize | undefined; let error = '';
  try { size = resolveResize(source, value); } catch (cause) { error = (cause as Error).message; }
  function dimension(which: 'width' | 'height', text: string) {
    const next = { ...value, [which]: text };
    if (value.locked && source) {
      const other = which === 'width' ? 'height' : 'width';
      next[other] = /^\d+$/.test(text) ? String(Math.max(1, Math.round(Number(text) * source[other] / source[which]))) : '';
    }
    onChange(next);
  }
  function selectMode(next: ResizeSettings['mode']) {
    onChange({ ...value, mode: next, ...(next === 'pixels' && size ? { width: String(size.width), height: String(size.height) } : {}) });
  }
  const button = (label: string, selected: boolean, onPress: () => void) => <EditorOption key={label} label={label} selected={selected} disabled={disabled} onPress={onPress} />;
  const Input = inSheet ? BottomSheetTextInput : TextInput;
  const field = (label: string, text: string, onChangeText: (text: string) => void, decimal = false) => <View style={styles.field}><ThemedText>{label}</ThemedText><Input accessibilityLabel={label} value={text} placeholder={decimal ? '100' : 'Auto'} placeholderTextColor={colors.secondaryLabel} onChangeText={onChangeText} keyboardType={decimal ? 'decimal-pad' : 'number-pad'} editable={!disabled} maxLength={8} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} style={[styles.input, { color: colors.label, backgroundColor: colors.fieldSurface }]} /></View>;
  return <View style={styles.panel}>
    <View style={styles.row}>{button('Percentage', value.mode === 'percent', () => selectMode('percent'))}{button('Pixels', value.mode === 'pixels', () => selectMode('pixels'))}</View>
    {value.mode === 'percent' ? <>
      {field('Custom percentage (%)', value.percent, percent => onChange({ ...value, percent }), true)}
      <View style={styles.row}>{[25, 50, 75, 100].map(percent => button(`${percent}%`, Number(value.percent) === percent, () => onChange({ ...value, percent: String(percent) })))}</View>
    </> : <>
      <View style={styles.row}>{field('Width (px)', value.width, text => dimension('width', text))}{field('Height (px)', value.height, text => dimension('height', text))}</View>
      <View style={styles.row}><ThemedText style={styles.grow}>Lock proportions</ThemedText><Host colorScheme={mode} matchContents><Switch value={value.locked} disabled={disabled} onValueChange={locked => {
        const next = { ...value, locked };
        if (locked && source && /^\d+$/.test(value.width)) next.height = String(Math.max(1, Math.round(Number(value.width) * source.height / source.width)));
        onChange(next);
      }} /></Host></View>
    </>}
    <ThemedText accessibilityLiveRegion="polite" style={{ color: error ? colors.destructive : colors.label }}>{error || (size ? `Output: ${size.width} x ${size.height} px (${(size.width * size.height / 1_000_000).toFixed(2)} MP)` : 'Reading image dimensions...')}</ThemedText>
    <ThemedText style={styles.note}>File size in KB or MB depends on the format and quality and is shown after saving.</ThemedText>
    <EditorOption label="Hide keyboard" icon={{ ios: 'keyboard.chevron.compact.down', android: 'keyboard-hide' }} disabled={disabled} onPress={Keyboard.dismiss} />
  </View>;
}
const styles = StyleSheet.create({ panel: { gap: 10 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, grow: { flex: 1 }, field: { flexGrow: 1, minWidth: 110, gap: 6 }, input: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 }, button: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, justifyContent: 'center' }, note: { fontSize: 12, lineHeight: 17 } });

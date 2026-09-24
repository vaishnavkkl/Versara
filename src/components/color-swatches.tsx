import { Host, Slider } from '@expo/ui';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, useColorScheme } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';

export const INK_COLORS = [
  { value: 0x101020, label: 'Black' }, { value: 0x5f6368, label: 'Grey' }, { value: 0xffffff, label: 'White' },
  { value: 0xd32f2f, label: 'Red' }, { value: 0xe8710a, label: 'Orange' }, { value: 0xf9ab00, label: 'Yellow' },
  { value: 0x188038, label: 'Green' }, { value: 0x12a4b8, label: 'Teal' }, { value: 0x1a73e8, label: 'Blue' },
  { value: 0x122b86, label: 'Navy' }, { value: 0x8e24aa, label: 'Purple' }, { value: 0xd01884, label: 'Pink' },
  { value: 0x795548, label: 'Brown' },
] as const;
export const hexColor = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

type Hsv = { h: number; s: number; v: number };
function toHsv(value: number): Hsv {
  const r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta) h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}
function fromHsv({ h, s, v }: Hsv) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255); };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}

type Props = {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Adds a first swatch that keeps the text's own colour (value null) or restores a detected colour. */
  original?: { label: string; value: number | null };
  disabled?: boolean;
};

export const ColorSwatches = memo(function ColorSwatches({ value, onChange, original, disabled = false }: Props) {
  const colors = usePalette();
  const scheme = useColorScheme();
  const [custom, setCustom] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => toHsv(value ?? 0x1a73e8));
  const [hex, setHex] = useState('');
  // Sliders fire on every movement; the editor re-renders its preview at most ~10 times a second.
  const latest = useRef({ onChange, value: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { latest.current.onChange = onChange; });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const commit = (next: number) => {
    latest.current.value = next;
    timer.current ??= setTimeout(() => { timer.current = null; latest.current.onChange(latest.current.value); }, 100);
  };
  const items: { value: number | null; label: string }[] = original && !INK_COLORS.some(item => item.value === original.value) ? [original, ...INK_COLORS] : [...INK_COLORS];
  const isCustom = value !== null && !items.some(item => item.value === value);
  const update = (next: Hsv) => { setHsv(next); setHex(''); commit(fromHsv(next)); };
  const openCustom = () => {
    if (!custom && value !== null) setHsv(toHsv(value));
    setCustom(!custom); setHex('');
  };
  const slider = (label: string, key: keyof Hsv, max: number) => <View style={styles.sliderRow}>
    <ThemedText style={[styles.sliderLabel, { color: colors.secondaryLabel }]}>{label}</ThemedText>
    <View style={styles.grow}><Host colorScheme={scheme ?? undefined} seedColor={colors.accent} matchContents={{ vertical: true }}>
      <Slider value={hsv[key] * (key === 'h' ? 1 : 100)} min={0} max={max} disabled={disabled} onValueChange={next => update({ ...hsv, [key]: key === 'h' ? next : next / 100 })} />
    </Host></View>
  </View>;
  return <View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.row}>
      {items.map(item => {
        const selected = value === item.value;
        return <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={`${item.label} colour`} accessibilityState={{ selected, disabled }} disabled={disabled}
          onPress={() => onChange(item.value)} style={styles.hit}>
          <View style={[styles.swatch, { backgroundColor: item.value === null ? colors.accentSurface : hexColor(item.value), borderColor: selected ? colors.systemBlue : colors.separator, borderWidth: selected ? 3 : 1 }]}>
            {item.value === null && <UniversalIcon ios="arrow.uturn.backward" android="format-color-reset" size={16} color={colors.systemBlue} />}
          </View>
          {item.value === null && <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{item.label}</ThemedText>}
        </Pressable>;
      })}
      <Pressable accessibilityRole="button" accessibilityLabel="Custom colour" accessibilityState={{ selected: isCustom, expanded: custom, disabled }} disabled={disabled} onPress={openCustom} style={styles.hit}>
        <View style={[styles.swatch, { backgroundColor: isCustom ? hexColor(value) : colors.accentSurface, borderColor: isCustom ? colors.systemBlue : colors.separator, borderWidth: isCustom ? 3 : 1 }]}>
          <UniversalIcon ios="eyedropper" android="colorize" size={16} color={isCustom ? '#ffffff' : colors.systemBlue} />
        </View>
        <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Custom</ThemedText>
      </Pressable>
    </ScrollView>
    {custom && <View style={[styles.picker, { borderColor: colors.separator }]}>
      <View style={styles.sliderRow}>
        <View style={[styles.preview, { backgroundColor: hexColor(fromHsv(hsv)), borderColor: colors.separator }]} />
        <TextInput accessibilityLabel="Hex colour" value={hex || hexColor(fromHsv(hsv)).toUpperCase()} editable={!disabled} autoCapitalize="characters" autoCorrect={false} maxLength={7}
          onChangeText={text => {
            setHex(text);
            const match = /^#?([0-9a-f]{6})$/i.exec(text.trim());
            if (match) { const next = parseInt(match[1], 16); setHsv(toHsv(next)); onChange(next); }
          }}
          style={[styles.hex, { color: colors.label, backgroundColor: colors.accentSurface }]} />
      </View>
      {slider('Hue', 'h', 360)}
      {slider('Saturation', 's', 100)}
      {slider('Brightness', 'v', 100)}
    </View>}
  </View>;
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  hit: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  caption: { fontSize: 10, lineHeight: 12 },
  picker: { gap: 4, paddingTop: 8, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  sliderLabel: { width: 76, fontSize: 13 },
  grow: { flex: 1, minWidth: 0 },
  preview: { width: 44, height: 44, borderRadius: 10, borderWidth: 1 },
  hex: { flex: 1, minHeight: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 16, fontVariant: ['tabular-nums'] },
});

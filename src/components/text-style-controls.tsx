import React, { memo } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { EditorMenu } from './editor-menu';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';

type Icon = React.ComponentProps<typeof UniversalIcon>;

export type FontFamily = 'original' | 'sans' | 'serif' | 'mono';
export type TextStyle = { family: FontFamily; bold: boolean; italic: boolean; underline: boolean };
export const DEFAULT_TEXT_STYLE: TextStyle = { family: 'sans', bold: false, italic: false, underline: false };

// The standard PDF fonts every reader has. Helvetica has Arial's metrics; Times and Courier match Times New Roman and Courier New.
const FAMILIES: { id: FontFamily; label: string; short: string }[] = [
  { id: 'original', label: 'Original font', short: 'Original' },
  { id: 'sans', label: 'Arial / Helvetica', short: 'Arial' },
  { id: 'serif', label: 'Times New Roman', short: 'Times' },
  { id: 'mono', label: 'Courier New', short: 'Courier' },
];

/** Standard 14 PDF font name, or 'original' to keep the text's own font. */
export function fontName({ family, bold, italic }: TextStyle): string {
  if (family === 'original') return 'original';
  if (family === 'serif') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  const base = family === 'mono' ? 'Courier' : 'Helvetica';
  return base + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '');
}
export function styleFromFont(font: string | undefined, underline = false): TextStyle {
  if (!font || font === 'original') return { family: 'original', bold: false, italic: false, underline };
  return {
    family: font.startsWith('Times') ? 'serif' : font.startsWith('Courier') ? 'mono' : 'sans',
    bold: font.includes('Bold'), italic: font.includes('Oblique') || font.includes('Italic'), underline,
  };
}

/** Quick text choices share exactly the same style state as the full controls. */
export function TextStyleMenu({ style, onChange, disabled, allowOriginal = false }: {
  style: TextStyle; onChange: (style: TextStyle) => void; disabled?: boolean; allowOriginal?: boolean;
}) {
  return <EditorMenu label="Text style" disabled={disabled} items={[
    ...FAMILIES.filter(item => allowOriginal || item.id !== 'original').map(item => ({ id: item.id, label: item.label, selected: style.family === item.id,
      onPress: () => onChange({ ...style, family: item.id, ...(item.id === 'original' ? { bold: false, italic: false } : {}) }) })),
    ...(['bold', 'italic', 'underline'] as const).map(key => ({ id: key, label: key[0].toUpperCase() + key.slice(1), selected: style[key], disabled: key !== 'underline' && style.family === 'original', onPress: () => onChange({ ...style, [key]: !style[key] }) })),
  ]} />;
}

type Props = {
  style: TextStyle;
  onChange: (style: TextStyle) => void;
  size: string;
  onSizeChange: (size: string) => void;
  sizeUnit: string;
  minSize: number;
  maxSize: number;
  /** Shift of the text block; omitted hides indent controls. */
  indent?: number;
  indentStep?: number;
  onIndentChange?: (indent: number) => void;
  allowOriginal?: boolean;
  disabled?: boolean;
};

/** Font family, bold, italic, underline, size and indent for the native text editors. */
export const TextStyleControls = memo(function TextStyleControls({ style, onChange, size, onSizeChange, sizeUnit, minSize, maxSize, indent, indentStep = 18, onIndentChange, allowOriginal = false, disabled = false }: Props) {
  const colors = usePalette();
  const family = FAMILIES.find(item => item.id === style.family) ?? FAMILIES[1];
  const original = style.family === 'original';
  const step = (factor: number) => {
    const current = Number(size) || minSize;
    const next = factor > 1 ? Math.max(current + 1, Math.round(current * factor)) : Math.min(current - 1, Math.round(current * factor));
    onSizeChange(String(Math.min(maxSize, Math.max(minSize, next))));
  };
  const toggle = (key: 'bold' | 'italic' | 'underline', label: string, ios: Icon['ios'], android: Icon['android'], unavailable = false) => {
    const selected = style[key];
    return <Pressable key={key} accessibilityRole="togglebutton" accessibilityLabel={unavailable ? `${label}, choose a font first` : label} accessibilityState={{ checked: selected, disabled: disabled || unavailable }}
      disabled={disabled || unavailable} onPress={() => onChange({ ...style, [key]: !selected })}
      style={[styles.square, { backgroundColor: selected ? colors.systemBlue : colors.accentSurface }, unavailable && styles.dim]}>
      <UniversalIcon ios={ios} android={android} size={20} color={selected ? colors.systemBackground : colors.systemBlue} />
    </Pressable>;
  };
  const iconButton = (label: string, ios: Icon['ios'], android: Icon['android'], onPress: () => void, off = false) => <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: disabled || off }} disabled={disabled || off} onPress={onPress} style={[styles.square, { backgroundColor: colors.accentSurface }, off && styles.dim]}>
    <UniversalIcon ios={ios} android={android} size={20} color={colors.systemBlue} />
  </Pressable>;
  return <View style={styles.stack}>
    <View style={[styles.row, styles.wrap]}>
      <EditorMenu label={family.short} disabled={disabled} items={FAMILIES.filter(item => allowOriginal || item.id !== 'original').map(item => ({
        id: item.id, label: item.label, selected: item.id === style.family,
        onPress: () => onChange({ ...style, family: item.id, ...(item.id === 'original' ? { bold: false, italic: false } : {}) }),
      }))} />
      {toggle('bold', 'Bold', 'bold', 'format-bold', original)}
      {toggle('italic', 'Italic', 'italic', 'format-italic', original)}
      {toggle('underline', 'Underline', 'underline', 'format-underlined')}
    </View>
    {original && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>Choose Arial, Times New Roman or Courier New to use bold and italic.</ThemedText>}
    <View style={[styles.row, styles.wrap]}>
      <View style={styles.row}>
        {iconButton('Smaller text', 'minus', 'remove', () => step(0.9), (Number(size) || 0) <= minSize)}
        <TextInput accessibilityLabel={`Font size in ${sizeUnit}`} keyboardType="decimal-pad" value={size} onChangeText={onSizeChange} maxLength={5} editable={!disabled} selectTextOnFocus
          style={[styles.size, { color: colors.label, backgroundColor: colors.accentSurface }]} />
        {iconButton('Larger text', 'plus', 'add', () => step(1.1), (Number(size) || 0) >= maxSize)}
        <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>{sizeUnit}</ThemedText>
      </View>
      {indent !== undefined && onIndentChange && <View style={styles.row}>
        {iconButton('Decrease indent', 'decrease.indent', 'format-indent-decrease', () => onIndentChange(indent - indentStep), indent <= 0)}
        {iconButton('Increase indent', 'increase.indent', 'format-indent-increase', () => onIndentChange(indent + indentStep), indent >= indentStep * 20)}
        {indent > 0 && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>Indent {Math.round(indent / indentStep)}</ThemedText>}
      </View>}
    </View>
  </View>;
});

const styles = StyleSheet.create({
  stack: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wrap: { flexWrap: 'wrap', columnGap: 12 },
  fontButton: { minHeight: 52, borderRadius: 22, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: { minHeight: 40, borderRadius: 20, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  square: { width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600' },
  size: { width: 64, minHeight: 52, borderRadius: 12, textAlign: 'center', fontSize: 16, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, lineHeight: 16 },
  dim: { opacity: 0.4 },
});

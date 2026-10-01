import React, { memo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { EDIT_FONTS, familyById, familyOfFont, useEditFonts, type EditFontFamily, type FontStyleName } from '@/constants/edit-fonts';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';

type Icon = React.ComponentProps<typeof UniversalIcon>;

/** `original`, a standard PDF family (`sans`, `serif`, `mono`) or a bundled family id from EDIT_FONTS. */
export type FontFamily = string;
export type TextStyle = { family: FontFamily; bold: boolean; italic: boolean; underline: boolean };
export const DEFAULT_TEXT_STYLE: TextStyle = { family: 'sans', bold: false, italic: false, underline: false };

const ORIGINAL: EditFontFamily = { id: 'original', label: 'Original font', category: 'Standard', styles: ['Regular'] };
const CATEGORIES = ['Standard', 'Sans serif', 'Serif', 'Monospace', 'Display', 'Script'] as const;
const previewFamily = (item: EditFontFamily, loaded: boolean) => item.prefix ? (loaded ? `${item.prefix}-Regular` : undefined) : item.preview;

/** Standard 14 PDF font name, a bundled font name such as `Poppins-Bold`, or 'original' to keep the text's own font. */
export function fontName({ family, bold, italic }: TextStyle): string {
  if (family === 'original') return 'original';
  const bundled = familyById(family);
  if (bundled?.prefix) {
    const wanted: FontStyleName = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
    return `${bundled.prefix}-${bundled.styles.includes(wanted) ? wanted : 'Regular'}`;
  }
  if (family === 'serif') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  const base = family === 'mono' ? 'Courier' : 'Helvetica';
  return base + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '');
}
export function styleFromFont(font: string | undefined, underline = false): TextStyle {
  if (!font || font === 'original') return { family: 'original', bold: false, italic: false, underline };
  const bundled = familyOfFont(font);
  if (bundled) {
    const style = font.slice(bundled.prefix!.length + 1);
    return { family: bundled.id, bold: style.includes('Bold'), italic: style.includes('Italic'), underline };
  }
  return {
    family: font.startsWith('Times') ? 'serif' : font.startsWith('Courier') ? 'mono' : 'sans',
    bold: font.includes('Bold'), italic: font.includes('Oblique') || font.includes('Italic'), underline,
  };
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

/**
 * Font, size, emphasis and indent for the native text editors.
 * The typeface and its size share the first row; bold, italic and underline are a separate group.
 */
export const TextStyleControls = memo(function TextStyleControls({ style, onChange, size, onSizeChange, sizeUnit, minSize, maxSize, indent, indentStep = 18, onIndentChange, allowOriginal = false, disabled = false }: Props) {
  const colors = usePalette();
  const [fontsOpen, setFontsOpen] = useState(false);
  const loaded = useEditFonts();
  const families = allowOriginal ? [ORIGINAL, ...EDIT_FONTS] : EDIT_FONTS;
  const family = style.family === 'original' ? ORIGINAL : familyById(style.family) ?? EDIT_FONTS[0];
  const original = style.family === 'original';
  const canBold = !original && family.styles.includes('Bold');
  const canItalic = !original && family.styles.includes('Italic');
  const step = (factor: number) => {
    const current = Number(size) || minSize;
    const next = factor > 1 ? Math.max(current + 1, Math.round(current * factor)) : Math.min(current - 1, Math.round(current * factor));
    onSizeChange(String(Math.min(maxSize, Math.max(minSize, next))));
  };
  const chooseFamily = (id: FontFamily) => {
    setFontsOpen(false);
    const next = id === 'original' ? ORIGINAL : familyById(id);
    onChange({ ...style, family: id, bold: style.bold && !!next?.styles.includes('Bold'), italic: style.italic && !!next?.styles.includes('Italic') });
  };
  const segment = (key: string, label: string, ios: Icon['ios'], android: Icon['android'], selected: boolean, onPress: () => void, unavailable = false, toggle = true) =>
    <Pressable key={key} accessibilityRole={toggle ? 'togglebutton' : 'button'} accessibilityLabel={label} accessibilityState={toggle ? { checked: selected, disabled: disabled || unavailable } : { disabled: disabled || unavailable }}
      disabled={disabled || unavailable} onPress={onPress}
      style={({ pressed }) => [styles.segment, { backgroundColor: selected ? colors.systemBlue : 'transparent', opacity: unavailable ? 0.35 : pressed ? 0.6 : 1 }]}>
      <UniversalIcon ios={ios} android={android} size={20} color={selected ? colors.systemBackground : colors.label} />
    </Pressable>;
  const divider = (key: string) => <View key={key} style={[styles.divider, { backgroundColor: colors.separator }]} />;
  const groupStyle = [styles.group, { borderColor: colors.separator, backgroundColor: colors.fieldSurface }];
  return <View style={styles.stack}>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Font, ${family.label}`} accessibilityHint="Shows the available fonts" accessibilityState={{ expanded: fontsOpen, disabled }} disabled={disabled}
        onPress={() => setFontsOpen(value => !value)}
        style={({ pressed }) => [styles.dropdown, { borderColor: fontsOpen ? colors.systemBlue : colors.separator, backgroundColor: colors.fieldSurface, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
        <ThemedText numberOfLines={1} style={[styles.dropdownLabel, previewFamily(family, loaded) ? { fontFamily: previewFamily(family, loaded) } : null]}>{family.label}</ThemedText>
        <UniversalIcon ios={fontsOpen ? 'chevron.up' : 'chevron.down'} android={fontsOpen ? 'expand-less' : 'expand-more'} size={18} color={colors.secondaryLabel} />
      </Pressable>
      <View style={groupStyle}>
        <Pressable accessibilityRole="button" accessibilityLabel="Smaller text" disabled={disabled || (Number(size) || 0) <= minSize} onPress={() => step(0.9)} style={[styles.stepper, (Number(size) || 0) <= minSize && styles.dim]}>
          <UniversalIcon ios="minus" android="remove" size={18} color={colors.label} />
        </Pressable>
        <TextInput accessibilityLabel={`Font size in ${sizeUnit}`} keyboardType="decimal-pad" value={size} onChangeText={onSizeChange} maxLength={5} editable={!disabled} selectTextOnFocus
          style={[styles.size, { color: colors.label }]} />
        <ThemedText style={[styles.unit, { color: colors.secondaryLabel }]}>{sizeUnit}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel="Larger text" disabled={disabled || (Number(size) || 0) >= maxSize} onPress={() => step(1.1)} style={[styles.stepper, (Number(size) || 0) >= maxSize && styles.dim]}>
          <UniversalIcon ios="plus" android="add" size={18} color={colors.label} />
        </Pressable>
      </View>
    </View>
    {fontsOpen && <View accessibilityRole="list" style={styles.fontList}>
      {CATEGORIES.map(category => {
        const items = families.filter(item => item.category === category);
        return items.length > 0 && <View key={category} style={styles.fontGroup}>
          <ThemedText style={[styles.fontCategory, { color: colors.secondaryLabel }]}>{category}</ThemedText>
          <View style={styles.fontGrid}>{items.map(item => {
            const selected = item.id === style.family;
            const preview = previewFamily(item, loaded);
            return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected }} disabled={disabled} onPress={() => chooseFamily(item.id)}
              style={({ pressed }) => [styles.fontChip, { borderColor: selected ? colors.systemBlue : colors.separator, backgroundColor: selected ? colors.accentSurface : pressed ? colors.catalogPressed : colors.fieldSurface }]}>
              <ThemedText numberOfLines={1} style={[styles.fontLabel, preview ? { fontFamily: preview } : null, selected && { color: colors.systemBlue }]}>{item.label}</ThemedText>
            </Pressable>;
          })}</View>
        </View>;
      })}
    </View>}
    <View style={[styles.row, styles.wrap]}>
      <View accessibilityLabel="Text emphasis" style={groupStyle}>
        {segment('bold', original ? 'Bold, choose a font first' : canBold ? 'Bold' : 'Bold, not available in this font', 'bold', 'format-bold', style.bold, () => onChange({ ...style, bold: !style.bold }), !canBold)}
        {divider('d1')}
        {segment('italic', original ? 'Italic, choose a font first' : canItalic ? 'Italic' : 'Italic, not available in this font', 'italic', 'format-italic', style.italic, () => onChange({ ...style, italic: !style.italic }), !canItalic)}
        {divider('d2')}
        {segment('underline', 'Underline', 'underline', 'format-underlined', style.underline, () => onChange({ ...style, underline: !style.underline }))}
      </View>
      {indent !== undefined && onIndentChange && <View accessibilityLabel="Indent" style={groupStyle}>
        {segment('outdent', 'Decrease indent', 'decrease.indent', 'format-indent-decrease', false, () => onIndentChange(indent - indentStep), indent <= 0, false)}
        {divider('d3')}
        {segment('indent', 'Increase indent', 'increase.indent', 'format-indent-increase', false, () => onIndentChange(indent + indentStep), indent >= indentStep * 20, false)}
      </View>}
      {!!indent && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>Indent {Math.round(indent / indentStep)}</ThemedText>}
    </View>
    {original && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>Choose a font to use bold and italic.</ThemedText>}
  </View>;
});

const styles = StyleSheet.create({
  stack: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexWrap: 'wrap' },
  dropdown: { flex: 1, minWidth: 120, minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dropdownLabel: { flex: 1, fontSize: 16 },
  group: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  segment: { width: 48, height: 46, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 8 },
  stepper: { width: 40, height: 46, alignItems: 'center', justifyContent: 'center' },
  size: { width: 44, minHeight: 46, textAlign: 'center', fontSize: 16, fontVariant: ['tabular-nums'], paddingHorizontal: 0 },
  unit: { fontSize: 12, marginRight: 2 },
  fontList: { gap: 10 },
  fontGroup: { gap: 6 },
  fontCategory: { fontSize: 12, fontWeight: '600' },
  fontGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fontChip: { flexGrow: 1, flexBasis: '45%', minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, justifyContent: 'center' },
  fontLabel: { fontSize: 16 },
  note: { fontSize: 12, lineHeight: 16 },
  dim: { opacity: 0.35 },
});

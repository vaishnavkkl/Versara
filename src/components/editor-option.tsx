import { brandFont, editorActions, radius } from '@/theme/dashboard';
import { useContext } from 'react';
import { EditorActionContext, editorActionStyles } from './editor-action-bar';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { AppGlyph } from '@/components/app-glyph';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { optionColorKey, softFill, toolColors } from '@/theme/tool-colors';
import { optionIcon, type OptionIcon } from '@/theme/editor-icons';

export { optionIcon } from '@/theme/editor-icons';

export { optionColorKey } from '@/theme/tool-colors';

export function EditorOption({ label, selected = false, disabled = false, onPress, icon, compact = false, accessibilityLabel, style, colorId: colorIdProp }: {
  label: string; selected?: boolean; disabled?: boolean; onPress: () => void; icon?: OptionIcon; compact?: boolean; accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
  /** Overrides label/icon colour mapping when the control is a named tool. */
  colorId?: string;
}) {
  const colors = usePalette();
  const inActionBar = useContext(EditorActionContext);
  const symbol = icon ?? optionIcon(label);
  const colorId = colorIdProp ?? optionColorKey(label, symbol?.android);
  const tint = toolColors(colorId, colors);
  const dark = colors.systemBackground === '#000000';

  // Compact controls (docks + bottomsheets): app-glyph tiles + caption — same as Edit PDF.
  if (inActionBar || compact) {
    return <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        inActionBar ? editorActionStyles.option : styles.glyphOption,
        { opacity: disabled ? 0.38 : pressed ? 0.7 : 1, transform: [{ scale: pressed && !disabled ? 0.94 : 1 }] },
        style,
      ]}>
      {symbol
        ? <AppGlyph id={colorId} ios={symbol.ios} android={symbol.android} size={editorActions.glyphSize} selected={selected} />
        : <ThemedText style={[editorActionStyles.optionLabel, { color: selected ? tint.vivid : colors.label }]}>{label.slice(0, 1)}</ThemedText>}
      <ThemedText numberOfLines={2} style={[editorActionStyles.optionLabel, { color: selected ? tint.vivid : colors.secondaryLabel }]}>{label}</ThemedText>
    </Pressable>;
  }

  // Wide inline chips (rare non-compact presets): tinted wash, no chrome box.
  const chipFill = selected ? softFill(tint.ink, dark) : undefined;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ selected, disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.option,
      chipFill,
      {
        backgroundColor: selected ? undefined : (dark ? '#FFFFFF08' : colors.fieldSurface),
        opacity: disabled ? 0.4 : pressed ? 0.72 : 1,
      },
      style,
    ]}>
    {symbol && <UniversalIcon {...symbol} size={editorActions.iconSize} color={tint.ink} />}
    <ThemedText numberOfLines={2} style={[
      styles.chipLabel,
      { color: selected ? tint.ink : colors.label },
      brandFont.label,
    ]}>{label}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  option: {
    minHeight: 48, borderRadius: radius.sm, borderCurve: 'continuous',
    paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', gap: 7,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  /** Compact glyph outside an action bar (e.g. sheet fragments) — same footprint as dock cells. */
  glyphOption: {
    minWidth: 64, minHeight: editorActions.minHeight, maxWidth: 88, flexGrow: 1,
    flexDirection: 'column', gap: 6, paddingHorizontal: 2, paddingVertical: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  chipLabel: { fontSize: 15, lineHeight: 20, letterSpacing: -0.2, textAlign: 'center', flexShrink: 1 },
});

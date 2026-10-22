import { useContext } from 'react';
import { EditorActionContext, editorActionStyles } from './editor-action-bar';
import { StyleSheet } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { AppGlyph, GlyphTile } from '@/components/app-glyph';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { optionIcon, type OptionIcon } from '@/theme/editor-icons';
import { usePalette } from '@/theme/colors';
import { brandFont, editorActions, getGradients, radius, spacing as s, typography as t } from '@/theme/dashboard';
import { optionColorKey, toolColors } from '@/theme/tool-colors';

export function ToolButton({ title, onPress, disabled = false, secondary = false, icon }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; icon?: OptionIcon }) {
  const colors = usePalette();
  const inActionBar = useContext(EditorActionContext);
  const symbol = icon ?? (/^[+\-\u2212]$/.test(title.trim()) ? undefined : optionIcon(title));
  // Never forward the press event — callers often treat the first argument as file input.
  // In dark mode `accent` is a fill colour, not readable text — secondary actions use `systemBlue` (white).
  const dark = colors.systemBackground === '#000000';
  const colorId = optionColorKey(title, symbol?.android);
  const tint = toolColors(colorId, colors);
  const ink = secondary ? tint.vivid : colors.onAccent;

  // Dock: app-glyph tiles. Secondary uses the tool colour; primary Save/Apply keeps the accent fill.
  if (inActionBar) {
    const labelColor = disabled ? colors.secondaryLabel : (secondary ? colors.secondaryLabel : colors.systemBlue);
    if (secondary && symbol) {
      return <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onPress()}
        style={({ pressed }) => [
          editorActionStyles.option,
          { opacity: disabled ? 0.4 : pressed ? 0.7 : 1, transform: [{ scale: pressed && !disabled ? 0.94 : 1 }] },
        ]}>
        <AppGlyph id={colorId} ios={symbol.ios} android={symbol.android} size={editorActions.glyphSize} />
        <ThemedText numberOfLines={2} style={[editorActionStyles.optionLabel, { color: labelColor }]}>{title}</ThemedText>
      </Pressable>;
    }
    const tileBg = secondary ? (dark ? '#2C2C2E' : '#FFFFFF') : colors.accent;
    const tileBorder = secondary ? (dark ? '#FFFFFF1A' : '#0F172A12') : colors.accent;
    return <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onPress()}
      style={({ pressed }) => [
        editorActionStyles.option,
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1, transform: [{ scale: pressed && !disabled ? 0.94 : 1 }] },
      ]}>
      <GlyphTile size={editorActions.glyphSize} style={{ backgroundColor: tileBg, borderColor: tileBorder, borderWidth: secondary ? StyleSheet.hairlineWidth : 0 }}>
        {symbol
          ? <UniversalIcon {...symbol} size={Math.round(editorActions.glyphSize * 0.56)} color={ink} />
          : <ThemedText style={[editorActionStyles.optionLabel, { color: ink }]}>{title.slice(0, 1)}</ThemedText>}
      </GlyphTile>
      <ThemedText numberOfLines={2} style={[editorActionStyles.optionLabel, { color: labelColor }]}>{title}</ThemedText>
    </Pressable>;
  }

  const fill = secondary ? (dark ? colors.fieldSurface : colors.tileSurface) : colors.accent;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={title}
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={() => onPress()}
    style={({ pressed }) => [
      styles.button,
      {
        backgroundColor: fill,
        opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
      },
      !secondary && getGradients(colors).icon,
      secondary && { borderWidth: StyleSheet.hairlineWidth, borderColor: dark ? colors.moduleBorder : colors.catalogBorder },
    ]}>
    {symbol && <UniversalIcon {...symbol} size={20} color={ink} />}
    <ThemedText numberOfLines={2} style={[styles.text, brandFont.label, { color: ink }]}>{title}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48, borderRadius: radius.sm, borderCurve: 'continuous',
    paddingHorizontal: s.md, paddingVertical: s.md, flexDirection: 'row', gap: 7,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  text: { ...t.label, textAlign: 'center', flexShrink: 1 },
});

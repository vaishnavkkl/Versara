import { editorActions } from '@/theme/dashboard';
import { EditorActionContext, editorActionStyles } from './editor-action-bar';
import { useContext, useState } from 'react';
import { Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { MenuView } from '@expo/ui/community/menu';
import { AppBottomSheet } from './app-bottom-sheet';
import { AppGlyph, HeaderGlyph } from './app-glyph';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { useAppearance, usePalette } from '@/theme/colors';
import { optionIcon, type OptionIcon } from '@/theme/editor-icons';
import { optionColorKey, toolColors } from '@/theme/tool-colors';
import { useControlHelp } from './control-help';

export type EditorMenuItem = { id: string; label: string; selected?: boolean; disabled?: boolean; onPress: () => void; icon?: OptionIcon; colorKey?: string };

const SHEET_AFTER = 6;
const GRID_PADDING = 12;
const GRID_GAP = 8;

function iconFor(label: string, explicit?: OptionIcon) {
  if (explicit) return explicit;
  const simplified = label.trim().toLowerCase().replace(/^(show|hide) /, '').replace(/ stroke$/, '');
  return optionIcon(label) ?? (simplified === label.trim().toLowerCase() ? undefined : optionIcon(simplified));
}

/**
 * Native menu for a short list. Longer lists open a native bottom sheet so every row can show its icon.
 * `grid` lays the sheet out as glyph tiles in that many columns; `iconOnly` shows a header-glyph trigger.
 */
export function EditorMenu({ label, items, disabled = false, compact = false, icon, tintedItems = false, colorKey, grid, iconOnly = false }: { label: string; items: EditorMenuItem[]; disabled?: boolean; compact?: boolean; icon?: OptionIcon; tintedItems?: boolean; colorKey?: string; grid?: number; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const help = useControlHelp();
  const colors = usePalette();
  const inActionBar = useContext(EditorActionContext);
  const mode = useAppearance(state => state.mode);
  const { width: windowWidth } = useWindowDimensions();
  // Pixel widths: percentages inside the sheet's scroll content can collapse to one column.
  const tileWidth = grid ? Math.floor((Math.min(windowWidth, 640) - GRID_PADDING * 2 - GRID_GAP * (grid - 1)) / grid) - 1 : 0;
  const triggerIcon = icon ?? iconFor(label);
  const sheet = inActionBar || help?.active || !!grid || iconOnly || tintedItems || items.length > SHEET_AFTER || Platform.OS !== 'ios';
  const triggerColorId = colorKey ?? optionColorKey(label, triggerIcon?.android);
  const triggerTint = toolColors(triggerColorId, colors).vivid;
  const choose = (item: EditorMenuItem) => {
    setOpen(false);
    if (!disabled && !item.disabled) item.onPress();
  };
  const trigger = iconOnly ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}, show options`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(value => !value)} helpOnLongPress helpText={label} hitSlop={2}
    style={({ pressed }) => [styles.iconTrigger, { opacity: disabled ? .35 : pressed ? .6 : 1 }]}>
    {triggerIcon && <HeaderGlyph id={triggerColorId} ios={triggerIcon.ios} android={triggerIcon.android} size={38} selected={open} />}
  </Pressable> : inActionBar && triggerIcon ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}, show options`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(value => !value)}
    style={({ pressed }) => [editorActionStyles.option, { opacity: disabled ? .4 : pressed ? .7 : 1 }]}>
    <AppGlyph id={triggerColorId} ios={triggerIcon.ios} android={triggerIcon.android} size={editorActions.glyphSize} selected={open} />
    <ThemedText numberOfLines={2} style={[editorActionStyles.optionLabel, { color: open ? triggerTint : colors.secondaryLabel }]}>{label}</ThemedText>
  </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={`${label}, show options`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(value => !value)}
    style={[styles.trigger, compact && styles.compact, { backgroundColor: colors.fieldSurface, borderColor: colors.separator, opacity: disabled ? .4 : 1 }]}>
    {triggerIcon && <UniversalIcon {...triggerIcon} size={20} color={triggerTint} />}
    <ThemedText numberOfLines={1} style={[styles.triggerLabel, compact && styles.compactLabel]}>{label}</ThemedText>
    <UniversalIcon ios="chevron.down" android="expand-more" size={18} color={colors.secondaryLabel} />
  </Pressable>;
  const rows = items.map(item => {
    const rowIcon = iconFor(item.label, item.icon);
    const inactive = disabled || item.disabled;
    const itemColorId = item.colorKey ?? optionColorKey(item.label, rowIcon?.android);
    const tint = toolColors(itemColorId, colors);
    if (grid) return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: item.selected, disabled: inactive }} disabled={inactive} onPress={() => choose(item)}
      style={({ pressed }) => [styles.tile, { width: tileWidth, opacity: inactive ? .4 : pressed ? .65 : 1 }]}>
      {rowIcon
        ? <AppGlyph id={itemColorId} ios={rowIcon.ios} android={rowIcon.android} size={40} selected={!!item.selected} />
        : <ThemedText style={[styles.tileLabel, { color: tint.vivid }]}>{item.label.slice(0, 1)}</ThemedText>}
      <ThemedText numberOfLines={grid >= 4 ? 2 : 3} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.tileLabel, { color: item.selected ? tint.vivid : colors.secondaryLabel }, item.selected && { fontWeight: '700' }]}>{item.label}</ThemedText>
    </Pressable>;
    return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.selected, disabled: inactive }} disabled={inactive} onPress={() => choose(item)}
      style={[styles.row, { backgroundColor: item.selected ? tint.surface : 'transparent', opacity: inactive ? .4 : 1 }]}>
      {rowIcon
        ? <AppGlyph id={itemColorId} ios={rowIcon.ios} android={rowIcon.android} size={36} selected={!!item.selected} />
        : <View style={styles.iconGap} />}
      <ThemedText style={[styles.rowLabel, item.selected && { color: tint.vivid, fontWeight: '700' }]}>{item.label}</ThemedText>
      {item.selected && <UniversalIcon ios="checkmark" android="check" size={18} color={tint.vivid} />}
    </Pressable>;
  });
  if (Platform.OS === 'web' || sheet) return <View style={[styles.anchor, inActionBar && editorActionStyles.anchor]}>
    {trigger}
    {Platform.OS !== 'web' && <AppBottomSheet visible={open} onClose={() => setOpen(false)} title={label} icon={triggerIcon} maxHeight={0.75} contentStyle={grid ? undefined : styles.list}>{grid ? <View style={styles.grid}>{rows}</View> : rows}</AppBottomSheet>}
    {Platform.OS === 'web' && open && <ScrollView style={[styles.webList, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]} keyboardShouldPersistTaps="handled">{rows}</ScrollView>}
  </View>;
  return <View pointerEvents={disabled ? 'none' : 'auto'} style={[styles.anchor, disabled && styles.dim]}>
    <MenuView title={label} colorScheme={mode} actions={items.map(item => ({ id: item.id, title: item.label, image: iconFor(item.label, item.icon)?.ios, state: item.selected ? 'on' as const : 'off' as const, attributes: { disabled: disabled || item.disabled } }))}
      onPressAction={({ nativeEvent }) => { const item = items.find(entry => entry.id === nativeEvent.event); if (item) choose(item); }}>
      <View accessible accessibilityRole="button" accessibilityLabel={`${label}, show options`} accessibilityState={{ disabled }}
        style={[styles.trigger, compact && styles.compact, { backgroundColor: colors.fieldSurface, borderColor: colors.separator }]}>
        {triggerIcon && <UniversalIcon {...triggerIcon} size={20} color={triggerTint} />}
        <ThemedText numberOfLines={1} style={[styles.triggerLabel, compact && styles.compactLabel]}>{label}</ThemedText>
        <UniversalIcon ios="chevron.down" android="expand-more" size={18} color={colors.secondaryLabel} />
      </View>
    </MenuView>
  </View>;
}

const styles = StyleSheet.create({
  anchor: { alignSelf: 'flex-end', maxWidth: '100%' },
  dim: { opacity: 0.4 },
  trigger: { minHeight: 44, maxWidth: 220, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconTrigger: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  compact: { minHeight: 48, maxWidth: 148, paddingHorizontal: 10, borderRadius: 12 },
  triggerLabel: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  compactLabel: { fontSize: 13 },
  row: { minHeight: 56, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12 },
  rowLabel: { flex: 1, fontSize: 16 },
  iconGap: { width: 36 },
  list: { paddingHorizontal: 4, gap: 2 },
  grid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', columnGap: GRID_GAP, rowGap: GRID_GAP, justifyContent: 'center' },
  tile: { minHeight: 88, borderRadius: 14, borderCurve: 'continuous', padding: 8, alignItems: 'center', justifyContent: 'center', gap: 6 },
  tileLabel: { fontSize: 12, lineHeight: 15, textAlign: 'center' },
  webList: { maxHeight: 280, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, marginTop: 6 },
});

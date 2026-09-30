import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { MenuView } from '@expo/ui/community/menu';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { useAppearance, usePalette } from '@/theme/colors';
import { optionIcon, type OptionIcon } from '@/theme/editor-icons';

export type EditorMenuItem = { id: string; label: string; selected?: boolean; disabled?: boolean; onPress: () => void; icon?: OptionIcon };

const SHEET_AFTER = 6;

function iconFor(label: string, explicit?: OptionIcon) {
  if (explicit) return explicit;
  const simplified = label.trim().toLowerCase().replace(/^(show|hide) /, '').replace(/ stroke$/, '');
  return optionIcon(label) ?? (simplified === label.trim().toLowerCase() ? undefined : optionIcon(simplified));
}

/** Native menu for a short list. Longer lists open a native bottom sheet so every row can show its icon. */
export function EditorMenu({ label, items, disabled = false, compact = false, icon }: { label: string; items: EditorMenuItem[]; disabled?: boolean; compact?: boolean; icon?: OptionIcon }) {
  const [open, setOpen] = useState(false);
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const triggerIcon = icon ?? iconFor(label);
  const sheet = items.length > SHEET_AFTER || Platform.OS !== 'ios';
  const choose = (item: EditorMenuItem) => {
    setOpen(false);
    if (!disabled && !item.disabled) item.onPress();
  };
  const trigger = <Pressable accessibilityRole="button" accessibilityLabel={`${label}, show options`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(value => !value)}
    style={[styles.trigger, compact && styles.compact, { backgroundColor: colors.fieldSurface, borderColor: colors.separator, opacity: disabled ? .4 : 1 }]}>
    {triggerIcon && <UniversalIcon {...triggerIcon} size={20} color={colors.systemBlue} />}
    <ThemedText numberOfLines={1} style={[styles.triggerLabel, compact && styles.compactLabel]}>{label}</ThemedText>
    <UniversalIcon ios="chevron.down" android="expand-more" size={18} color={colors.secondaryLabel} />
  </Pressable>;
  const rows = items.map(item => {
    const rowIcon = iconFor(item.label, item.icon);
    const inactive = disabled || item.disabled;
    return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.selected, disabled: inactive }} disabled={inactive} onPress={() => choose(item)}
      style={[styles.row, { backgroundColor: item.selected ? colors.accentSurface : 'transparent', opacity: inactive ? .4 : 1 }]}>
      {rowIcon ? <UniversalIcon {...rowIcon} size={22} color={item.selected ? colors.systemBlue : colors.label} /> : <View style={styles.iconGap} />}
      <ThemedText style={[styles.rowLabel, item.selected && { color: colors.systemBlue, fontWeight: '700' }]}>{item.label}</ThemedText>
      {item.selected && <UniversalIcon ios="checkmark" android="check" size={18} color={colors.systemBlue} />}
    </Pressable>;
  });
  if (Platform.OS === 'web' || sheet) return <View style={styles.anchor}>
    {trigger}
    {Platform.OS !== 'web' && open && <Host colorScheme={mode} seedColor={colors.accent}>
      <BottomSheet isPresented={open} onDismiss={() => setOpen(false)} snapPoints={items.length > SHEET_AFTER ? ['half', 'full'] : ['half']} showDragIndicator containerColor={colors.systemBackground}>
        <RNHostView>
          <View style={{ backgroundColor: colors.systemBackground, paddingBottom: 12 }}>
            <ThemedText style={styles.sheetTitle}>{label}</ThemedText>
            <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">{rows}</ScrollView>
          </View>
        </RNHostView>
      </BottomSheet>
    </Host>}
    {Platform.OS === 'web' && open && <ScrollView style={[styles.webList, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]} keyboardShouldPersistTaps="handled">{rows}</ScrollView>}
  </View>;
  return <View pointerEvents={disabled ? 'none' : 'auto'} style={[styles.anchor, disabled && styles.dim]}>
    <MenuView title={label} colorScheme={mode} actions={items.map(item => ({ id: item.id, title: item.label, image: iconFor(item.label, item.icon)?.ios, state: item.selected ? 'on' as const : 'off' as const, attributes: { disabled: disabled || item.disabled } }))}
      onPressAction={({ nativeEvent }) => { const item = items.find(entry => entry.id === nativeEvent.event); if (item) choose(item); }}>
      <View accessible accessibilityRole="button" accessibilityLabel={`${label}, show options`} accessibilityState={{ disabled }}
        style={[styles.trigger, compact && styles.compact, { backgroundColor: colors.fieldSurface, borderColor: colors.separator }]}>
        {triggerIcon && <UniversalIcon {...triggerIcon} size={20} color={colors.systemBlue} />}
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
  compact: { maxWidth: 148, paddingHorizontal: 10 },
  triggerLabel: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  compactLabel: { fontSize: 13 },
  row: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12 },
  rowLabel: { flex: 1, fontSize: 16 },
  iconGap: { width: 22 },
  sheetTitle: { fontSize: 13, fontWeight: '700', opacity: 0.7, paddingHorizontal: 16, paddingBottom: 6 },
  sheetList: { maxHeight: 420 },
  webList: { maxHeight: 280, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, marginTop: 6 },
});

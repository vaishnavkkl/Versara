import { useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { MenuView } from '@expo/ui/community/menu';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { useAppearance, usePalette } from '@/theme/colors';
import type { OptionIcon } from '@/theme/editor-icons';

export type EditorMenuItem = { id: string; label: string; selected?: boolean; disabled?: boolean; onPress: () => void };

/** Native anchored menus dismiss on selection, outside tap, and system back. */
export function EditorMenu({ label, items, disabled = false, compact = false, icon }: { label: string; items: EditorMenuItem[]; disabled?: boolean; compact?: boolean; icon?: OptionIcon }) {
  const [open, setOpen] = useState(false);
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  if (Platform.OS === 'web') return <View style={{ alignSelf: 'flex-end', maxWidth: '100%' }}>
    <Pressable accessibilityLabel={`${label}, show options`} accessibilityRole="button" accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(value => !value)} style={compact ? { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.fieldSurface } : { minHeight: 52, padding: 16, borderRadius: 14, backgroundColor: colors.fieldSurface }}>{icon ? <UniversalIcon {...icon} size={22} color={colors.systemBlue} /> : <ThemedText>{label}</ThemedText>}</Pressable>
    {open && <ScrollView style={{ maxHeight: 280, backgroundColor: colors.systemBackground }} keyboardShouldPersistTaps="handled">
      {items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.selected, disabled: disabled || item.disabled }} disabled={disabled || item.disabled} onPress={() => { setOpen(false); item.onPress(); }} style={{ minHeight: 52, padding: 16, opacity: disabled || item.disabled ? .4 : 1, backgroundColor: item.selected ? colors.accentSurface : colors.systemBackground }}><ThemedText>{item.label}</ThemedText></Pressable>)}
    </ScrollView>}
  </View>;
  return <View pointerEvents={disabled ? 'none' : 'auto'} style={{ opacity: disabled ? .4 : 1, alignSelf: 'flex-end', maxWidth: '100%' }}>
    <MenuView title={label} colorScheme={mode} actions={items.map(item => ({ id: item.id, title: item.label, state: item.selected ? 'on' : 'off', attributes: { disabled: disabled || item.disabled } }))}
      onPressAction={({ nativeEvent }) => { const item = items.find(item => item.id === nativeEvent.event); if (!disabled && item && !item.disabled) item.onPress(); }}>
      <View accessible accessibilityRole="button" accessibilityLabel={`${label}, show options`} accessibilityState={{ disabled }} style={compact ? { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' } : { minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.systemBackground, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {icon && <UniversalIcon {...icon} size={22} color={colors.systemBlue} />}
        {!compact && <ThemedText style={{ fontSize: 15, fontWeight: '600', flexShrink: 1 }}>{label}</ThemedText>}
        {!compact && <UniversalIcon ios="chevron.down" android="expand-more" size={20} color={colors.label} />}
      </View>
    </MenuView>
  </View>;
}

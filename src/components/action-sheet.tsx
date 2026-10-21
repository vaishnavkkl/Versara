import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { create } from 'zustand';
import { AppBottomSheet } from './app-bottom-sheet';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import type { OptionIcon } from '@/theme/editor-icons';

export type SheetAction = { id: string; label: string; icon: OptionIcon; destructive?: boolean; disabled?: boolean; onPress: () => void };
type Sheet = { id: number; title: string; subtitle?: string; icon?: OptionIcon; actions: SheetAction[] };

let nextId = 0;
const useSheet = create<{ sheet: Sheet | null; open: boolean }>(() => ({ sheet: null, open: false }));

/** One file's actions in the app's bottom sheet, like a list row's More menu. Actions run after the sheet hides. */
export function showActionSheet(title: string, actions: SheetAction[], options: { subtitle?: string; icon?: OptionIcon } = {}) {
  useSheet.setState({ sheet: { id: ++nextId, title, actions, ...options }, open: true });
}

export function ActionSheetHost() {
  const colors = usePalette();
  const { sheet, open } = useSheet();
  const [chosen, setChosen] = useState<SheetAction | null>(null);
  if (!sheet) return null;
  return <AppBottomSheet key={sheet.id} visible={open} title={sheet.title} subtitle={sheet.subtitle} icon={sheet.icon} maxHeight={0.7} contentStyle={styles.list}
    onClose={() => useSheet.setState({ open: false })}
    onDismissed={() => { const action = chosen; setChosen(null); useSheet.setState({ sheet: null }); action?.onPress(); }}>
    {sheet.actions.map(action => {
      const tint = action.destructive ? colors.destructive : colors.label;
      return <Pressable key={action.id} accessibilityRole="button" accessibilityState={{ disabled: !!action.disabled }} disabled={action.disabled}
        onPress={() => { setChosen(action); useSheet.setState({ open: false }); }}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.accentSurface : 'transparent', opacity: action.disabled ? 0.4 : 1 }]}>
        <UniversalIcon {...action.icon} size={22} color={action.destructive ? colors.destructive : colors.systemBlue} />
        <ThemedText style={[styles.label, { color: tint }]}>{action.label}</ThemedText>
      </Pressable>;
    })}
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 4, gap: 2 },
  row: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12 },
  label: { flex: 1, fontSize: 16 },
});

import { Pressable, StyleSheet, View } from 'react-native';
import { create } from 'zustand';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing } from '@/theme/dashboard';

const LAYOUT_STORAGE_KEY = 'versara.layout.mode';
function storedGrid() {
  try { return localStorage.getItem(LAYOUT_STORAGE_KEY) !== 'list'; } catch { return true; }
}

/** One grid/list choice shared by every screen and kept across launches. */
const useLayoutStore = create<{ grid: boolean; setGrid: (grid: boolean) => void }>(set => ({
  grid: storedGrid(),
  setGrid: grid => {
    set({ grid });
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, grid ? 'grid' : 'list'); } catch { /* Optional preference. */ }
  },
}));

export function useLayoutPreference() {
  const grid = useLayoutStore(state => state.grid);
  const setGrid = useLayoutStore(state => state.setGrid);
  return [grid, setGrid] as const;
}

export function LayoutToggle({ gridAvailable = true }: { gridAvailable?: boolean }) {
  const [grid, setGrid] = useLayoutPreference();
  const colors = usePalette();
  return <View style={[styles.container, { backgroundColor: colors.fieldSurface }]}>
    {[false, true].map(value => <Pressable key={String(value)} accessibilityRole="button" accessibilityLabel={value ? 'Show as grid' : 'Show as list'} accessibilityHint={value && !gridAvailable ? 'List layout keeps tools readable at this screen or text size.' : undefined} accessibilityState={{ selected: (grid && gridAvailable) === value, disabled: value && !gridAvailable }} disabled={value && !gridAvailable} onPress={() => setGrid(value)}
      style={({ pressed }) => [styles.button, { backgroundColor: (grid && gridAvailable) === value ? colors.catalogSurface : 'transparent', opacity: value && !gridAvailable ? 0.35 : pressed ? 0.65 : 1 }]}>
      <UniversalIcon ios={value ? 'square.grid.2x2' : 'list.bullet'} android={value ? 'grid-view' : 'view-list'} size={18} color={(grid && gridAvailable) === value ? colors.systemBlue : colors.secondaryLabel} />
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: radius.md, borderCurve: 'continuous', padding: spacing.xs },
  button: { width: 48, minHeight: 48, borderRadius: radius.sm, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
});

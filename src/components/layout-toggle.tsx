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

export function LayoutToggle() {
  const [grid, setGrid] = useLayoutPreference();
  const colors = usePalette();
  return <View style={[styles.container, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}>
    {[false, true].map(value => <Pressable key={String(value)} accessibilityRole="button" accessibilityLabel={value ? 'Show as grid' : 'Show as list'} accessibilityState={{ selected: grid === value }} onPress={() => setGrid(value)}
      style={({ pressed }) => [styles.button, { backgroundColor: grid === value ? colors.accentSurface : 'transparent', opacity: pressed ? 0.65 : 1 }]}>
      <UniversalIcon ios={value ? 'square.grid.2x2' : 'list.bullet'} android={value ? 'grid-view' : 'view-list'} size={18} color={grid === value ? colors.systemBlue : colors.secondaryLabel} />
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, padding: spacing.xs },
  button: { width: 48, minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});

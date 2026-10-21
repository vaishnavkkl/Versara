import { StyleSheet, View } from 'react-native';
import { AppLoader } from './app-loader';
import { ThemedText } from './themed-text';
import { usePalette } from '@/theme/colors';

/**
 * Shown while a tool saves a result that opens by itself, so its result screen never flashes on the way.
 */
export function HandoffScreen({ label = 'Saving and opening your file…' }: { label?: string }) {
  const colors = usePalette();
  return <View style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <AppLoader size="large" />
    <ThemedText accessibilityLiveRegion="polite" style={[styles.label, { color: colors.secondaryLabel }]}>{label}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  label: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});

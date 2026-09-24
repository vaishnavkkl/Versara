import { Pressable, StyleSheet, View } from 'react-native';
import { UniversalIcon } from './universal-icon';
import { ThemedText } from './themed-text';
import { useAppearance, usePalette } from '@/theme/colors';
import { radius, spacing, typography } from '@/theme/dashboard';

export function AppearanceButtons({ compact = false }: { compact?: boolean } = {}) {
  const { mode, setMode } = useAppearance();
  const colors = usePalette();
  return (
    <View style={[styles.container, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}>
      {(['light', 'dark'] as const).map(value => (
        <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Use ${value} mode`} accessibilityState={{ selected: mode === value }} onPress={() => setMode(value)} style={({ pressed }) => [styles.button, compact && styles.compact, { backgroundColor: mode === value ? colors.accentSurface : 'transparent', opacity: pressed ? 0.65 : 1 }]}>
          <UniversalIcon ios={value === 'light' ? 'sun.max' : 'moon'} android={value === 'light' ? 'light-mode' : 'dark-mode'} color={mode === value ? colors.systemBlue : colors.secondaryLabel} size={18} />
          {!compact && <ThemedText style={[styles.label, { color: mode === value ? colors.systemBlue : colors.secondaryLabel }]}>{value === 'light' ? 'Light' : 'Dark'}</ThemedText>}
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, padding: spacing.xs },
  button: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  label: { ...typography.caption },
  compact: { width: 48, minHeight: 48, paddingHorizontal: 0 },
});

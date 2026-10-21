import { Pressable, StyleSheet, View } from 'react-native';
import { UniversalIcon } from './universal-icon';
import { ThemedText } from './themed-text';
import { useAppearance, usePalette, type ThemePreference } from '@/theme/colors';
import { radius, spacing, typography } from '@/theme/dashboard';

type Icon = React.ComponentProps<typeof UniversalIcon>;
const CHOICES: { value: ThemePreference; label: string; ios: Icon['ios']; android: Icon['android'] }[] = [
  { value: 'system', label: 'System', ios: 'circle.lefthalf.filled', android: 'brightness-auto' },
  { value: 'light', label: 'Light', ios: 'sun.max', android: 'light-mode' },
  { value: 'dark', label: 'Dark', ios: 'moon', android: 'dark-mode' },
];

export function AppearanceButtons({ compact = false }: { compact?: boolean } = {}) {
  const preference = useAppearance(state => state.preference);
  const setPreference = useAppearance(state => state.setPreference);
  const colors = usePalette();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={[styles.container, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}>
      {CHOICES.map(({ value, label, ios, android }) => {
        const selected = preference === value;
        return <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value === 'system' ? 'Match device theme' : `Use ${value} mode`} accessibilityState={{ selected }} onPress={() => setPreference(value)} style={({ pressed }) => [styles.button, compact && styles.compact, { backgroundColor: selected ? colors.accentSurface : 'transparent', opacity: pressed ? 0.65 : 1 }]}>
          <UniversalIcon ios={ios} android={android} color={selected ? colors.systemBlue : colors.secondaryLabel} size={18} />
          {!compact && <ThemedText style={[styles.label, { color: selected ? colors.systemBlue : colors.secondaryLabel }]}>{label}</ThemedText>}
        </Pressable>;
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, padding: spacing.xs },
  button: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  label: { ...typography.caption },
  compact: { width: 48, minHeight: 48, paddingHorizontal: 0 },
});

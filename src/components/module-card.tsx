import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing, typography } from '@/theme/dashboard';
import type { ComponentProps } from 'react';

type Props = {
  title: string;
  description: string;
  ios: ComponentProps<typeof UniversalIcon>['ios'];
  android: ComponentProps<typeof UniversalIcon>['android'];
  onPress: () => void;
  detail?: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'tool' | 'dashboard' | 'compact';
  style?: StyleProp<ViewStyle>;
};
export function ModuleCard({ title, description, ios, android, onPress, detail, loading = false, disabled = false, variant = 'tool', style }: Props) {
  const colors = usePalette();
  const compact = variant === 'compact';
  const dashboard = variant === 'dashboard' || compact;
  const gradients = getGradients(colors);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${loading ? 'Opening files' : description}`} accessibilityState={{ busy: loading, disabled }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.card, dashboard ? gradients.module : gradients.card, { backgroundColor: dashboard ? colors.moduleEnd : colors.secondarySystemBackground, borderColor: dashboard ? colors.moduleBorder : colors.borderHighlight, boxShadow: dashboard ? colors.moduleShadow : colors.cardShadow, opacity: pressed ? 0.82 : disabled && !loading ? 0.55 : 1 }, dashboard && [styles.dashboard, { borderTopColor: colors.moduleHighlight }], compact && styles.compact, style]}>
      <View style={styles.top}>
        <View style={[styles.icon, !dashboard && gradients.icon, { backgroundColor: dashboard ? colors.moduleIconSurface : colors.iconEnd, borderColor: dashboard ? colors.moduleIconBorder : colors.iconBorder }]}>{loading ? <ActivityIndicator color={colors.onAccent} /> : <UniversalIcon ios={ios} android={android} size={24} color={colors.onAccent} />}</View>
        {!compact && <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={dashboard ? colors.moduleDescription : colors.muted} />}
      </View>
      <View style={styles.text}><ThemedText style={[styles.title, dashboard && styles.dashboardTitle, compact && styles.compactTitle, { color: dashboard ? colors.moduleText : colors.label }]}>{title}</ThemedText><ThemedText style={[styles.description, compact && styles.compactDescription, { color: dashboard ? colors.moduleDescription : colors.secondaryLabel }]}>{loading ? 'Opening files...' : description}</ThemedText></View>
      {detail && <ThemedText style={[styles.detail, { color: dashboard ? colors.moduleDescription : colors.systemBlue }]}>{detail}</ThemedText>}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: { overflow: 'hidden', flex: 1, minWidth: 0, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, borderCurve: 'continuous' },
  dashboard: { minHeight: 148, padding: spacing.lg, gap: spacing.md, borderRadius: radius.lg },
  dashboardTitle: { ...typography.moduleTitle },
  compact: { minHeight: 120, padding: spacing.sm, gap: spacing.sm, borderRadius: radius.md },
  compactTitle: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  compactDescription: { fontSize: 12, lineHeight: 16, minHeight: 48, fontWeight: '400' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  icon: { width: 40, height: 40, borderWidth: 1, borderRadius: radius.sm, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  text: { gap: spacing.xs, flex: 1 },
  title: { ...typography.label },
  description: { ...typography.caption },
  detail: { ...typography.caption },
});

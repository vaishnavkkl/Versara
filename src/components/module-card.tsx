import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { getGradients, gradient, radius, spacing, typography } from '@/theme/dashboard';
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
  variant?: 'tool' | 'dashboard' | 'compact' | 'list';
  /** Six-digit hex pair; gives the card a tinted gradient surface and a gradient icon tile. */
  tint?: readonly [string, string];
  style?: StyleProp<ViewStyle>;
};
export function ModuleCard({ title, description, ios, android, onPress, detail, loading = false, disabled = false, variant = 'tool', tint, style }: Props) {
  const colors = usePalette();
  const compact = variant === 'compact';
  const dashboard = variant === 'dashboard' || compact;
  const gradients = getGradients(colors);
  if (tint) {
    const list = variant === 'list';
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${loading ? 'Opening files' : description}`} accessibilityState={{ busy: loading, disabled }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.tile, list && styles.list, gradient(`linear-gradient(${list ? 100 : 150}deg, ${tint[0]}${colors.tileTint} 0%, ${tint[1]}0D 45%, ${colors.tileSurface} 75%)`), { backgroundColor: colors.tileSurface, borderColor: colors.tileBorder, boxShadow: colors.tileShadow, opacity: pressed ? 0.8 : disabled && !loading ? 0.55 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}>
        <View style={[styles.tileIcon, gradient(`linear-gradient(145deg, ${tint[1]} 0%, ${tint[0]} 100%)`), { backgroundColor: tint[0], boxShadow: `0 6px 14px ${tint[0]}59` }]}>{loading ? <AppLoader color="#FFFFFF" /> : <UniversalIcon ios={ios} android={android} size={28} color="#FFFFFF" />}</View>
        <View style={[styles.tileText, list && { flex: 1 }]}>
          <ThemedText numberOfLines={1} style={[styles.tileTitle, { color: colors.label }]}>{title}</ThemedText>
          <ThemedText numberOfLines={2} style={[styles.tileDescription, { color: colors.secondaryLabel }]}>{loading ? 'Opening files...' : description}</ThemedText>
          {detail && <ThemedText style={[styles.tileDetail, { color: colors.muted }]}>{detail}</ThemedText>}
        </View>
        {list && <UniversalIcon ios="chevron.right" android="chevron-right" size={16} color={colors.muted} />}
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${loading ? 'Opening files' : description}`} accessibilityState={{ busy: loading, disabled }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.card, dashboard ? gradients.module : gradients.card, { backgroundColor: dashboard ? colors.moduleEnd : colors.secondarySystemBackground, borderColor: dashboard ? colors.moduleBorder : colors.borderHighlight, boxShadow: dashboard ? colors.moduleShadow : colors.cardShadow, opacity: pressed ? 0.82 : disabled && !loading ? 0.55 : 1 }, dashboard && [styles.dashboard, { borderTopColor: colors.moduleHighlight }], compact && styles.compact, variant === 'list' && styles.list, style]}>
      <View style={styles.top}>
        <View style={[styles.icon, !dashboard && gradients.icon, { backgroundColor: dashboard ? colors.moduleIconSurface : colors.iconEnd, borderColor: dashboard ? colors.moduleIconBorder : colors.iconBorder }]}>{loading ? <AppLoader color={colors.onAccent} /> : <UniversalIcon ios={ios} android={android} size={24} color={colors.onAccent} />}</View>
        {!compact && variant !== 'list' && <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={dashboard ? colors.moduleDescription : colors.muted} />}
      </View>
      <View style={[styles.text, variant === 'list' && { flex: 1 }]}><ThemedText style={[styles.title, dashboard && styles.dashboardTitle, compact && styles.compactTitle, { color: dashboard ? colors.moduleText : colors.label }]}>{title}</ThemedText><ThemedText style={[styles.description, compact && styles.compactDescription, { color: dashboard ? colors.moduleDescription : colors.secondaryLabel }]}>{loading ? 'Opening files...' : description}</ThemedText></View>
      {detail && <ThemedText style={[styles.detail, { color: dashboard ? colors.moduleDescription : colors.systemBlue }]}>{detail}</ThemedText>}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  list: { flexDirection: 'row', alignItems: 'center', minHeight: 72 },
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
  tile: { flex: 1, minWidth: 0, padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, borderCurve: 'continuous' },
  tileIcon: { width: 52, height: 52, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  tileText: { gap: 2 },
  tileTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700', letterSpacing: -0.3 },
  tileDescription: { fontSize: 12, lineHeight: 16 },
  tileDetail: { fontSize: 11, lineHeight: 15, fontWeight: '600', marginTop: 2 },
});

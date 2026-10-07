import { memo, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { softFill } from '@/theme/tool-colors';
import { catalog, moduleColors, motion, spacing as s, typography as t, type ModuleTone } from '@/theme/dashboard';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_EASE = cubicBezier(0.23, 1, 0.32, 1);
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
  tone?: ModuleTone;
  style?: StyleProp<ViewStyle>;
};

/** Grid and list are arrangements of the same card, with identical type, surfaces and states. */
export const ModuleCard = memo(function ModuleCard({ title, description, ios, android, onPress, detail, loading = false, disabled = false, variant = 'tool', tone = 'default', style }: Props) {
  const colors = usePalette();
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const list = variant === 'list';
  const accent = moduleColors(colors, tone);
  const blocked = disabled || loading;
  const toolCard = variant !== 'dashboard';
  const icon = <View style={[styles.icon, toolCard && styles.toolIcon, tone === 'default' ? { backgroundColor: accent.surface } : softFill(accent.ink, colors.systemBackground === '#000000')]}>
    {loading ? <AppLoader color={accent.ink} /> : <UniversalIcon ios={ios} android={android} size={toolCard ? 28 : 24} color={accent.ink} />}
  </View>;
  const disclosure = !blocked && <View style={[styles.arrow, { backgroundColor: colors.accentSurface }]}>
    <UniversalIcon ios="arrow.right" android="mdi:arrow-right" size={18} color={colors.systemBlue} />
  </View>;
  return <AnimatedPressable
    accessibilityRole="button" accessibilityLabel={[title, loading ? 'Opening files' : description, detail].filter(Boolean).join('. ')}
    accessibilityState={{ busy: loading, disabled: blocked }} disabled={blocked} onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} pressRetentionOffset={8}
    style={[styles.card, list ? styles.list : styles.grid, {
      backgroundColor: pressed ? colors.catalogPressed : colors.catalogSurface,
      borderColor: colors.catalogBorder,
      opacity: disabled && !loading ? 0.6 : 1,
      transform: [{ scale: pressed && !list && !reduced ? 0.98 : 1 }],
      transitionProperty: ['transform', 'backgroundColor'], transitionDuration: reduced ? 0 : motion.feedback, transitionTimingFunction: PRESS_EASE,
    }, style]}>
    {list ? icon : <View style={styles.top}>{icon}{disclosure}</View>}
    <View style={[styles.text, list && styles.grow]}>
      <ThemedText style={[styles.title, { color: colors.label }]}>{title}</ThemedText>
      <ThemedText style={[styles.description, { color: colors.secondaryLabel }]}>{loading ? 'Opening files...' : description}</ThemedText>
      {!!detail && <ThemedText style={[styles.detail, { color: colors.secondaryLabel }]}>{detail}</ThemedText>}
    </View>
    {list && disclosure}
  </AnimatedPressable>;
});

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, padding: s.lg, gap: s.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: catalog.cardRadius, borderCurve: 'continuous' },
  grid: { minHeight: catalog.gridMinHeight },
  list: { flexDirection: 'row', alignItems: 'center', minHeight: 92 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: s.sm },
  icon: { width: catalog.iconSize, height: catalog.iconSize, borderRadius: catalog.iconRadius, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  toolIcon: { width: 52, height: 52, borderRadius: 16 },
  arrow: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  text: { gap: s.xs },
  title: { ...t.catalogTitle },
  description: { ...t.catalogDescription },
  detail: { ...t.caption, paddingTop: s.xs },
});

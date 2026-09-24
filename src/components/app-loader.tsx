import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { create } from 'zustand';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing, typography } from '@/theme/dashboard';

// Logo card colours: picture, video, audio, back card.
const BRAND = ['#1473F0', '#6F5BF2', '#26D07A', '#1BB4EE'];
const SIZES = { small: 22, large: 44 } as const;
const CYCLE_MS = 1400;

function Tile({ index, progress, color, tile, gap, reduced }: { index: number; progress: SharedValue<number>; color: string; tile: number; gap: number; reduced: boolean }) {
  // Tiles pulse in turn around the square: top-left, top-right, bottom-right, bottom-left.
  const order = [0, 1, 3, 2][index];
  const style = useAnimatedStyle(() => {
    if (reduced) return { opacity: 1, transform: [{ scale: 1 }] };
    const phase = (progress.value - order / 4 + 1) % 1;
    const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    return { opacity: 0.45 + 0.55 * wave, transform: [{ scale: 0.62 + 0.38 * wave }] };
  });
  return <Animated.View style={[{ position: 'absolute', width: tile, height: tile, borderRadius: tile * 0.32, backgroundColor: color,
    left: index % 2 ? tile + gap : 0, top: index > 1 ? tile + gap : 0 }, style]} />;
}

/** Versara's activity indicator: the four logo tiles pulse in turn while the mark turns slowly. */
export function AppLoader({ size = 'small', color, style, accessibilityLabel = 'Loading' }: { size?: 'small' | 'large' | number; color?: string; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const spin = useSharedValue(0);
  const box = typeof size === 'number' ? size : SIZES[size];
  const gap = Math.max(2, box * 0.1);
  const tile = (box - gap) / 2;
  useEffect(() => {
    if (reduced) return;
    progress.value = withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
    spin.value = withRepeat(withTiming(1, { duration: CYCLE_MS * 4, easing: Easing.linear }), -1, false);
    return () => { cancelAnimation(progress); cancelAnimation(spin); };
  }, [reduced, progress, spin]);
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  return <View pointerEvents="none" style={[styles.center, style]}>
    <Animated.View accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} style={[{ width: box, height: box }, turn]}>
      {[0, 1, 2, 3].map(index => <Tile key={index} index={index} progress={progress} color={color ?? BRAND[index]} tile={tile} gap={gap} reduced={reduced} />)}
    </Animated.View>
  </View>;
}

const SHOW_DELAY_MS = 250;
let nextToken = 0;
const useLoading = create<{ tasks: { token: number; message: string }[] }>(() => ({ tasks: [] }));

/** Shows the full-screen loader until the returned function is called. */
export function showLoading(message: string) {
  const token = ++nextToken;
  useLoading.setState(state => ({ tasks: [...state.tasks, { token, message }] }));
  return () => useLoading.setState(state => ({ tasks: state.tasks.filter(task => task.token !== token) }));
}

/** Runs a long task behind the full-screen loader. */
export async function withLoading<T>(message: string, task: () => Promise<T>): Promise<T> {
  const hide = showLoading(message);
  try { return await task(); } finally { hide(); }
}

/** Mounted once at the root. Waits briefly so quick tasks never flash the overlay. */
export function LoadingHost() {
  const colors = usePalette();
  const task = useLoading(state => state.tasks[state.tasks.length - 1]);
  const first = useLoading(state => state.tasks[0]?.token ?? 0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!first) return;
    const timer = setTimeout(() => setShown(first), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [first]);
  return <Modal visible={!!first && shown === first} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => {}}>
    <View style={[styles.backdrop, { backgroundColor: `${colors.systemBackground}B3` }]}>
      <View accessibilityViewIsModal accessibilityLiveRegion="polite" style={[styles.card, getGradients(colors).module, { borderColor: colors.moduleBorder, boxShadow: colors.moduleShadow }]}>
        <AppLoader size="large" accessibilityLabel={task?.message ?? 'Working'} />
        {!!task?.message && <ThemedText style={[styles.message, { color: colors.moduleText }]}>{task.message}</ThemedText>}
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { minWidth: 180, maxWidth: 320, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl, alignItems: 'center', gap: spacing.lg },
  message: { ...typography.body, textAlign: 'center', fontWeight: '600' },
});

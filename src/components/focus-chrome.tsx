import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, FadeOut, FadeOutDown, FadeOutUp, LinearTransition, ReduceMotion } from 'react-native-reanimated';

const DURATION = 220;
const entering = { top: FadeInUp, bottom: FadeInDown, side: FadeIn } as const;
const exiting = { top: FadeOutUp, bottom: FadeOutDown, side: FadeOut } as const;

/** Viewer content that grows into the space reader controls leave in focus mode. */
export const focusLayout = LinearTransition.duration(DURATION).reduceMotion(ReduceMotion.System);

/**
 * `focusLayout` unless the tool ring owns the layout. The screen header leaves one commit after the ring opens,
 * which can interrupt the transition and strand the page partly under the system navigation bar.
 */
export function useFocusLayout(surrounding: boolean) {
  const [held, setHeld] = useState(surrounding);
  if (surrounding && !held) setHeld(true);
  useEffect(() => {
    if (surrounding || !held) return;
    const timer = setTimeout(() => setHeld(false), DURATION * 2);
    return () => clearTimeout(timer);
  }, [surrounding, held]);
  return held ? undefined : focusLayout;
}

/**
 * Reader controls that slide away in focus mode and back when it ends.
 * They draw above the page while leaving, so the page grows underneath them.
 */
export function FocusChrome({ edge, style, children }: { edge: 'top' | 'bottom' | 'side'; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <Animated.View style={[styles.chrome, edge === 'side' && styles.side, style]}
    entering={entering[edge].duration(DURATION).reduceMotion(ReduceMotion.System)}
    exiting={exiting[edge].duration(DURATION).reduceMotion(ReduceMotion.System)}>
    {children}
  </Animated.View>;
}

// Side rails keep stretching to the full height of the row they sit in.
const styles = StyleSheet.create({ chrome: { zIndex: 1 }, side: { flexDirection: 'row' } });

/**
 * For each view between the screen and the tool ring while the ring is shown. Leaving chrome can linger
 * invisibly on Android; drawing the ring above it keeps every tile tappable.
 */
export const aboveChrome = { zIndex: 2 } as const;

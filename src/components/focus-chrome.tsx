import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, FadeOut, FadeOutDown, FadeOutUp, LinearTransition, ReduceMotion } from 'react-native-reanimated';

const DURATION = 220;
const entering = { top: FadeInUp, bottom: FadeInDown, side: FadeIn } as const;
const exiting = { top: FadeOutUp, bottom: FadeOutDown, side: FadeOut } as const;

/** Viewer content that grows into the space reader controls leave in focus mode. */
export const focusLayout = LinearTransition.duration(DURATION).reduceMotion(ReduceMotion.System);

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

import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useControlHelp } from './control-help';
import { HeaderGlyph } from './app-glyph';
import { headerButtonStyle } from './header-actions';

/** `intercept` returns true when the screen handled the press itself instead of opening the guide. */
export function HelpButton({ tool, intercept }: { tool?: string; intercept?: () => boolean }) {
  const help = useControlHelp();
  const cue = help?.cue ?? 0;
  const scale = useSharedValue(1);
  // A stray touch in help mode bounces the ? button so the way out is obvious.
  useEffect(() => {
    if (!cue) return;
    const step = (value: number) => withTiming(value, { duration: 140, reduceMotion: ReduceMotion.System });
    scale.set(withSequence(step(1.2), step(0.95), step(1.15), step(1)));
  }, [cue, scale]);
  const pulse = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const showing = !!help?.showing;
  return <Pressable accessibilityRole="button" accessibilityLabel={help ? (showing ? 'Close control help' : 'Explain controls on this screen') : tool ? `How to use ${tool}` : 'Quick guide and practice demo'} accessibilityState={help ? { selected: showing } : undefined} onPress={() => { if (intercept?.()) return; if (help) { help.toggle(); return; } router.push({ pathname: '/guide', params: tool ? { tool } : {} }); }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}>
    <Animated.View style={pulse}><HeaderGlyph id="help" ios="questionmark.circle" android="help-outline" selected={showing} /></Animated.View>
  </Pressable>;
}
const styles = StyleSheet.create({ button: headerButtonStyle });

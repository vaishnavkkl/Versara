import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { useControlHelp } from './control-help';

/** `intercept` returns true when the screen handled the press itself instead of opening the guide. */
export function HelpButton({ tool, intercept }: { tool?: string; intercept?: () => boolean }) {
  const colors = usePalette();
  const help = useControlHelp();
  return <Pressable accessibilityRole="button" accessibilityLabel={help ? (help.active ? 'Close control help' : 'Explain controls on this screen') : tool ? `How to use ${tool}` : 'Quick guide and practice demo'} accessibilityState={help ? { selected: help.active } : undefined} onPress={() => { if (intercept?.()) return; if (help) { help.toggle(); return; } router.push({ pathname: '/guide', params: tool ? { tool } : {} }); }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1, backgroundColor: help?.active ? colors.accentSurface : 'transparent', borderRadius: 12 }]}><UniversalIcon ios="questionmark.circle" android="help-outline" size={24} color={colors.systemBlue} /></Pressable>;
}
const styles = StyleSheet.create({ button: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' } });

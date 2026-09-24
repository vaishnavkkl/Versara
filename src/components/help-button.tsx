import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';

export function HelpButton({ tool }: { tool?: string }) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={tool ? `How to use ${tool}` : 'Quick guide and practice demo'} onPress={() => router.push({ pathname: '/guide', params: tool ? { tool } : {} })} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}><UniversalIcon ios="questionmark.circle" android="help-outline" size={24} color={colors.systemBlue} /></Pressable>;
}
const styles = StyleSheet.create({ button: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' } });

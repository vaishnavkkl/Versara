import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePalette } from '@/theme/colors';

export default function ModuleLayout() {
  const colors = usePalette();
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.systemBackground }}>
    <Stack screenOptions={{ headerShown: false, animation: 'none', freezeOnBlur: true }} />
  </SafeAreaView>;
}

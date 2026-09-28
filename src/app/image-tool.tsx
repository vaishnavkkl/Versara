import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdvancedImageToolScreen } from '@/features/files/advanced-image-tool';
import { usePalette } from '@/theme/colors';

export default function ImageToolRoute() {
  const { id, tool } = useLocalSearchParams<{ id: string; tool: string }>();
  const colors = usePalette();
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.systemBackground }}><AdvancedImageToolScreen key={`${id}:${tool}`} id={id} tool={tool} /></SafeAreaView>;
}

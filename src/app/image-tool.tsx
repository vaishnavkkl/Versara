import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { recordToolUse } from '@/features/search/search-history';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdvancedImageToolScreen } from '@/features/files/advanced-image-tool';
import { usePalette } from '@/theme/colors';
import { ImageToolGate } from '@/components/image-tool-gate';

export default function ImageToolRoute() {
  const { id, tool } = useLocalSearchParams<{ id: string; tool: string }>();
  const colors = usePalette();
  useEffect(() => { if (tool) recordToolUse(`Image:${tool}`); }, [tool]);
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.systemBackground }}><ImageToolGate key={`${id}:${tool}`}><AdvancedImageToolScreen key={`${id}:${tool}`} id={id} tool={tool} /></ImageToolGate></SafeAreaView>;
}

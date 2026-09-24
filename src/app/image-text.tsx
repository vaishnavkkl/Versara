import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageTextEditorScreen } from '@/features/files/image-text-editor';

export default function ImageTextRoute() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1 }}>
    <ImageTextEditorScreen key={id + (mode ?? '')} id={id} mode={mode === 'add' ? 'add' : 'edit'} />
  </SafeAreaView>;
}

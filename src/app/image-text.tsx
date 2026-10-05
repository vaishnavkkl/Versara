import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageTextEditorScreen } from '@/features/files/image-text-editor';
import { ImageToolGate } from '@/components/image-tool-gate';

export default function ImageTextRoute() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1 }}>
    <ImageToolGate key={`${id}:${mode}`}><ImageTextEditorScreen key={id + (mode ?? '')} id={id} mode={mode === 'add' ? 'add' : 'edit'} /></ImageToolGate>
  </SafeAreaView>;
}

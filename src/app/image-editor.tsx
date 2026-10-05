import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageEditorScreen, type EditorTab } from '@/features/files/image-editor';
import { ImageToolGate } from '@/components/image-tool-gate';

export default function ImageEditorRoute() {
  const { id, tab, tool } = useLocalSearchParams<{ id: string; tab?: EditorTab; tool?: string }>();
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1 }}>
    <ImageToolGate key={`${id}:${tab}:${tool}`}><ImageEditorScreen key={id} id={id} initialTab={tab} tool={tool} /></ImageToolGate>
  </SafeAreaView>;
}

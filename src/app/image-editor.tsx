import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageEditorScreen, type EditorTab } from '@/features/files/image-editor';

export default function ImageEditorRoute() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: EditorTab }>();
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1 }}>
    <ImageEditorScreen key={id} id={id} initialTab={tab} />
  </SafeAreaView>;
}

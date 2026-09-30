import { DocEditorScreen } from '@/features/documents/doc-editor-screen';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function Screen() {
  const params = useLocalSearchParams<{ uri?: string; name?: string; format?: string; blank?: string }>();
  if (params.uri && params.format !== 'txt' && !params.name?.toLowerCase().endsWith('.txt') && params.blank !== '1') {
    return <Redirect href={{ pathname: '/doc-reader', params: { uri: params.uri, name: params.name ?? 'Document' } }} />;
  }
  return <DocEditorScreen />;
}

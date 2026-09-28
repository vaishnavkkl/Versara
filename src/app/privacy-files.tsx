import { useCallback, useRef } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RecentFilesScreen } from '@/features/files/recent-files-screen';
import type { RecentFile } from '@/features/files/recent-files';
import { openPrivacyTool } from '@/features/privacy/open-privacy-tool';
import { getPrivacyTool } from '@/features/privacy/privacy-tools';
import { usePalette } from '@/theme/colors';

export default function PrivacyFilesRoute() {
  const { mode = 'scan' } = useLocalSearchParams<{ mode?: string }>();
  const tool = getPrivacyTool(mode) ?? getPrivacyTool('scan')!;
  const colors = usePalette();
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; };
  }, []));
  const select = useCallback((file: RecentFile) => openPrivacyTool(tool.id, {
    id: file.id, current: () => focused.current,
  }), [tool.id]);
  const kind = tool.id === 'remove_text' || tool.id === 'pdf_scan' ? 'pdf' : 'image';
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.systemBackground }}>
    <Stack.Screen options={{ headerShown: false, animation: 'none' }} />
    <RecentFilesScreen kind={kind} onSelect={select} selectionTitle={kind === 'pdf' ? 'Choose PDF' : 'Choose image'} />
  </SafeAreaView>;
}

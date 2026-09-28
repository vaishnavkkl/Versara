import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { ToolButton } from '@/components/tool-button';
import { ThemedText } from '@/components/themed-text';
import { FileExplorerScreen } from '@/features/files/file-explorer-screen';
import { finishFilePicker, getFilePickerRequest } from '@/features/files/file-picker-session';
import { usePalette } from '@/theme/colors';
import type { ExplorerEntry } from '../../modules/file-engine';

export default function FilePickerRoute() {
  const { request: id = '' } = useLocalSearchParams<{ request: string }>();
  const [request] = useState(() => getFilePickerRequest(id));
  const [selected, setSelected] = useState<ExplorerEntry[]>([]);
  const [error, setError] = useState('');
  const result = useRef<ExplorerEntry[] | null>([]);
  const leaving = useRef(false), mounted = useRef(true);
  const colors = usePalette();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Resolve only after the picker route leaves; imports must not open another
      // editor while the file selector is still the current route.
      queueMicrotask(() => {
        if (mounted.current) return;
        requestAnimationFrame(() => requestAnimationFrame(() => finishFilePicker(id, result.current)));
      });
    };
  }, [id]);
  const close = useCallback((files: ExplorerEntry[] | null) => {
    if (leaving.current) return;
    leaving.current = true; result.current = files;
    if (router.canGoBack()) router.back(); else router.replace('/(tabs)');
  }, []);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { close([]); return true; });
    return () => subscription.remove();
  }, [close]));
  const select = useCallback((file: ExplorerEntry) => {
    if (!request || leaving.current) return;
    if (request.limit === 1) { close([file]); return; }
    const existing = selected.some(item => item.path === file.path);
    if (!existing && selected.length >= request.limit) { setError(`Choose up to ${request.limit} files.`); return; }
    setError(''); setSelected(existing ? selected.filter(item => item.path !== file.path) : [...selected, file]);
  }, [request, close, selected]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.systemBackground }} edges={['top', 'bottom', 'left', 'right']}>
    <ScreenHeader title={request?.kind === 'image' ? 'Choose image' : request?.kind === 'pdf' ? 'Choose PDF' : 'Choose files'} onBack={() => close([])} />
    {request ? <FileExplorerScreen picker={{ kind: request.kind, selected, onSelect: select }} /> : <ThemedText>This file selection has expired. Go back and try again.</ThemedText>}
    <View style={{ padding: 12, gap: 8 }}>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!!request && request.limit > 1 && <ToolButton title={`Use ${selected.length} files`} disabled={!selected.length} onPress={() => close(selected)} />}
      <ToolButton title="Use system file picker" secondary onPress={() => close(null)} />
    </View>
  </SafeAreaView>;
}

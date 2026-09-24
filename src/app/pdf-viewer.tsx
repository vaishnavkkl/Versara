import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { HelpButton } from '@/components/help-button';
import { PdfViewer } from '@/features/pdf/pdf-viewer';
import { usePalette } from '@/theme/colors';

export default function PdfViewerScreen() {
  const { uri, name, page } = useLocalSearchParams<{ uri: string; name?: string; page?: string }>();
  const colors = usePalette();
  const [focused, setFocused] = useState(false);
  function back() { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/documents'); }
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    {!focused && <ScreenHeader variant="close" title={name ?? 'PDF'} onBack={back}><HelpButton tool="viewer" /></ScreenHeader>}
    <PdfViewer key={uri} initialDocument={uri ? { uri, name: name ?? 'Document.pdf' } : undefined} initialPage={Math.max(0, Number.parseInt(page ?? '0', 10) || 0)} onFocusChange={setFocused} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1 } });

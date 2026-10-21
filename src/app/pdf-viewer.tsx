import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ReaderScreenHeader as ScreenHeader } from '@/components/tool-screen-header';
import { PdfViewer } from '@/features/pdf/pdf-viewer';
import { handleReaderBack, handleReaderHelp } from '@/features/pdf/reader-back';
import { usePalette } from '@/theme/colors';
import { ControlHelpProvider, useControlHelp } from '@/components/control-help';
import { FocusChrome } from '@/components/focus-chrome';
import { LayoutAnimationConfig } from 'react-native-reanimated';

export default function PdfViewerScreen() {
  return <ControlHelpProvider><PdfViewerContent /></ControlHelpProvider>;
}

function PdfViewerContent() {
  const { uri, name, page, revision } = useLocalSearchParams<{ uri: string; name?: string; page?: string; revision?: string }>();
  const colors = usePalette();
  const help = useControlHelp();
  const [focused, setFocused] = useState(false);
  const [surrounding, setSurrounding] = useState(false);
  function back() { if (help?.close() || handleReaderBack()) return; if (router.canGoBack()) router.back(); else router.replace('/(modules)/documents'); }
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <LayoutAnimationConfig skipEntering>
      {!focused && !surrounding && <FocusChrome edge="top"><ScreenHeader title={name ?? 'PDF'} onBack={back} tool="viewer" helpIntercept={handleReaderHelp} /></FocusChrome>}
      <PdfViewer key={`${uri}:${revision}`} initialDocument={uri ? { uri, name: name ?? 'Document.pdf' } : undefined} initialPage={Math.max(0, Number.parseInt(page ?? '0', 10) || 0)} onFocusChange={setFocused} onSurroundChange={setSurrounding} />
    </LayoutAnimationConfig>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1 } });

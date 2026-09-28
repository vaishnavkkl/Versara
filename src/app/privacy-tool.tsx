import { useEffect, useRef, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrivacyEditor } from '@/features/privacy/privacy-editor';
import { usePalette } from '@/theme/colors';
import { openPrivacyTool } from '@/features/privacy/open-privacy-tool';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { View } from 'react-native';
import type { PrivacyMode } from '@/features/privacy/privacy-tools';

function ExistingPrivacyTool({ mode, id }: { mode: PrivacyMode; id?: string }) {
  const started = useRef(false), mounted = useRef(true);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void openPrivacyTool(mode, { id, replace: true, current: () => mounted.current }).then(opened => {
        if (!opened && mounted.current) { if (router.canGoBack()) router.back(); else router.replace('/(modules)/privacy'); }
      }).catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not open this tool.'); });
    }
    return () => { mounted.current = false; };
  }, [mode, id]);
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
    {error ? <><ThemedText accessibilityRole="alert">{error}</ThemedText><ToolButton title="Back to Privacy" onPress={() => router.replace('/(modules)/privacy')} /></> : <><AppLoader /><ThemedText>Choose a file to continue.</ThemedText></>}
  </View>;
}

export default function PrivacyToolRoute() {
  const { id, mode, session } = useLocalSearchParams<{ id?: string; mode?: string; session?: string }>();
  const colors = usePalette();
  const selectedMode = mode === 'metadata' || mode === 'redact' || mode === 'remove_text' || mode === 'pdf_scan' ? mode : 'scan';
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.systemBackground }}>
    <Stack.Screen options={{ gestureEnabled: false }} />
    {id && (selectedMode === 'scan' || selectedMode === 'pdf_scan') ? <PrivacyEditor key={session ?? id ?? selectedMode} id={id} mode={selectedMode} /> : <ExistingPrivacyTool mode={selectedMode} id={id} />}
  </SafeAreaView>;
}

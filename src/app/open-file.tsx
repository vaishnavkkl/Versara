import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { importExternalFile } from '@/features/files/recent-files';
import { stagePreviewFile } from '@/features/files/preview-handoff';
import { usePalette } from '@/theme/colors';

/** Imports a PDF or image opened from another app, then shows it in the matching viewer. */
export default function OpenFileScreen() {
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const colors = usePalette();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!uri) return;
    let active = true;
    void importExternalFile(uri).then(file => {
      if (!active) return;
      if (file.kind === 'pdf') router.replace({ pathname: '/pdf-viewer', params: { uri: file.uri, name: file.name, page: '0' } });
      else { stagePreviewFile(file); router.replace({ pathname: '/file-preview', params: { id: file.id } }); }
    }).catch(cause => { if (active) setError((cause as Error).message || 'This file could not be opened.'); });
    return () => { active = false; };
  }, [uri]);
  const message = !uri ? 'No file was received. Open a PDF or image from another app to view it here.' : error;
  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    {message ? <View style={styles.content}>
      <UniversalIcon ios="exclamationmark.triangle" android="error-outline" size={40} color={colors.systemBlue} />
      <ThemedText accessibilityRole="alert" style={styles.text}>{message}</ThemedText>
      <ToolButton title="Go to home" onPress={() => router.replace('/')} />
    </View> : <View style={styles.content}>
      <AppLoader size="large" />
      <ThemedText accessibilityLiveRegion="polite" style={styles.text}>Getting your file...</ThemedText>
      <ThemedText style={[styles.text, { color: colors.secondaryLabel }]}>Files from email or cloud apps are downloaded and kept in Versara.</ThemedText>
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  text: { textAlign: 'center' },
});

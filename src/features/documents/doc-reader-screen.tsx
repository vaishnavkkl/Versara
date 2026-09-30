import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t } from '@/theme/dashboard';
import { useScreenActive } from '@/hooks/use-screen-active';
import { prepareDocReader } from './doc-reader-assets';

type Session = Awaited<ReturnType<typeof prepareDocReader>>;

export function DocReaderScreen() {
  const { uri, name } = useLocalSearchParams<{ uri?: string; name?: string }>();
  return <DocReaderDocument key={uri || ''} uri={uri} name={name} />;
}

function DocReaderDocument({ uri, name }: { uri?: string; name?: string }) {
  const colors = usePalette();
  const active = useScreenActive();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let live = true;
    let prepared: Session | null = null;
    if (!uri) return;
    void prepareDocReader(uri).then(value => {
      prepared = value;
      if (live) setSession(value);
      else value.release();
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'Could not open this document.'); });
    return () => {
      live = false;
      prepared?.release();
    };
  }, [uri]);

  function onMessage(event: WebViewMessageEvent) {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; message?: string; pages?: number };
      if (message.type === 'ready') setPages(message.pages ?? 0);
      if (message.type === 'error') setError(message.message || 'Could not display this document.');
    } catch { setError('The document reader returned an invalid response.'); }
  }

  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.systemBackground }]} edges={['top', 'bottom']}>
    <ScreenHeader title={name || 'Document'} onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/(modules)/word'); }} />
    <View style={[styles.status, { borderColor: colors.separator }]}>
      <ThemedText style={[styles.statusText, { color: colors.secondaryLabel }]}>Read only · DOCX</ThemedText>
      {!!pages && <ThemedText style={[styles.statusText, { color: colors.secondaryLabel }]}>{pages} {pages === 1 ? 'page' : 'pages'}</ThemedText>}
    </View>
    {error || !uri ? <View style={styles.center}>
      <ThemedText accessibilityRole="alert" style={styles.errorTitle}>Unable to display document</ThemedText>
      <ThemedText style={[styles.message, { color: colors.secondaryLabel }]}>{error || 'No document was selected.'}</ThemedText>
    </View> : session && active ? <WebView
      key={session.page.uri}
      source={{ uri: session.page.uri }}
      allowingReadAccessToURL={session.folder.uri}
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs={false}
      originWhitelist={['file://*']}
      javaScriptEnabled
      domStorageEnabled={false}
      cacheEnabled={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url.startsWith(session.folder.uri)}
      onMessage={onMessage}
      onError={event => setError(event.nativeEvent.description || 'The document reader could not start.')}
      onRenderProcessGone={() => setError('The document was too complex to display on this device.')}
      onContentProcessDidTerminate={() => setError('The document was too complex to display on this device.')}
      style={styles.viewer}
    /> : <View style={styles.center}>
      <ActivityIndicator color={colors.systemBlue} size="large" />
      <ThemedText style={[styles.message, { color: colors.secondaryLabel }]}>Opening document…</ThemedText>
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  viewer: { flex: 1, backgroundColor: '#E8EBEF' },
  status: { minHeight: 36, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: s.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusText: { ...t.caption, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.xl, gap: s.md },
  errorTitle: { ...t.heading, textAlign: 'center' },
  message: { ...t.body, textAlign: 'center' },
});

import { useEffect, useRef, useState } from 'react';
import { ThemeProvider, DarkTheme, DefaultTheme, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useAppearance, usePalette } from '@/theme/colors';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { FileAccessPrompt } from '@/components/file-access-prompt';
import { AnimatedSplash } from '@/components/animated-splash';
import { DialogHost } from '@/components/app-dialog';
import { LoadingHost } from '@/components/app-loader';
import { recoverPendingAppSaves } from '@/features/files/save-recovery';
import { SaveRecoveryNotice } from '@/features/files/save-recovery-notice';

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: false, duration: 0 });

export default function RootLayout() {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const hydrated = useAppearance(state => state.hydrated);
  const hydrate = useAppearance(state => state.hydrate);
  const [splashDone, setSplashDone] = useState(false);
  const [splashReady, setSplashReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [recovering, setRecovering] = useState(false);
  const revealingSplash = useRef(false);
  async function revealSplash() {
    if (revealingSplash.current) return;
    revealingSplash.current = true;
    try { await SplashScreen.hideAsync(); } finally { setSplashReady(true); }
  }
  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    void recoverPendingAppSaves().catch(cause => {
      if (active) setRecoveryError(cause instanceof Error ? cause.message : 'An interrupted save needs recovery. Its original copy has been kept.');
    });
    return () => { active = false; };
  }, [hydrated]);
  async function retryRecovery() {
    if (recovering) return;
    setRecovering(true);
    try { await recoverPendingAppSaves(); setRecoveryError(''); }
    catch (cause) { setRecoveryError(cause instanceof Error ? cause.message : 'Save recovery could not finish. Free storage space and retry.'); }
    finally { setRecovering(false); }
  }
  const theme = mode === 'dark' ? DarkTheme : DefaultTheme;

  // Restore the saved palette before revealing screens beneath the splash.
  if (!hydrated) return null;

  return (
    <GestureHandlerRootView onLayout={() => { void revealSplash(); }} style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      <ThemeProvider value={{ ...theme, colors: { ...theme.colors, background: colors.systemBackground, card: colors.secondarySystemBackground, text: colors.label, primary: colors.systemBlue, border: colors.separator } }}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} hidden={false} />
        {/* Single stack — (tabs) group is its own child route */}
        <Stack screenOptions={{ headerShown: false, orientation: 'portrait' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(modules)" options={{ headerShown: false, animation: 'none' }} />
          <Stack.Screen name="pdf-tool" options={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
          <Stack.Screen name="tool-preview" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="guide" options={{ headerShown: false }} />
          <Stack.Screen name="file-preview" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="pdf-viewer" options={{ headerShown: false, animation: 'none' }} />
          <Stack.Screen name="image-editor" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }} />
          <Stack.Screen name="image-tool" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }} />
          <Stack.Screen name="file-picker" options={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
          <Stack.Screen name="privacy-tool" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }} />
          <Stack.Screen name="image-text" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }} />
          <Stack.Screen name="edited-files" options={{ headerShown: false, animation: 'slide_from_right' }} />
        </Stack>
        <FileAccessPrompt ready={splashDone} />
        <DialogHost />
        <LoadingHost />
        {splashDone && !!recoveryError && <SaveRecoveryNotice message={recoveryError} busy={recovering} onRetry={() => { void retryRecovery(); }} onDismiss={() => setRecoveryError('')} />}
        {!splashDone && <AnimatedSplash ready={splashReady} onDone={() => setSplashDone(true)} />}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

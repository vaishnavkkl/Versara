import { useEffect, useState } from 'react';
import { ThemeProvider, DarkTheme, DefaultTheme, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useAppearance, usePalette } from '@/theme/colors';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { FileAccessPrompt } from '@/components/file-access-prompt';
import { AnimatedSplash } from '@/components/animated-splash';
import { DialogHost } from '@/components/app-dialog';
import { LoadingHost } from '@/components/app-loader';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const hydrated = useAppearance(state => state.hydrated);
  const hydrate = useAppearance(state => state.hydrate);
  const [splashDone, setSplashDone] = useState(false);
  useEffect(() => { hydrate(); }, [hydrate]);
  const theme = mode === 'dark' ? DarkTheme : DefaultTheme;

  // Restore the saved palette before revealing screens beneath the splash.
  if (!hydrated) return null;

  return (
    <GestureHandlerRootView onLayout={() => { if (hydrated) void SplashScreen.hideAsync(); }} style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      <ThemeProvider value={{ ...theme, colors: { ...theme.colors, background: colors.systemBackground, card: colors.secondarySystemBackground, text: colors.label, primary: colors.systemBlue, border: colors.separator } }}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} hidden={false} />
        {/* Single stack — (tabs) group is its own child route */}
        <Stack screenOptions={{ headerShown: false, orientation: 'portrait' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="pdf-tool" options={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
          <Stack.Screen name="tool-preview" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="guide" options={{ headerShown: false }} />
          <Stack.Screen name="file-preview" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="pdf-viewer" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="image-editor" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }} />
          <Stack.Screen name="image-text" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }} />
          <Stack.Screen name="edited-files" options={{ headerShown: false, animation: 'slide_from_right' }} />
        </Stack>
        <FileAccessPrompt ready={splashDone} />
        <DialogHost />
        <LoadingHost />
        {!splashDone && <AnimatedSplash onDone={() => setSplashDone(true)} />}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

import { useEffect } from 'react';
import { ThemeProvider, DarkTheme, DefaultTheme, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useAppearance, usePalette } from '@/theme/colors';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const hydrated = useAppearance(state => state.hydrated);
  const hydrate = useAppearance(state => state.hydrate);
  useEffect(() => { hydrate(); }, [hydrate]);
  const theme = mode === 'dark' ? DarkTheme : DefaultTheme;

  // Restore the saved palette before revealing screens beneath the splash.
  if (!hydrated) return null;

  return (
    <GestureHandlerRootView onLayout={() => { if (hydrated) void SplashScreen.hideAsync(); }} style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      <ThemeProvider value={{ ...theme, colors: { ...theme.colors, background: colors.systemBackground, card: colors.secondarySystemBackground, text: colors.label, primary: colors.systemBlue, border: colors.separator } }}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} hidden={false} />
        {/* Single stack — (tabs) group is its own child route */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="pdf-tool" options={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
          <Stack.Screen name="guide" options={{ headerShown: false }} />
          <Stack.Screen name="file-preview" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

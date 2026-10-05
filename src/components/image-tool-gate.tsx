import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useImageScreenActive } from '@/hooks/use-image-screen-active';
import { AppLoader } from './app-loader';
import { ScreenHeader } from './screen-header';

/** Mount heavy editors once the native push animation has finished. */
export function ImageToolGate({ children }: { children: ReactNode }) {
  const ready = useImageScreenActive();
  const [opened, setOpened] = useState(false);
  if (ready && !opened) setOpened(true);
  if (opened || ready) return children;
  return <View style={{ flex: 1 }}>
    <ScreenHeader title="Image tools" onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><AppLoader accessibilityLabel="Opening image tool" /></View>
  </View>;
}

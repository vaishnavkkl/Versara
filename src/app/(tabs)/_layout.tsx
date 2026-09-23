import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { useRouter } from 'expo-router';
import { CustomTabBar } from '@/components/custom-tab-bar';

// Tab definitions — SF Symbols for iOS, Material Icons for Android
const TABS = [
  {
    key: 'index',
    label: 'Home',
    ios: 'house' as const,
    iosActive: 'house.fill' as const,
    android: 'home' as const,
    androidActive: 'home' as const,
  },
  {
    key: 'documents',
    label: 'Docs',
    ios: 'doc.text' as const,
    iosActive: 'doc.text.fill' as const,
    android: 'description' as const,
    androidActive: 'description' as const,
  },
  {
    key: 'media',
    label: 'Media',
    ios: 'photo.on.rectangle' as const,
    iosActive: 'photo.fill.on.rectangle.fill' as const,
    android: 'perm-media' as const,
    androidActive: 'perm-media' as const,
  },
  {
    key: 'device',
    label: 'Device',
    ios: 'antenna.radiowaves.left.and.right' as const,
    iosActive: 'antenna.radiowaves.left.and.right.circle.fill' as const,
    android: 'devices' as const,
    androidActive: 'devices' as const,
  },
  {
    key: 'settings',
    label: 'Settings',
    ios: 'gearshape' as const,
    iosActive: 'gearshape.fill' as const,
    android: 'settings' as const,
    androidActive: 'settings' as const,
  },
];

const ROUTES = ['index', 'documents', 'media', 'device', 'settings'] as const;

export default function TabsLayout() {
  const [activeIndex, setActiveIndex] = useState(0);

  const router = useRouter();

  const handleTabPress = useCallback((index: number) => {
    setActiveIndex(index);
    const route = ROUTES[index];
    if (route === 'index') {
      router.replace('/(tabs)/index');
    } else {
      router.replace(`/(tabs)/${route}/index` as any);
    }
  }, [router]);

  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={() => (
          <CustomTabBar
            tabs={TABS}
            activeIndex={activeIndex}
            onTabPress={handleTabPress}
          />
        )}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="documents" />
        <Tabs.Screen name="media" />
        <Tabs.Screen name="device" />
        <Tabs.Screen name="settings" />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});

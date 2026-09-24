import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import { CustomTabBar } from '@/components/custom-tab-bar';
import { usePalette } from '@/theme/colors';

const TABS = [
  { key: 'index', label: 'Home', ios: 'house', iosActive: 'house.fill', android: 'home', androidActive: 'home' },
  { key: 'documents/index', label: 'PDF', ios: 'doc.richtext', iosActive: 'doc.richtext.fill', android: 'picture-as-pdf', androidActive: 'picture-as-pdf' },
  { key: 'image/index', label: 'Image', ios: 'photo.on.rectangle', iosActive: 'photo.fill.on.rectangle.fill', android: 'photo-library', androidActive: 'photo-library' },
  { key: 'video/index', label: 'Video', ios: 'play.rectangle', iosActive: 'play.rectangle.fill', android: 'smart-display', androidActive: 'smart-display' },
  { key: 'settings/index', label: 'Settings', ios: 'slider.horizontal.3', iosActive: 'slider.horizontal.3', android: 'tune', androidActive: 'tune' },
] as const;

export default function TabsLayout() {
  const colors = usePalette();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      <Tabs screenOptions={{ headerShown: false, animation: 'none', lazy: true, freezeOnBlur: true }} tabBar={({ state, navigation }) => (
        <CustomTabBar tabs={TABS} activeIndex={TABS.findIndex(tab => tab.key === state.routes[state.index].name)} onTabPress={index => {
          const route = state.routes.find(item => item.name === TABS[index].key);
          if (!route) return;
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!event.defaultPrevented) navigation.navigate(route.name);
        }} />
      )}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="documents/index" />
        <Tabs.Screen name="image/index" />
        <Tabs.Screen name="video/index" />
        <Tabs.Screen name="media/index" options={{ href: null, lazy: true }} />
        <Tabs.Screen name="device/index" options={{ href: null, lazy: true }} />
        <Tabs.Screen name="settings/index" />
        <Tabs.Screen name="privacy/index" options={{ href: null, lazy: true }} />
        <Tabs.Screen name="audio/index" options={{ href: null, lazy: true }} />
      </Tabs>
    </SafeAreaView>
  );
}

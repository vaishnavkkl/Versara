import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import { CustomTabBar } from '@/components/custom-tab-bar';
import { usePalette } from '@/theme/colors';

const TABS = [
  { key: 'index', label: 'Home', ios: 'house', iosActive: 'house.fill', android: 'home', androidActive: 'home' },
  { key: 'files/index', label: 'Files', ios: 'folder', iosActive: 'folder.fill', android: 'folder-open', androidActive: 'folder' },
  { key: 'search/index', label: 'Search', ios: 'magnifyingglass', iosActive: 'magnifyingglass', android: 'search', androidActive: 'search' },
  { key: 'settings/index', label: 'Settings', ios: 'gearshape', iosActive: 'gearshape.fill', android: 'settings', androidActive: 'settings' },] as const;

export default function TabsLayout() {
  const colors = usePalette();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      <Tabs screenOptions={{ headerShown: false, animation: 'none', lazy: true, freezeOnBlur: true }} tabBar={({ state, navigation }) => (
        <CustomTabBar tabs={TABS} activeIndex={Math.max(0, TABS.findIndex(tab => tab.key === state.routes[state.index].name))} onTabPress={index => {
          const route = state.routes.find(item => item.name === TABS[index].key);
          if (!route) return;
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!event.defaultPrevented) navigation.navigate(route.name);
        }} />
      )}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="files/index" />
        <Tabs.Screen name="search/index" />
        <Tabs.Screen name="settings/index" />
        <Tabs.Screen name="documents/index" options={{ href: null, lazy: true }} />
        <Tabs.Screen name="image/index" options={{ href: null, lazy: true }} />
        <Tabs.Screen name="video/index" options={{ href: null, lazy: true }} />
        <Tabs.Screen name="media/index" options={{ href: null, lazy: true }} />
        <Tabs.Screen name="device/index" options={{ href: null, lazy: true }} />
        <Tabs.Screen name="privacy/index" options={{ href: null, lazy: true }} />
        <Tabs.Screen name="audio/index" options={{ href: null, lazy: true }} />
      </Tabs>
    </SafeAreaView>
  );
}

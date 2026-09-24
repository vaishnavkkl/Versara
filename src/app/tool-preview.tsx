import type { ComponentProps } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t, radius } from '@/theme/dashboard';

export default function ToolPreviewScreen() {
  const colors = usePalette();
  const { title, subtitle, ios, android } = useLocalSearchParams<{
    id: string; title: string; subtitle: string; ios: string; android: string;
  }>();
  function back() { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.systemBackground }]} edges={['top', 'bottom', 'left', 'right']}>
      <ScreenHeader title={title ?? 'Tool'} onBack={back} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.iconBox, { backgroundColor: colors.accentSurface }]}>
          <UniversalIcon ios={(ios ?? 'wrench') as ComponentProps<typeof UniversalIcon>['ios']} android={(android ?? 'build') as ComponentProps<typeof UniversalIcon>['android']} size={36} color={colors.systemBlue} />
        </View>
        <ThemedText style={styles.heading}>{title}</ThemedText>
        <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{subtitle}</ThemedText>
        <View style={[styles.preview, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}>
          <UniversalIcon ios="clock" android="schedule" size={24} color={colors.secondaryLabel} />
          <ThemedText style={[styles.label, { color: colors.label }]}>Coming soon</ThemedText>
          <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>This tool is in development and will be available in a future update.</ThemedText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: s.xxl, gap: s.lg, alignItems: 'center', maxWidth: 480, width: '100%', alignSelf: 'center' },
  iconBox: { width: 72, height: 72, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  heading: { ...t.heading, textAlign: 'center' },
  body: { ...t.body, textAlign: 'center' },
  label: { ...t.label },
  preview: { width: '100%', borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: s.xl, gap: s.sm, alignItems: 'center' },
});

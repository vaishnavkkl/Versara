import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { AppearanceButtons } from '@/components/appearance-buttons';
import { ModuleCard } from '@/components/module-card';
import { HelpButton } from '@/components/help-button';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t } from '@/theme/dashboard';

const MODULES = [
  { title: 'PDF', description: 'Your documents & PDF tools', ios: 'doc.richtext', android: 'picture-as-pdf', href: '/(tabs)/documents' },
  { title: 'Image', description: 'Your images & photos', ios: 'photo.fill', android: 'image', href: '/(tabs)/image' },
  { title: 'Video', description: 'Your videos, ready to play', ios: 'play.rectangle.fill', android: 'smart-display', href: '/(tabs)/video' },
  { title: 'Audio', description: 'Your audio, ready to listen', ios: 'waveform', android: 'graphic-eq', href: '/(tabs)/audio' },
  { title: 'Privacy', description: 'Redact & remove metadata', ios: 'lock.shield', android: 'verified-user', href: '/(tabs)/privacy' },
  { title: 'Device', description: 'Network & battery tools', ios: 'iphone', android: 'devices', href: '/(tabs)/device' },
] as const;

export default function HomeScreen() {
  const colors = usePalette();
  const [showWelcome, setShowWelcome] = useState(() => { try { return localStorage.getItem('versara.guide.dismissed') !== '1'; } catch { return true; } });
  return (
    <ScrollView contentInsetAdjustmentBehavior="never" style={{ backgroundColor: colors.systemBackground }} contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.brand}><UniversalIcon ios="square.stack.3d.up.fill" android="layers" size={27} color={colors.systemBlue} /><ThemedText style={styles.brandName}>Versara</ThemedText></View>
          <HelpButton />
          <AppearanceButtons compact />
        </View>
        <View style={styles.intro}>
          <ThemedText accessibilityRole="header" style={styles.title}>Your toolbox</ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.secondaryLabel }]}>What would you like to work with?</ThemedText>
        </View>
        {showWelcome && <View style={[styles.welcome, { backgroundColor: colors.accentSurface }]}><Pressable accessibilityRole="button" onPress={() => router.push('/guide')} style={styles.guide}><ThemedText style={{ fontWeight: '600', color: colors.systemBlue }}>New here? Try a quick demo</ThemedText><ThemedText style={[styles.subtitle, { color: colors.secondaryLabel }]}>Three simple steps. No files needed.</ThemedText></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Dismiss introduction. Help stays available." onPress={() => { setShowWelcome(false); try { localStorage.setItem('versara.guide.dismissed', '1'); } catch { /* Optional preference. */ } }} style={styles.dismiss}><UniversalIcon ios="xmark" android="close" size={20} color={colors.systemBlue} /></Pressable></View>}
        <View style={styles.grid}>
          {MODULES.filter((_, index) => index % 2 === 0).map((_, row) => (
            <View key={row} style={styles.row}>
              {MODULES.slice(row * 2, row * 2 + 2).map(module => (
                <ModuleCard key={module.title} {...module} detail={module.title === 'Privacy' || module.title === 'Device' ? 'Coming soon' : undefined} variant="dashboard" onPress={() => router.navigate(module.href)} />
              ))}
              {!MODULES[row * 2 + 1] && <View style={{ flex: 1 }} />}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  scroll: { padding: s.xl, paddingBottom: s.section },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: s.lg },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: s.md },
  brand: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  brandName: { ...t.heading },
  intro: { gap: s.xs },
  title: { ...t.title },
  subtitle: { ...t.body },
  grid: { gap: s.md },
  row: { flexDirection: 'row', gap: s.md },
  welcome: { borderRadius: 16, paddingLeft: 16, flexDirection: 'row', alignItems: 'center' }, guide: { flex: 1, gap: 4, paddingVertical: 14 }, dismiss: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});

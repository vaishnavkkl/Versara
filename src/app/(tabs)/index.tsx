import { useCallback, useEffect, useState } from 'react';
import { countEditedFiles, subscribeEditedFiles } from '@/features/files/edited-files';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { LayoutToggle, useLayoutPreference } from '@/components/layout-toggle';
import { ModuleCard } from '@/components/module-card';
import { HelpButton } from '@/components/help-button';
import { usePalette } from '@/theme/colors';
import { brandFont, getGradients, spacing as s, typography as t } from '@/theme/dashboard';

const MODULES = [
  { title: 'PDF', description: 'Your documents & PDF tools', ios: 'doc.richtext', android: 'picture-as-pdf', href: '/(tabs)/documents', tint: ['#E5484D', '#FF9466'] },
  { title: 'Image', description: 'Your images & photos', ios: 'photo.fill', android: 'image', href: '/(tabs)/image', tint: ['#1FA971', '#6EE7A8'] },
  { title: 'Video', description: 'Your videos, ready to play', ios: 'play.rectangle.fill', android: 'smart-display', href: '/(tabs)/video', tint: ['#7C3AED', '#C084FC'] },
  { title: 'Audio', description: 'Your audio, ready to listen', ios: 'waveform', android: 'graphic-eq', href: '/(tabs)/audio', tint: ['#F76B15', '#FFB547'] },
  { title: 'Privacy', description: 'Redact & remove metadata', ios: 'lock.shield', android: 'verified-user', href: '/(tabs)/privacy', tint: ['#0EA5A4', '#5EEAD4'] },
  { title: 'Device', description: 'Network & battery tools', ios: 'iphone', android: 'devices', href: '/(tabs)/device', tint: ['#DB2777', '#F472B6'] },
] as const;
const EDITED_TINT = ['#0A84FF', '#5AC8FA'] as const;
function welcomePending() { try { return localStorage.getItem('versara.guide.dismissed') !== '1'; } catch { return true; } }

export default function HomeScreen() {
  const colors = usePalette();
  const [grid] = useLayoutPreference();
  const columns = grid ? 2 : 1;
  const [editedCount, setEditedCount] = useState(0);
  useEffect(() => {
    const refresh = () => { void countEditedFiles().then(setEditedCount).catch(() => {}); };
    refresh();
    return subscribeEditedFiles(refresh);
  }, []);
  const [showWelcome, setShowWelcome] = useState(welcomePending);
  useFocusEffect(useCallback(() => { setShowWelcome(welcomePending()); }, []));
  return (
    <ScrollView contentInsetAdjustmentBehavior="never" style={[{ backgroundColor: colors.systemBackground }, getGradients(colors).dashboard]} contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.brand}><UniversalIcon ios="square.stack.3d.up.fill" android="layers" size={27} color={colors.systemBlue} /><ThemedText style={styles.brandName}>Versara</ThemedText></View>
          <HelpButton />
          <LayoutToggle />
        </View>
        <View style={styles.intro}>
          <ThemedText accessibilityRole="header" style={styles.title}>Your toolbox</ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.secondaryLabel }]}>What would you like to work with?</ThemedText>
        </View>
        {showWelcome && <View style={[styles.welcome, { backgroundColor: colors.accentSurface }]}><Pressable accessibilityRole="button" onPress={() => router.push('/guide')} style={styles.guide}><ThemedText style={{ fontWeight: '600', color: colors.systemBlue }}>New here? Try a quick demo</ThemedText><ThemedText style={[styles.subtitle, { color: colors.secondaryLabel }]}>Three simple steps. No files needed.</ThemedText></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Dismiss introduction. Help stays available." onPress={() => { setShowWelcome(false); try { localStorage.setItem('versara.guide.dismissed', '1'); } catch { /* Optional preference. */ } }} style={styles.dismiss}><UniversalIcon ios="xmark" android="close" size={20} color={colors.systemBlue} /></Pressable></View>}
        <View style={styles.grid}>
          {MODULES.filter((_, index) => index % columns === 0).map((_, row) => (
            <View key={row} style={styles.row}>
              {MODULES.slice(row * columns, row * columns + columns).map(module => (
                <ModuleCard key={module.title} {...module} detail={module.title === 'Privacy' || module.title === 'Device' ? 'Coming soon' : undefined} variant={grid ? 'dashboard' : 'list'} onPress={() => router.navigate(module.href)} />
              ))}
              {grid && !MODULES[row * columns + 1] && <View style={{ flex: 1 }} />}
            </View>
          ))}
          <ModuleCard title="Edited files" description="PDFs & images you saved" ios="square.and.pencil" android="edit-note" tint={EDITED_TINT} detail={editedCount ? `${editedCount} saved` : undefined} variant="list" onPress={() => router.navigate('/edited-files')} />
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
  brandName: { ...t.heading, ...brandFont.display, letterSpacing: 0.2 },
  intro: { gap: s.xs },
  title: { ...t.title },
  subtitle: { ...t.body },
  grid: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  welcome: { borderRadius: 16, paddingLeft: 16, flexDirection: 'row', alignItems: 'center' }, guide: { flex: 1, gap: 4, paddingVertical: 14 }, dismiss: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});

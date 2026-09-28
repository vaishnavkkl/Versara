import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { countEditedFiles, subscribeEditedFiles } from '@/features/files/edited-files';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { LayoutToggle, useLayoutPreference } from '@/components/layout-toggle';
import { ModuleCard } from '@/components/module-card';
import { HelpButton } from '@/components/help-button';
import { usePalette } from '@/theme/colors';
import { brandFont, catalog, radius, spacing as s, typography as t } from '@/theme/dashboard';

const MODULES = [
  { title: 'PDF', description: 'Read, edit & organize documents', ios: 'doc.richtext', android: 'picture-as-pdf', href: '/(modules)/documents', tone: 'pdf' },
  { title: 'Image', description: 'Edit photos & create PDFs', ios: 'photo', android: 'image', href: '/(modules)/image', tone: 'image' },
  { title: 'Edited files', description: 'Pick up where you left off', ios: 'folder', android: 'folder-open', href: '/edited-files', tone: 'files' },
  { title: 'Privacy', description: 'Redaction & safer sharing', ios: 'lock.shield', android: 'verified-user', href: '/(modules)/privacy', tone: 'privacy' },
] as const;
function welcomePending() { try { return localStorage.getItem('versara.guide.dismissed') !== '1'; } catch { return true; } }

export default function HomeScreen() {
  const colors = usePalette();
  const [grid] = useLayoutPreference();
  const { width, fontScale } = useWindowDimensions();
  const useGrid = grid && width >= 360 && fontScale < 1.4;
  const columns = useGrid ? 2 : 1;
  const [editedCount, setEditedCount] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void countEditedFiles().then(count => { if (mounted) setEditedCount(count); }).catch(() => {}); };
    refresh();
    const unsubscribe = subscribeEditedFiles(refresh);
    return () => { mounted = false; unsubscribe(); };
  }, []);
  const [showWelcome, setShowWelcome] = useState(welcomePending);
  useFocusEffect(useCallback(() => { setShowWelcome(welcomePending()); }, []));
  return <ScrollView contentInsetAdjustmentBehavior="never" style={{ backgroundColor: colors.systemBackground }} contentContainerStyle={styles.scroll}>
    <View style={styles.content}>
      <View style={styles.header}>
        <ThemedText style={styles.brandName}>Versara</ThemedText>
        <HelpButton />
      </View>
      <View style={styles.intro}>
        <ThemedText accessibilityRole="header" style={styles.title}>Your workspace</ThemedText>
        <ThemedText style={[styles.subtitle, { color: colors.secondaryLabel }]}>PDFs and images, made simple.</ThemedText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Search tools and files" onPress={() => router.navigate('/(tabs)/search')}
        style={({ pressed }) => [styles.search, { backgroundColor: pressed ? colors.catalogPressed : colors.catalogSurface, borderColor: colors.catalogBorder }]}>
        <UniversalIcon ios="magnifyingglass" android="search" size={22} color={colors.secondaryLabel} />
        <ThemedText style={[styles.subtitle, styles.grow, { color: colors.secondaryLabel }]}>Find a tool or file</ThemedText>
      </Pressable>
      <View style={styles.modules}>
        <View style={styles.sectionHeader}>
          <ThemedText accessibilityRole="header" style={styles.sectionTitle}>Your tools</ThemedText>
          <LayoutToggle gridAvailable={width >= 360 && fontScale < 1.4} />
        </View>
        <View style={styles.grid}>
          {MODULES.filter((_, index) => index % columns === 0).map((first, row) => <View key={first.title} style={styles.row}>
            {MODULES.slice(row * columns, row * columns + columns).map(module => <ModuleCard key={module.title} {...module}
              detail={module.tone === 'privacy' ? 'Coming soon' : module.tone === 'files' && editedCount ? `${editedCount} saved` : undefined}
              disabled={module.tone === 'privacy'} variant={useGrid ? 'dashboard' : 'list'} onPress={() => router.navigate(module.href)} />)}
          </View>)}
        </View>
      </View>
      <View style={styles.offline}>
        <UniversalIcon ios="checkmark.shield" android="verified-user" size={17} color={colors.secondaryLabel} />
        <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>On your device. Under your control.</ThemedText>
      </View>
      {showWelcome && <View style={[styles.welcome, { borderColor: colors.catalogBorder }]}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/guide')} style={({ pressed }) => [styles.guide, { opacity: pressed ? 0.6 : 1 }]}>
          <View style={styles.grow}><ThemedText style={styles.sectionTitle}>A quick introduction</ThemedText><ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Try the demo in three steps</ThemedText></View>
          <UniversalIcon ios="arrow.right" android="arrow-forward" size={18} color={colors.secondaryLabel} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss introduction. Help stays available." onPress={() => { setShowWelcome(false); try { localStorage.setItem('versara.guide.dismissed', '1'); } catch { /* Optional preference. */ } }} style={styles.dismiss}>
          <UniversalIcon ios="xmark" android="close" size={18} color={colors.secondaryLabel} />
        </Pressable>
      </View>}
    </View>
  </ScrollView>;
}
const styles = StyleSheet.create({
  scroll: { paddingHorizontal: s.xl, paddingTop: s.sm, paddingBottom: s.section },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: s.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: s.md },
  brandName: { ...t.heading, ...brandFont.label, letterSpacing: -0.5 },
  intro: { gap: s.xs },
  title: { ...t.workspaceTitle },
  subtitle: { ...t.body },
  search: { minHeight: 56, borderRadius: radius.md, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: s.lg, flexDirection: 'row', gap: s.md, alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  modules: { gap: s.md },
  sectionHeader: { flexDirection: 'row', gap: s.sm, justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...t.catalogTitle },
  offline: { flexDirection: 'row', gap: s.sm, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  caption: { ...t.caption },
  grid: { gap: s.md },
  row: { flexDirection: 'row', gap: s.md },
  welcome: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: s.sm, flexDirection: 'row', alignItems: 'center' },
  guide: { flex: 1, flexDirection: 'row', gap: s.md, alignItems: 'center', paddingVertical: s.md },
  dismiss: { width: catalog.touchTarget, minHeight: catalog.touchTarget, alignItems: 'center', justifyContent: 'center' },
});

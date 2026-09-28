import { openPrivacyTool } from './open-privacy-tool';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { HelpButton } from '@/components/help-button';
import { LayoutToggle, useLayoutPreference } from '@/components/layout-toggle';
import { ModuleCard } from '@/components/module-card';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { recordToolUse } from '@/features/search/search-history';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t } from '@/theme/dashboard';
import { PRIVACY_TOOLS, type PrivacyMode } from './privacy-tools';

export function PrivacyHome() {
  const colors = usePalette();
  const [grid] = useLayoutPreference();
  const { width, fontScale } = useWindowDimensions();
  const gridAvailable = width >= 360 && fontScale < 1.4;
  const useGrid = grid && gridAvailable;
  const columns = useGrid ? 2 : 1;
  const navigating = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<PrivacyMode | null>(null);
  useFocusEffect(useCallback(() => { navigating.current = false; }, []));

  async function openTool(mode: PrivacyMode) {
    if (navigating.current || opening) return;
    navigating.current = true;
    setError(''); setOpening(mode);
    try {
      if (await openPrivacyTool(mode, { current: () => mounted.current })) recordToolUse(`Privacy:${mode}`);
    } catch (cause) {
      navigating.current = false;
      if (mounted.current) setError((cause as Error).message || 'Could not open this tool. Please try again.');
    } finally { navigating.current = false; if (mounted.current) setOpening(null); }
  }

  return <View style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to dashboard" onPress={() => router.navigate('/(tabs)')}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}>
            <UniversalIcon ios="chevron.left" android="arrow-back" size={20} color={colors.systemBlue} />
            <ThemedText style={{ color: colors.systemBlue }}>Toolbox</ThemedText>
          </Pressable>
          <View style={styles.actions}><HelpButton tool="privacy" /><LayoutToggle gridAvailable={gridAvailable} /></View>
        </View>
        <View style={styles.heading}>
          <ThemedText accessibilityRole="header" style={styles.title}>Privacy</ThemedText>
          <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Review images and PDFs before sharing.</ThemedText>
        </View>
        {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        <View style={styles.tools}>
          <ThemedText accessibilityRole="header" style={styles.sectionTitle}>Safer sharing</ThemedText>
          {PRIVACY_TOOLS.filter((_, index) => index % columns === 0).map((first, row) => <View key={first.id} style={styles.row}>
            {PRIVACY_TOOLS.slice(row * columns, row * columns + columns).map(tool => <View key={tool.id} style={styles.cell}><ModuleCard
              title={tool.title} description={tool.subtitle} ios={tool.ios} android={tool.android}
              tone="privacy" loading={opening === tool.id} disabled={opening !== null && opening !== tool.id} variant={useGrid ? 'compact' : 'list'} onPress={() => { void openTool(tool.id); }} /></View>)}
            {useGrid && !PRIVACY_TOOLS[row * columns + 1] && <View style={styles.cell} />}
          </View>)}
        </View>
        <View style={styles.guidance}>
          <UniversalIcon ios="checkmark.shield" android="verified-user" size={21} color={colors.secondaryLabel} />
          <View style={styles.guidanceText}>
            <ThemedText style={styles.sectionTitle}>Your original stays unchanged</ThemedText>
            <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Processing stays on your device. Scan suggestions can miss details. Review the whole image or every PDF page, including QR codes, before exporting a copy.</ThemedText>
          </View>
        </View>
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: s.lg, paddingBottom: s.section },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: s.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: s.sm },
  back: { minHeight: 48, minWidth: 48, flexDirection: 'row', gap: s.xs, alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  heading: { gap: s.sm },
  title: { ...t.title },
  body: { ...t.body },
  sectionTitle: { ...t.catalogTitle },
  tools: { gap: s.md },
  row: { flexDirection: 'row', gap: s.sm },
  // Equal outer columns keep card padding from widening the incomplete last row.
  cell: { flex: 1, flexBasis: 0, minWidth: 0 },
  guidance: { flexDirection: 'row', alignItems: 'flex-start', gap: s.md },
  guidanceText: { flex: 1, minWidth: 0, gap: s.sm },
});

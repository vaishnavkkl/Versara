import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ToolSheet } from './tool-sheet';
import { pickPdfTool, discardPdfToolSession, implementedPdfTools, type PdfTool } from '@/features/pdf/pdf-tool-session';
import { AppearanceButtons } from './appearance-buttons';
import { HelpButton } from './help-button';
import { ModuleCard } from './module-card';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import type { Method, MethodSection } from '@/constants/pdf-methods';

type Props = { title: string; subtitle: string; sections: readonly MethodSection[]; upcomingSections?: readonly MethodSection[] };
export function MethodScreen({ title, subtitle, sections, upcomingSections = [] }: Props) {
  const colors = usePalette();
  const [selected, setSelected] = useState<Method | null>(null);
  const [isPresented, setIsPresented] = useState(false);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const pickerLock = useRef(false);
  const mounted = useRef(true);
  const focused = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; }; }, []));

  async function openTool(tool: Method) {
    if (pickerLock.current) return;
    Keyboard.dismiss();
    setPickerError('');
    const toolId = title === 'Image' && tool.id === 'pdf' ? 'from_image' : tool.id;
    const needsFile = (title === 'PDF' && implementedPdfTools.has(toolId)) || (title === 'Image' && tool.id === 'pdf');
    if (!needsFile) { setSelected(tool); setIsPresented(true); return; }
    pickerLock.current = true; setPicking(tool.id);
    let session: string | null = null;
    try {
      session = await pickPdfTool(toolId as PdfTool, tool.title);
      if (!session) return;
      if (!mounted.current || !focused.current) { discardPdfToolSession(session); return; }
      router.push({ pathname: '/pdf-tool', params: { session } });
    } catch (cause) {
      if (session) discardPdfToolSession(session);
      if (mounted.current) setPickerError((cause as Error).message || 'Could not open the file. Please choose it again.');
    } finally {
      pickerLock.current = false;
      if (mounted.current) setPicking(null);
    }
  }
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/);
    const seen = new Set<string>();
    return sections.map(section => ({ ...section, tools: section.tools.filter(tool => {
      if (seen.has(tool.id)) return false;
      seen.add(tool.id);
      return terms.every(term => `${tool.title} ${tool.subtitle} ${section.title}`.toLowerCase().includes(term));
    }) })).filter(section => section.tools.length);
  }, [query, sections]);
  const upcomingFiltered = upcomingSections.map(section => ({ ...section, tools: section.tools.filter(tool => query.trim().toLowerCase().split(/\s+/).every(term => `${tool.title} ${tool.subtitle} ${section.title}`.toLowerCase().includes(term))) })).filter(section => section.tools.length);
  return (
    <View style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={[styles.scroll, title === 'PDF' && { paddingTop: 4 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={[styles.content, title === 'PDF' && styles.compactContent]}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to dashboard" onPress={() => router.navigate('/(tabs)')} style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}><UniversalIcon ios="chevron.left" android="arrow-back" size={20} color={colors.systemBlue} />{title !== 'PDF' && <ThemedText style={{ color: colors.systemBlue }}>Toolbox</ThemedText>}</Pressable>
            {title === 'PDF' && <ThemedText accessibilityRole="header" style={styles.compactTitle}>PDF</ThemedText>}
            <HelpButton />
            <AppearanceButtons compact />
          </View>
          {title !== 'PDF' && <View style={styles.heading}><ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{subtitle}</ThemedText></View>}

          {!!pickerError && <ThemedText accessibilityRole="alert">{pickerError}</ThemedText>}
          <View style={[styles.search, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}>
            <UniversalIcon ios="magnifyingglass" android="search" size={22} color={colors.systemBlue} />
            <TextInput accessibilityLabel={`Search ${title} methods`} placeholder={`Search ${title} tools...`} placeholderTextColor={colors.secondaryLabel} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} style={[styles.input, { color: colors.label }]} />
            {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={styles.clear}><UniversalIcon ios="xmark.circle.fill" android="cancel" size={20} color={colors.secondaryLabel} /></Pressable>}
          </View>
          {filtered.map(section => (
            <View key={section.title} style={styles.section}>
              <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{section.title}</ThemedText>
              {section.tools.filter((_, index) => index % 3 === 0).map((first, row) => (
                <View key={first.id} style={styles.row}>
                  {section.tools.slice(row * 3, row * 3 + 3).map(tool => <ModuleCard key={tool.id} variant="compact" loading={picking === tool.id} disabled={!!picking} detail={(title === 'PDF' && implementedPdfTools.has(tool.id)) || (title === 'Image' && tool.id === 'pdf') ? undefined : 'Coming soon'} title={tool.title} description={tool.subtitle} ios={tool.ios} android={tool.android} onPress={() => openTool(tool)} />)}
                  {[1, 2].map(column => !section.tools[row * 3 + column] && <View key={column} style={styles.spacer} />)}
                </View>
              ))}
            </View>
          ))}
          {!!upcomingSections.length && <View style={styles.section}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showUpcoming || !!query.trim() }} onPress={() => setShowUpcoming(value => !value)} style={[styles.upcomingToggle, { borderColor: colors.separator }]}>
              <View style={styles.spacer}><ThemedText style={styles.sectionTitle}>Coming later</ThemedText><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>More PDF tools in development</ThemedText></View>
              <UniversalIcon ios={showUpcoming ? 'chevron.up' : 'chevron.down'} android={showUpcoming ? 'expand-less' : 'expand-more'} size={22} color={colors.secondaryLabel} />
            </Pressable>
            {(showUpcoming || !!query.trim()) && upcomingFiltered.map(section => {
              const matches = section.tools;
              return matches.length > 0 && <View key={section.title} style={styles.section}>
                <ThemedText style={{ color: colors.secondaryLabel }}>{section.title}</ThemedText>
                {matches.map(tool => <View key={tool.id} style={[styles.upcomingRow, { borderColor: colors.separator }]}>
                  <UniversalIcon ios={tool.ios} android={tool.android} size={22} color={colors.secondaryLabel} />
                  <View style={styles.spacer}><ThemedText>{tool.title}</ThemedText><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{tool.subtitle}</ThemedText></View>
                  <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Soon</ThemedText>
                </View>)}
              </View>;
            })}
          </View>}
          {!filtered.length && !upcomingFiltered.length && <View style={styles.heading}><ThemedText style={styles.sectionTitle}>No tools found</ThemedText><ThemedText style={{ color: colors.secondaryLabel }}>Try a different name or clear your search.</ThemedText></View>}
        </View>
      </ScrollView>
      <ToolSheet title={selected?.title ?? 'Tool'} isPresented={isPresented} onClose={() => { setIsPresented(false); }}>
        {isPresented && selected && (
          <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
            <View style={[styles.sheetIcon, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios={selected.ios} android={selected.android} size={30} color={colors.systemBlue} /></View>
            <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{selected.subtitle}</ThemedText>
            <View style={[styles.preview, { backgroundColor: colors.systemBackground }]}><ThemedText style={styles.sectionTitle}>Tool preview</ThemedText><ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>This is a preview of the interface. Processing will be available in a future update.</ThemedText></View>
          </ScrollView>
        )}
      </ToolSheet>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: s.lg, paddingBottom: s.section },
  content: { maxWidth: 720, width: '100%', alignSelf: 'center', gap: s.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: s.sm },
  back: { minHeight: s.large, minWidth: s.large, flexDirection: 'row', gap: s.xs, alignItems: 'center' },
  compactContent: { gap: s.md },
  compactTitle: { flex: 1, fontSize: 20, fontWeight: '600' },
  upcomingToggle: { minHeight: 64, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  upcomingRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { gap: s.sm },
  title: { ...t.title },
  body: { ...t.body },
  search: { flexDirection: 'row', alignItems: 'center', paddingLeft: s.lg, paddingRight: s.xs, gap: s.sm, borderRadius: radius.md, borderCurve: 'continuous', borderWidth: 1 },
  input: { flex: 1, minWidth: 0, minHeight: 52, paddingVertical: s.md, ...t.body },
  clear: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  section: { gap: s.md },
  sectionTitle: { ...t.label },
  row: { flexDirection: 'row', gap: s.sm },
  spacer: { flex: 1 },
  sheet: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: s.lg, padding: s.xxl },
  sheetIcon: { width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  preview: { padding: s.lg, gap: s.sm, borderRadius: radius.md },
});

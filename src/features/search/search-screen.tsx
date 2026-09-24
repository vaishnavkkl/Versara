import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { AppLoader } from '@/components/app-loader';
import { showDialog } from '@/components/app-dialog';
import { ThemedText } from '@/components/themed-text';
import { toast } from '@/components/toast';
import { UniversalIcon } from '@/components/universal-icon';
import { PDF_SECTIONS, type Method, type MethodSection } from '@/constants/pdf-methods';
import { IMAGE_SECTIONS } from '@/constants/image-methods';
import { VIDEO_SECTIONS } from '@/constants/video-methods';
import { AUDIO_SECTIONS } from '@/constants/audio-methods';
import { usePalette } from '@/theme/colors';
import { getGradients, spacing as s, typography as t } from '@/theme/dashboard';
import { FileEngine, type ExplorerEntry } from '../../../modules/file-engine';
import { ExplorerRow } from '@/features/files/explorer-row';
import { explorerAvailable, openExplorerEntry } from '@/features/files/explorer';

type ToolHit = Method & { module: string; href: Href };
const CATALOG: { module: string; href: Href; sections: readonly MethodSection[] }[] = [
  { module: 'PDF', href: '/(tabs)/documents', sections: PDF_SECTIONS },
  { module: 'Image', href: '/(tabs)/image', sections: IMAGE_SECTIONS },
  { module: 'Video', href: '/(tabs)/video', sections: VIDEO_SECTIONS },
  { module: 'Audio', href: '/(tabs)/audio', sections: AUDIO_SECTIONS },
];
const TOOLS: ToolHit[] = CATALOG.flatMap(({ module, href, sections }) => {
  const seen = new Set<string>();
  return sections.flatMap(section => section.tools).filter(tool => !seen.has(tool.id) && !!seen.add(tool.id)).map(tool => ({ ...tool, module, href }));
});
const SUGGESTIONS = [
  { label: 'PDFs', query: '.pdf' }, { label: 'Photos', query: '.jpg' }, { label: 'Videos', query: '.mp4' },
  { label: 'Music', query: '.mp3' }, { label: 'Documents', query: '.docx' }, { label: 'Archives', query: '.zip' },
] as const;
const MAX_FILES = 80;

type Row = { type: 'header'; key: string; title: string } | { type: 'tool'; key: string; tool: ToolHit } | { type: 'file'; key: string; entry: ExplorerEntry };

export function SearchScreen() {
  const colors = usePalette();
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<ExplorerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const term = query.trim();

  const tools = useMemo(() => {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return TOOLS.filter(tool => words.every(word => `${tool.title} ${tool.subtitle} ${tool.module}`.toLowerCase().includes(word))).slice(0, 6);
  }, [term]);

  useEffect(() => {
    if (term.length < 2 || !explorerAvailable()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      FileEngine!.searchFiles(term, MAX_FILES)
        .then(value => { if (!cancelled) { setFiles(value); setError(null); } })
        .catch(cause => { if (!cancelled) { setFiles([]); setError((cause as Error).message || 'Could not search your files.'); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, retry]);

  const busy = useRef(false);
  const openFile = useCallback((entry: ExplorerEntry) => {
    if (busy.current) return;
    busy.current = true;
    Keyboard.dismiss();
    if (entry.kind === 'image' || entry.kind === 'video' || entry.kind === 'audio') toast(`Opening ${entry.name}…`);
    void openExplorerEntry(entry)
      .catch(cause => showDialog('Could not open file', (cause as Error).message || 'Try again.'))
      .finally(() => { busy.current = false; });
  }, []);

  const showFiles = term.length >= 2;
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (tools.length) {
      list.push({ type: 'header', key: 'h-tools', title: 'Tools' });
      tools.forEach(tool => list.push({ type: 'tool', key: `t-${tool.module}-${tool.id}`, tool }));
    }
    if (showFiles && files.length) {
      list.push({ type: 'header', key: 'h-files', title: `Files (${files.length}${files.length >= MAX_FILES ? '+' : ''})` });
      files.forEach(entry => list.push({ type: 'file', key: `f-${entry.path}`, entry }));
    }
    return list;
  }, [files, showFiles, tools]);

  const renderItem = useCallback(({ item }: { item: Row }) => {
    if (item.type === 'header') return <ThemedText style={[styles.section, { color: colors.secondaryLabel }]}>{item.title}</ThemedText>;
    if (item.type === 'file') return <ExplorerRow entry={item.entry} onPress={openFile} showFolder />;
    const { tool } = item;
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${tool.title}, ${tool.module} tool`} onPress={() => { Keyboard.dismiss(); router.navigate(tool.href); }} style={({ pressed }) => [styles.tool, { opacity: pressed ? 0.6 : 1 }]}>
        <View style={[styles.toolIcon, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios={tool.ios} android={tool.android} size={22} color={colors.systemBlue} /></View>
        <View style={styles.grow}>
          <ThemedText numberOfLines={1} style={[styles.name, { color: colors.label }]}>{tool.title}</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>{tool.module} · {tool.subtitle}</ThemedText>
        </View>
        <UniversalIcon ios="arrow.up.right" android="north-east" size={16} color={colors.muted} />
      </Pressable>
    );
  }, [colors, openFile]);

  async function allow() {
    try { await FileEngine?.requestPdfAccessAsync(); } finally { setRetry(value => value + 1); }
  }

  const empty = !term ? (
    <View style={styles.idle}>
      <ThemedText style={[styles.section, { color: colors.secondaryLabel }]}>Quick searches</ThemedText>
      <View style={styles.chips}>
        {SUGGESTIONS.map(item => (
          <Pressable key={item.label} accessibilityRole="button" onPress={() => setQuery(item.query)} style={({ pressed }) => [styles.chip, { backgroundColor: colors.tileSurface, borderColor: colors.tileBorder, opacity: pressed ? 0.7 : 1 }]}>
            <ThemedText style={{ color: colors.label, fontWeight: '600' }}>{item.label}</ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Search finds tools and files on this device by name.</ThemedText>
    </View>
  ) : loading ? <View style={styles.idle}><AppLoader /></View> : error && showFiles ? (
    <View style={styles.idle}>
      <ThemedText style={{ color: colors.secondaryLabel }}>{error}</ThemedText>
      <Pressable accessibilityRole="button" onPress={() => { void allow(); }} style={[styles.allow, getGradients(colors).module]}><ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>Allow access</ThemedText></Pressable>
    </View>
  ) : <ThemedText style={[styles.idleText, { color: colors.secondaryLabel }]}>{showFiles || !explorerAvailable() ? `No results for “${term}”.` : 'Type at least 2 letters to search files.'}</ThemedText>;

  return (
    <View style={[styles.screen, { backgroundColor: colors.systemBackground }, getGradients(colors).dashboard]}>
      <View style={styles.head}>
        <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.label }]}>Search</ThemedText>
        <View style={[styles.field, { backgroundColor: colors.tileSurface, borderColor: colors.tileBorder, boxShadow: colors.tileShadow }]}>
          <UniversalIcon ios="magnifyingglass" android="search" size={20} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Files, PDFs, tools…" placeholderTextColor={colors.muted} returnKeyType="search" autoCorrect={false} autoCapitalize="none" style={[styles.input, { color: colors.label }]} accessibilityLabel="Search files and tools" />
          {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={8}><UniversalIcon ios="xmark.circle.fill" android="cancel" size={20} color={colors.muted} /></Pressable>}
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        initialNumToRender={14}
        windowSize={7}
        ListEmptyComponent={empty}
        ListFooterComponent={rows.length && loading ? <View style={styles.footer}><AppLoader /></View> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: { paddingHorizontal: s.xl, paddingTop: s.xl, gap: s.md, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { ...t.title },
  field: { flexDirection: 'row', alignItems: 'center', gap: s.sm, minHeight: 52, paddingHorizontal: 16, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  list: { paddingHorizontal: s.xl, paddingBottom: s.section, width: '100%', maxWidth: 720, alignSelf: 'center' },
  section: { ...t.eyebrow, textTransform: 'uppercase', marginTop: s.lg, marginBottom: s.xs },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, minHeight: 64 },
  toolIcon: { width: 44, height: 44, borderRadius: 13, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, gap: 2 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { ...t.caption },
  idle: { gap: s.md, paddingTop: s.sm },
  idleText: { textAlign: 'center', paddingVertical: s.xl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm },
  chip: { minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  allow: { alignSelf: 'flex-start', minHeight: 44, borderRadius: 22, paddingHorizontal: s.xl, justifyContent: 'center' },
  footer: { paddingVertical: s.lg },
});

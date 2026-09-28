import { toolColors } from '@/theme/tool-colors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AppLoader } from '@/components/app-loader';
import { showDialog } from '@/components/app-dialog';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { getGradients, spacing as s, typography as t } from '@/theme/dashboard';
import { useScreenActive } from '@/hooks/use-screen-active';
import { FileEngine, type ExplorerEntry } from '../../../modules/file-engine';
import { ExplorerRow } from '@/features/files/explorer-row';
import { explorerAvailable, KIND_GLYPHS, openExplorerEntry } from '@/features/files/explorer';
import { importRecentFile } from '@/features/files/recent-files';
import { EDITOR_TOOL_TABS } from '@/features/files/media-toolbar';
import { ADVANCED_IMAGE_TOOLS } from '@/features/files/image-tools';
import { createImagePdfToolForFile } from '@/features/pdf/pdf-tool-session';
import { discardPdfToolSession, pickPdfTool, type PdfTool } from '@/features/pdf/pdf-tool-session';
import { SEARCH_TOOLS, SUGGESTED_TOOLS, type SearchTool } from './search-tools';
import { clearSearchHistory, hydrateSearchHistory, recordSearch, recordToolUse, removeSearch, useSearchHistory } from './search-history';
import { requestFileSearch } from './file-search';

const QUICK_SEARCHES = [
  { label: 'PDFs', query: '.pdf', kind: 'pdf' }, { label: 'JPG photos', query: '.jpg', kind: 'image' },
  { label: 'Word files', query: '.docx', kind: 'document' }, { label: 'ZIP archives', query: '.zip', kind: 'archive' },
] as const;
const MAX_FILES = 80;
const EMPTY_FILES: ExplorerEntry[] = [];
type Scope = 'All' | 'Tools' | 'Files';
type Row = { type: 'header'; key: string; title: string } | { type: 'tool'; key: string; tool: SearchTool } | { type: 'file'; key: string; entry: ExplorerEntry };
type FileResults = { key: string; files: ExplorerEntry[]; error?: string };

export function SearchScreen() {
  const colors = usePalette();
  const active = useScreenActive();
  const history = useSearchHistory();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('All');
  const [result, setResult] = useState<FileResults | null>(null);
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const list = useRef<FlatList<Row>>(null);
  const term = query.trim();
  const key = `${term}:${retry}`;
  const searchFiles = scope !== 'Tools' && term.length >= 2 && explorerAvailable();
  const loading = searchFiles && result?.key !== key;
  const files = searchFiles && result?.key === key ? result.files : EMPTY_FILES;
  const error = searchFiles && result?.key === key ? result.error : undefined;

  useEffect(() => {
    mounted.current = true; hydrateSearchHistory();
    return () => { mounted.current = false; };
  }, []);
  const tools = useMemo(() => {
    if (!term || scope === 'Files') return [];
    const words = term.toLowerCase().split(/\s+/);
    return SEARCH_TOOLS.filter(tool => words.every(word => `${tool.title} ${tool.subtitle} ${tool.module}`.toLowerCase().includes(word)))
      .sort((a, b) => Number(a.availability !== 'ready') - Number(b.availability !== 'ready')).slice(0, 20);
  }, [scope, term]);
  const recentTools = history.tools.map(id => SEARCH_TOOLS.find(tool => tool.key === id)).filter((tool): tool is SearchTool => !!tool);
  const suggestions = SUGGESTED_TOOLS.map(id => SEARCH_TOOLS.find(tool => tool.key === id)).filter((tool): tool is SearchTool => !!tool && !history.tools.includes(tool.key));

  useEffect(() => {
    if (!active || !searchFiles) return;
    let cancelled = false;
    let request: ReturnType<typeof requestFileSearch> | undefined;
    const timer = setTimeout(() => {
      request = requestFileSearch(term, MAX_FILES);
      void request.promise.then(value => { if (!cancelled) setResult({ key, files: value }); })
        .catch(cause => { if (!cancelled) setResult({ key, files: [], error: (cause as Error).message || 'Could not search your files.' }); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); request?.release(); };
  }, [active, key, searchFiles, term]);

  function search(value: string, nextScope: Scope = scope) {
    setQuery(value); setScope(nextScope); recordSearch(value);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }
  const openFile = useCallback((entry: ExplorerEntry) => {
    if (busy.current) return;
    busy.current = true; Keyboard.dismiss(); recordSearch(term); setOpening(entry.path);
    void openExplorerEntry(entry)
      .catch(cause => showDialog('Could not open file', (cause as Error).message || 'Try again.'))
      .finally(() => { busy.current = false; if (mounted.current) setOpening(null); });
  }, [term]);

  const openTool = useCallback(async (tool: SearchTool) => {
    if (busy.current || tool.availability !== 'ready') return;
    busy.current = true; setOpening(tool.key); Keyboard.dismiss();
    let session: string | null = null;
    try {
      if (tool.module === 'PDF') {
        session = await pickPdfTool(tool.id as PdfTool, tool.title);
        if (!session) return;
        if (!mounted.current) { discardPdfToolSession(session); return; }
        router.push({ pathname: '/pdf-tool', params: { session } });
      } else {
        const file = await importRecentFile('image');
        if (!file || !mounted.current) return;
        if (tool.id === 'text' || tool.id === 'edit_text') router.push({ pathname: '/image-text', params: { id: file.id, mode: tool.id === 'text' ? 'add' : 'edit' } });
        else if (tool.id === 'pdf') { session = await createImagePdfToolForFile(file); if (!mounted.current) { discardPdfToolSession(session); return; } router.push({ pathname: '/pdf-tool', params: { session } }); }
        else if (ADVANCED_IMAGE_TOOLS.has(tool.id)) router.push({ pathname: '/image-tool', params: { id: file.id, tool: tool.id } });
        else router.push({ pathname: '/image-editor', params: { id: file.id, tab: EDITOR_TOOL_TABS[tool.id] } });
      }
      recordSearch(term); recordToolUse(tool.key);
    } catch (cause) {
      if (session) discardPdfToolSession(session);
      if (mounted.current) showDialog('Could not open tool', (cause as Error).message || 'Please try again.');
    } finally { busy.current = false; if (mounted.current) setOpening(null); }
  }, [term]);

  const toolRow = useCallback((tool: SearchTool) => <Pressable key={tool.key} accessibilityRole="button"
    accessibilityLabel={`${tool.title}, ${tool.module}. ${tool.availability === 'ready' ? 'Choose a file to begin' : tool.availability === 'build' ? 'Needs a new app build' : 'Coming soon'}`}
    accessibilityState={{ disabled: tool.availability !== 'ready' || !!opening }} disabled={tool.availability !== 'ready' || !!opening}
    onPress={() => { void openTool(tool); }} style={({ pressed }) => [styles.tool, { opacity: tool.availability !== 'ready' ? 0.55 : pressed ? 0.6 : 1 }]}>
    <View style={[styles.toolIcon, { backgroundColor: toolColors(tool.id, colors).surface }]}><UniversalIcon ios={tool.ios} android={tool.android} size={22} color={toolColors(tool.id, colors).ink} /></View>
    <View style={styles.grow}><ThemedText style={styles.name}>{tool.title}</ThemedText><ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{tool.module} · {tool.availability === 'ready' ? tool.subtitle : tool.availability === 'build' ? 'Needs a new app build' : 'Coming soon'}</ThemedText></View>
    {opening === tool.key ? <AppLoader /> : tool.availability === 'ready' && <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.muted} />}
  </Pressable>, [colors, openTool, opening]);
  const rows = useMemo<Row[]>(() => {
    const items: Row[] = [];
    if (tools.length) { items.push({ type: 'header', key: 'tools', title: `Tools · ${tools.length}` }); tools.forEach(tool => items.push({ type: 'tool', key: tool.key, tool })); }
    if (files.length) { items.push({ type: 'header', key: 'files', title: `Files · ${files.length}${files.length === MAX_FILES ? '+' : ''}` }); files.forEach(entry => items.push({ type: 'file', key: entry.path, entry })); }
    return items;
  }, [files, tools]);
  const renderItem = useCallback(({ item }: { item: Row }) => item.type === 'header'
    ? <ThemedText accessibilityRole="header" style={[styles.section, { color: colors.secondaryLabel }]}>{item.title}</ThemedText>
    : item.type === 'file' ? <ExplorerRow entry={item.entry} onPress={openFile} showFolder /> : toolRow(item.tool), [colors, openFile, toolRow]);
  async function retryFiles() {
    try {
      if (error && /access|permission/i.test(error)) await FileEngine?.requestPdfAccessAsync();
      setRetry(value => value + 1);
    } catch (cause) { showDialog('File access', (cause as Error).message || 'Open system settings to review file access.'); }
  }

  const idle = <View style={styles.idle}>
    <ThemedText accessibilityRole="header" style={[styles.section, { color: colors.secondaryLabel }]}>Quick searches</ThemedText>
    <View style={styles.chips}>{QUICK_SEARCHES.map(item => {
      const icon = KIND_GLYPHS[item.kind];
      return <Pressable key={item.query} accessibilityRole="button" accessibilityLabel={`Search ${item.label}`} onPress={() => search(item.query, 'Files')}
        style={({ pressed }) => [styles.chip, { backgroundColor: colors.tileSurface, borderColor: colors.tileBorder, opacity: pressed ? 0.6 : 1 }]}>
        <UniversalIcon ios={icon.ios} android={icon.android} size={20} color={colors.systemBlue} /><ThemedText style={styles.chipLabel}>{item.label}</ThemedText>
      </Pressable>;
    })}</View>
    {!!recentTools.length && <><ThemedText accessibilityRole="header" style={[styles.section, { color: colors.secondaryLabel }]}>Recently used tools</ThemedText>{recentTools.map(toolRow)}</>}
    {!!suggestions.length && <><ThemedText accessibilityRole="header" style={[styles.section, { color: colors.secondaryLabel }]}>Try a tool</ThemedText><ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Choose a file and go straight to work.</ThemedText>{suggestions.map(toolRow)}</>}
    {!!history.queries.length && <><View style={styles.sectionRow}><ThemedText accessibilityRole="header" style={[styles.section, { color: colors.secondaryLabel }]}>Recent searches</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="Clear search and tool history" onPress={() => showDialog('Clear search history?', 'Removes recent searches and recently used tools. Your files stay unchanged.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: clearSearchHistory }])} style={styles.clear}><ThemedText style={{ color: colors.systemBlue }}>Clear</ThemedText></Pressable></View>
      {history.queries.map(value => <View key={value} style={styles.historyRow}><Pressable accessibilityRole="button" onPress={() => search(value, 'All')} style={styles.historyQuery}><UniversalIcon ios="clock" android="history" size={20} color={colors.muted} /><ThemedText numberOfLines={1} style={styles.grow}>{value}</ThemedText></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove search ${value}`} onPress={() => removeSearch(value)} style={styles.clear}><UniversalIcon ios="xmark" android="close" size={18} color={colors.muted} /></Pressable></View>)}</>}
    <View style={styles.shortcuts}><Pressable accessibilityRole="button" onPress={() => router.navigate('/(tabs)/files')} style={[styles.shortcut, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios="folder" android="folder-open" size={22} color={colors.systemBlue} /><ThemedText style={styles.chipLabel}>Browse files</ThemedText></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.navigate('/edited-files')} style={[styles.shortcut, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios="square.and.pencil" android="edit-note" size={22} color={colors.systemBlue} /><ThemedText style={styles.chipLabel}>Edited files</ThemedText></Pressable></View>
    <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{history.enabled ? 'Your recent activity stays on this device. Manage it in Settings.' : 'Search history is off. You can turn it on in Settings.'}</ThemedText>
  </View>;
  const status = !term ? null : <View style={styles.status}>
    {loading ? <View style={styles.historyQuery}><AppLoader /><ThemedText style={styles.caption}>Searching files…</ThemedText></View>
      : error ? <><ThemedText accessibilityRole="alert">{error}</ThemedText><Pressable accessibilityRole="button" onPress={() => { void retryFiles(); }} style={[styles.chip, { backgroundColor: colors.accentSurface }]}><ThemedText>{/access|permission/i.test(error) ? 'Allow file access' : 'Try again'}</ThemedText></Pressable></>
      : !rows.length && <><UniversalIcon ios="magnifyingglass" android="search" size={30} color={colors.muted} /><ThemedText>{term.length < 2 && scope !== 'Tools' ? 'Type at least 2 letters to search files.' : `No results for “${term}”.`}</ThemedText><ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Try a filename, “merge PDF” or “crop image”.</ThemedText></>}
    {scope !== 'Tools' && !explorerAvailable() && <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Device file search needs a native app build. Available tools are shown above.</ThemedText>}
    {files.length === MAX_FILES && <ThemedText style={styles.caption}>Showing the first {MAX_FILES} files. Add more of the filename to narrow your search.</ThemedText>}
  </View>;

  return <View style={[styles.screen, { backgroundColor: colors.systemBackground }, getGradients(colors).dashboard]}>
    <View style={styles.head}><ThemedText accessibilityRole="header" style={styles.title}>Search</ThemedText><ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Find a file or jump back into a tool.</ThemedText>
      <View style={[styles.field, { backgroundColor: colors.tileSurface, borderColor: colors.tileBorder }]}><UniversalIcon ios="magnifyingglass" android="search" size={22} color={colors.muted} />
        <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => { recordSearch(term); Keyboard.dismiss(); }} placeholder="Files, PDFs, tools…" placeholderTextColor={colors.muted} returnKeyType="search" autoCorrect={false} autoCapitalize="none" maxLength={100} style={[styles.input, { color: colors.label }]} accessibilityLabel="Search files and tools" />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={styles.clear}><UniversalIcon ios="xmark.circle.fill" android="cancel" size={22} color={colors.muted} /></Pressable>}
      </View>
      {!!term && <View style={styles.chips}>{(['All', 'Tools', 'Files'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: scope === value }} onPress={() => setScope(value)} style={[styles.chip, { backgroundColor: scope === value ? colors.systemBlue : colors.tileSurface, borderColor: colors.tileBorder }]}><ThemedText style={[styles.chipLabel, { color: scope === value ? colors.onAccent : colors.label }]}>{value}</ThemedText></Pressable>)}</View>}
      {!!opening && <ThemedText accessibilityLiveRegion="polite" style={styles.caption}>Opening your selection…</ThemedText>}
    </View>
    <FlatList ref={list} data={rows} keyExtractor={item => item.key} renderItem={renderItem} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list} initialNumToRender={12} maxToRenderPerBatch={8} windowSize={5} ListHeaderComponent={!term ? idle : null} ListFooterComponent={status} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, head: { paddingHorizontal: s.xl, paddingTop: s.xl, gap: s.sm, width: '100%', maxWidth: 720, alignSelf: 'center' }, title: { ...t.title },
  field: { flexDirection: 'row', alignItems: 'center', gap: s.sm, minHeight: 54, paddingLeft: 16, paddingRight: 4, borderRadius: 27, borderWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: 12 }, list: { paddingHorizontal: s.xl, paddingBottom: s.section, width: '100%', maxWidth: 720, alignSelf: 'center' },
  section: { ...t.eyebrow, textTransform: 'uppercase', marginTop: s.lg, marginBottom: s.xs }, tool: { flexDirection: 'row', alignItems: 'center', gap: s.md, paddingVertical: 10, minHeight: 64 },
  toolIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, grow: { flex: 1, minWidth: 0, gap: 2 }, name: { ...t.label }, caption: { ...t.caption },
  idle: { paddingTop: s.sm }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm, marginTop: s.sm }, chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s.sm }, chipLabel: { fontSize: 14, fontWeight: '600' },
  clear: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, historyRow: { flexDirection: 'row', alignItems: 'center' }, historyQuery: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: s.md, minHeight: 48 },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm, marginVertical: s.lg }, shortcut: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s.sm, minHeight: 52, paddingHorizontal: s.md, borderRadius: 16 }, status: { gap: s.md, paddingVertical: s.lg, alignItems: 'flex-start' },
});

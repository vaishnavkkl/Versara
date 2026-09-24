import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { FileThumbnail } from '@/components/file-thumbnail';
import { HelpButton } from '@/components/help-button';
import { AppearanceButtons } from '@/components/appearance-buttons';
import { usePalette } from '@/theme/colors';
import { getGradients } from '@/theme/dashboard';
import { useScreenActive } from '@/hooks/use-screen-active';
import { FILE_LABELS, importRecentFile, listRecentFiles, removeRecentFile, type FileKind, type RecentFile } from './recent-files';
import { formatSize } from './file-storage';

export function RecentFilesScreen({ kind }: { kind: FileKind }) {
  const colors = usePalette();
  const active = useScreenActive();
  const [files, setFiles] = useState<RecentFile[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const focused = useRef(false);
  const picking = useRef(false);
  useFocusEffect(useCallback(() => {
    // Include explicit retries and removals in the focus reload lifecycle.
    void revision;
    focused.current = true;
    setBusy(picking.current);
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void listRecentFiles(kind, search).then(items => { if (!cancelled) { setFiles(items); setError(null); } }).catch(() => {
        if (!cancelled) setError('Could not load your recent files. Try again.');
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, search ? 180 : 0);
    return () => { cancelled = true; focused.current = false; clearTimeout(timer); };
  }, [kind, search, revision]));

  function open(file: RecentFile) { router.push({ pathname: '/file-preview', params: { id: file.id } }); }
  async function browse() {
    if (picking.current) return;
    picking.current = true; setBusy(true); setError(null);
    try { const file = await importRecentFile(kind); if (file && focused.current) open(file); }
    catch (cause) { if (focused.current) setError((cause as Error).message || 'Could not open this file. Try again.'); }
    finally { picking.current = false; if (focused.current) setBusy(false); }
  }
  function remove(file: RecentFile) {
    Alert.alert('Remove from Recents?', 'The copy imported into Versara will be removed. Your original file and saved exports are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        void removeRecentFile(file).then(() => { if (focused.current) setRevision(value => value + 1); }).catch(() => { if (focused.current) setError('Could not remove this file. Try again.'); });
      } },
    ]);
  }
  return <View style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to dashboard" onPress={() => router.navigate('/(tabs)')} style={styles.iconButton}><UniversalIcon ios="chevron.left" android="arrow-back" color={colors.label} size={24} /></Pressable>
      <ThemedText accessibilityRole="header" style={styles.title}>{FILE_LABELS[kind]}</ThemedText>
      <HelpButton /><AppearanceButtons compact />
    </View>
    <View style={styles.intro}><ThemedText style={styles.heading}>Recent files</ThemedText><ThemedText style={{ color: colors.secondaryLabel }}>Open a file to preview it and choose an action.</ThemedText></View>
    <Pressable accessibilityRole="button" disabled={busy} onPress={browse} style={[styles.browse, getGradients(colors).module]}>
      {busy ? <ActivityIndicator color={colors.moduleText} /> : <UniversalIcon ios="folder.badge.plus" android="create-new-folder" size={22} color={colors.moduleText} />}
      <ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>{busy ? 'Opening files...' : `Open ${kind === 'image' || kind === 'audio' ? 'an' : 'a'} ${FILE_LABELS[kind].toLowerCase()}`}</ThemedText>
    </Pressable>
    <View style={[styles.search, { backgroundColor: colors.secondarySystemBackground }]}><UniversalIcon ios="magnifyingglass" android="search" size={20} color={colors.secondaryLabel} /><TextInput accessibilityLabel={`Search recent ${kind} files`} placeholder="Search your files" placeholderTextColor={colors.secondaryLabel} value={search} onChangeText={setSearch} autoCorrect={false} clearButtonMode="while-editing" style={[styles.input, { color: colors.label }]} /></View>
    {error && <Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)} style={styles.message}><ThemedText accessibilityRole="alert">{error} Tap to retry.</ThemedText></Pressable>}
    {loading ? <View style={styles.empty}><ActivityIndicator color={colors.systemBlue} /><ThemedText style={{ color: colors.secondaryLabel }}>Loading recent files...</ThemedText></View> : <FlatList data={files} keyExtractor={item => item.id} initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}
      renderItem={({ item }) => <View style={[styles.row, { borderColor: colors.separator }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => open(item)} style={styles.file}>
          <View style={styles.thumbnail}><FileThumbnail uri={item.uri} kind={kind} active={active} /></View>
          <View style={styles.grow}><ThemedText numberOfLines={2} style={styles.name}>{item.name}</ThemedText><ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>{formatSize(item.size)} · {new Date(item.opened).toLocaleDateString()}</ThemedText></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name} from Recents`} onPress={() => remove(item)} style={styles.iconButton}><UniversalIcon ios="minus.circle" android="remove-circle-outline" size={21} color={colors.secondaryLabel} /></Pressable>
      </View>}
      ListEmptyComponent={<View style={styles.empty}><UniversalIcon ios="folder" android="folder-open" size={40} color={colors.systemBlue} /><ThemedText style={styles.heading}>{search ? 'No matching files' : `Your ${kind === 'pdf' ? 'PDFs' : kind + ' files'} start here`}</ThemedText><ThemedText style={[styles.emptyText, { color: colors.secondaryLabel }]}>{search ? 'Try a different file name.' : 'Use the button above to choose a file. It will stay here for next time.'}</ThemedText></View>}
    />}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4, minHeight: 52 }, title: { flex: 1, fontSize: 20, fontWeight: '700' },
  iconButton: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, intro: { gap: 5, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 }, heading: { fontSize: 20, fontWeight: '600' },
  browse: { minHeight: 52, marginHorizontal: 20, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, search: { margin: 20, marginBottom: 8, minHeight: 46, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, input: { flex: 1, minHeight: 46, fontSize: 16 },
  list: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24 }, row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth }, file: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, thumbnail: { width: 48, height: 60 }, grow: { flex: 1 }, name: { fontSize: 15, fontWeight: '500' }, caption: { fontSize: 12, marginTop: 4 }, empty: { flex: 1, padding: 24, gap: 12, alignItems: 'center', justifyContent: 'center' }, emptyText: { textAlign: 'center', maxWidth: 300 }, message: { padding: 16 },
});

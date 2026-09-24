import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AppLoader } from '@/components/app-loader';
import { FileThumbnail } from '@/components/file-thumbnail';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { showDialog } from '@/components/app-dialog';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { useScreenActive } from '@/hooks/use-screen-active';
import { editedFileExists, listEditedFiles, removeEditedFile, subscribeEditedFiles, type EditedFile } from './edited-files';
import { formatSize, shareFile } from './file-storage';
import { rememberFile, type FileKind } from './recent-files';

type Filter = 'all' | FileKind;
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'pdf', label: 'PDFs' }, { id: 'image', label: 'Images' }];
const dateLabel = (value: number) => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Files saved from Versara's editors and tools, newest first. */
export function EditedFilesScreen() {
  const colors = usePalette();
  const active = useScreenActive();
  const [items, setItems] = useState<EditedFile[] | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    listEditedFiles(search, filter === 'all' ? undefined : filter)
      .then(value => { setItems(value); setError(''); })
      .catch(() => setError('Could not load your edited files.'));
  }, [search, filter]);
  useEffect(() => {
    const timer = setTimeout(load, search ? 200 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);
  useEffect(() => subscribeEditedFiles(load), [load]);

  async function open(file: EditedFile) {
    if (!editedFileExists(file)) {
      showDialog('File not found', `${file.name} is no longer in Versara. A copy may still be in ${file.location}.`, [
        { text: 'Keep', style: 'cancel' }, { text: 'Remove from list', style: 'destructive', onPress: () => { void removeEditedFile(file); } },
      ], { ios: 'exclamationmark.triangle', android: 'error-outline' });
      return;
    }
    try {
      const recent = await rememberFile({ uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size }, file.kind);
      router.push({ pathname: '/file-preview', params: { id: recent.id } });
    } catch (cause) { setError((cause as Error).message || 'Could not open this file.'); }
  }
  function remove(file: EditedFile) {
    showDialog('Remove from Edited files?', `${file.name} stays on your device in ${file.location}.`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void removeEditedFile(file); } },
    ], { ios: 'trash', android: 'delete-outline' });
  }

  return <View style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <ScreenHeader title="Edited files" onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }} />
    <View style={styles.controls}>
      <TextInput accessibilityLabel="Search edited files" placeholder="Search edited files" placeholderTextColor={colors.secondaryLabel} value={search} onChangeText={setSearch}
        style={[styles.search, { color: colors.label, backgroundColor: colors.accentSurface }]} />
      <View style={styles.filters}>
        {FILTERS.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: filter === item.id }} onPress={() => setFilter(item.id)}
          style={[styles.chip, { backgroundColor: filter === item.id ? colors.systemBlue : colors.accentSurface }]}>
          <ThemedText style={[styles.chipText, { color: filter === item.id ? colors.systemBackground : colors.systemBlue }]}>{item.label}</ThemedText>
        </Pressable>)}
      </View>
    </View>
    {!!error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
    {!items ? <View style={styles.center}><AppLoader size="large" /></View> : <FlatList data={items} keyExtractor={item => item.id} contentContainerStyle={styles.list}
      initialNumToRender={10} maxToRenderPerBatch={8} windowSize={7}
      ListEmptyComponent={<View style={styles.center}>
        <UniversalIcon ios="square.and.pencil" android="edit-note" size={40} color={colors.systemBlue} />
        <ThemedText style={styles.heading}>{search ? 'No matching files' : 'No edited files yet'}</ThemedText>
        <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Files you save from the PDF and image editors appear here.</ThemedText>
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => { void open(item); }}
        style={({ pressed }) => [styles.row, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator, opacity: pressed ? 0.7 : 1 }]}>
        <View style={styles.thumbnail}><FileThumbnail uri={item.uri} kind={item.kind} active={active} /></View>
        <View style={styles.meta}>
          <ThemedText numberOfLines={2} style={styles.name}>{item.name}</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>{dateLabel(item.modified)} · {formatSize(item.size)}</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>{item.location}</ThemedText>
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name} from Edited files`} onPress={() => remove(item)} hitSlop={6} style={styles.icon}>
            <UniversalIcon ios="xmark" android="close" size={18} color={colors.secondaryLabel} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Share ${item.name}`} onPress={() => { if (editedFileExists(item)) void shareFile({ uri: item.uri, mimeType: item.mimeType }).catch(() => {}); else void open(item); }} hitSlop={6} style={styles.icon}>
            <UniversalIcon ios="square.and.arrow.up" android="share" size={20} color={colors.systemBlue} />
          </Pressable>
        </View>
      </Pressable>} />}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { paddingHorizontal: s.lg, gap: s.sm, paddingBottom: s.sm },
  search: { ...t.body, minHeight: 44, borderRadius: radius.sm, paddingHorizontal: s.md },
  filters: { flexDirection: 'row', gap: s.sm },
  chip: { minHeight: 36, borderRadius: 18, paddingHorizontal: s.lg, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '600' },
  error: { paddingHorizontal: s.lg, paddingVertical: s.xs },
  list: { padding: s.lg, paddingTop: s.xs, gap: s.sm, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: s.md, padding: s.xl },
  heading: { ...t.heading, textAlign: 'center' },
  body: { ...t.body, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.md, padding: s.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  thumbnail: { width: 52, height: 64, borderRadius: 10, overflow: 'hidden' },
  meta: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16 },
  actions: { alignSelf: 'stretch', justifyContent: 'space-between', alignItems: 'center' },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});

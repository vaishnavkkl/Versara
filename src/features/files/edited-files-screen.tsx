import { useVisibleListItems } from '@/hooks/use-visible-list-items';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AppLoader } from '@/components/app-loader';
import { FileThumbnail } from '@/components/file-thumbnail';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { promptFileName, showDialog } from '@/components/app-dialog';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';
import { useScreenActive } from '@/hooks/use-screen-active';
import { editedFileExists, listEditedFiles, removeEditedFile, renameEditedFile, recordEditedFile, subscribeEditedFiles, type EditedFile } from './edited-files';
import { formatSize, shareNamedFile } from './file-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { askNewFileName, saveToDevice } from './save-file';
import { createPdfToolForDocument, discardPdfToolSession } from '../pdf/pdf-tool-session';
import { ToolboxSheet } from '@/components/toolbox-sheet';
import { toast } from '@/components/toast';
import { rememberFile, type FileKind } from './recent-files';

type Filter = 'all' | FileKind;
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'pdf', label: 'PDFs' }, { id: 'document', label: 'Documents' }, { id: 'image', label: 'Images' }];
const dateLabel = (value: number) => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Files saved from Versara's editors and tools, newest first. */
export function EditedFilesScreen() {
  const colors = usePalette();
  const active = useScreenActive();
  const { visibleKeys, onViewableItemsChanged, viewabilityConfig } = useVisibleListItems();
  const [items, setItems] = useState<EditedFile[] | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<EditedFile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!active) return;
    let current = true;
    let version = 0;
    const load = () => {
      const request = ++version;
      void listEditedFiles(search, filter === 'all' ? undefined : filter)
        .then(value => { if (current && request === version) { setItems(value); setError(''); } })
        .catch(() => { if (current && request === version) setError('Could not load your edited files.'); });
    };
    const timer = setTimeout(load, search ? 200 : 0);
    const unsubscribe = subscribeEditedFiles(load);
    return () => { current = false; clearTimeout(timer); unsubscribe(); };
  }, [search, filter, active]);

  async function open(file: EditedFile) {
    if (locked.current) return;
    if (!editedFileExists(file)) {
      showDialog('File not found', `${file.name} is no longer in Versara. A copy may still be in ${file.location}.`, [
        { text: 'Keep', style: 'cancel' }, { text: 'Remove from list', style: 'destructive', onPress: () => { void removeEditedFile(file); } },
      ], { ios: 'exclamationmark.triangle', android: 'error-outline' });
      return;
    }
    locked.current = true; setBusy(true);
    try {
      const recent = await rememberFile({ uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size }, file.kind);
      if (!mounted.current) return;
      if (file.kind === 'document') router.push({ pathname: '/doc-editor', params: { uri: recent.uri, name: recent.name, format: recent.name.toLowerCase().endsWith('.txt') ? 'txt' : 'docx' } });
      else router.push({ pathname: '/file-preview', params: { id: recent.id } });
    } catch (cause) { if (mounted.current) setError((cause as Error).message || 'Could not open this file.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  function remove(file: EditedFile) {
    showDialog('Remove from Edited files?', `${file.name} stays on your device in ${file.location}.`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void removeEditedFile(file); } },
    ], { ios: 'trash', android: 'delete-outline' });
  }

  async function action(id: string) {
    const file = menu;
    if (!file || locked.current) return;
    if (id === 'remove') { remove(file); return; }
    if (!editedFileExists(file)) { await open(file); return; }
    if (id === 'open') { await open(file); return; }
    locked.current = true; setBusy(true);
    try {
      if (id === 'edit') {
        if (file.kind === 'document') {
          if (mounted.current) router.push({ pathname: '/doc-editor', params: { uri: file.uri, name: file.name, format: file.name.toLowerCase().endsWith('.txt') ? 'txt' : 'docx' } });
        } else if (file.kind === 'pdf') {
          const session = await createPdfToolForDocument('edit_text', 'Edit PDF', file);
          if (!session) return;
          if (mounted.current) router.push({ pathname: '/pdf-tool', params: { session } });
          else discardPdfToolSession(session);
        } else {
          const recent = await rememberFile(file, file.kind);
          if (mounted.current) router.push({ pathname: '/image-editor', params: { id: recent.id } });
        }
      } else if (id === 'rename') {
        const extension = file.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '';
        const name = await promptFileName(file.name, value => !value.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(value) || /^\.+$/.test(value) ? 'Enter a valid file name.' : '', { title: 'Rename in Versara', message: 'Changes the name here. Existing copies in device folders keep their names.', action: 'Rename' });
        if (name && mounted.current) await renameEditedFile(file, name.toLowerCase().endsWith(extension.toLowerCase()) ? name : name + extension);
      } else if (id === 'duplicate') {
        const name = await askNewFileName(file.name.replace(/(\.[^.]+)$/, ' - copy$1'));
        if (!name || !mounted.current) return;
        const folder = new Directory(Paths.document, 'Versara Copies'); folder.create({ intermediates: true, idempotent: true });
        const copy = new File(folder, `${Date.now()}-${Math.random().toString(36).slice(2)}${name.match(/\.[^.]+$/)?.[0] ?? ''}`);
        try { await new File(file.uri).copy(copy); await recordEditedFile({ uri: copy.uri, name, kind: file.kind, mimeType: file.mimeType, size: copy.size, deviceUri: '', location: 'Versara - app storage' }); }
        catch (cause) { if (copy.exists) copy.delete(); throw cause; }
        toast('Copy added to Edited files');
      } else if (id === 'save') {
        const saved = await saveToDevice(file.uri, file.name, file.mimeType);
        await recordEditedFile({ ...file, deviceUri: saved.uri, location: saved.location });
        toast(`Saved to ${saved.location}`);
      } else if (id === 'share') {
        await shareNamedFile(file);
      } else if (id === 'info') showDialog('File details', `${file.name}\n${file.mimeType}\n${formatSize(file.size)}\nModified ${dateLabel(file.modified)}\n${file.location}`);
    } catch (cause) { if (mounted.current) setError((cause as Error).message || 'Could not complete this action.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const openRow = useStableCallback(open);
  const showMenu = useCallback((file: EditedFile) => { setMenu(file); setMenuOpen(true); }, []);
  const renderItem = useCallback(({ item }: { item: EditedFile }) => <EditedFileRow item={item} active={active && visibleKeys.has(item.id)} busy={busy} onOpen={openRow} onMenu={showMenu} />, [active, visibleKeys, busy, openRow, showMenu]);

  const actions = [{ title: 'File actions', data: [
    { id: 'open', title: 'Open', subtitle: '', ios: 'doc', android: 'open-in-new' },
    { id: 'edit', title: 'Edit', subtitle: '', ios: 'square.and.pencil', android: 'edit' },
    { id: 'rename', title: 'Rename', subtitle: '', ios: 'pencil', android: 'drive-file-rename-outline' },
    { id: 'duplicate', title: 'Duplicate', subtitle: '', ios: 'doc.on.doc', android: 'file-copy' },
    { id: 'save', title: 'Save to device', subtitle: '', ios: 'square.and.arrow.down', android: 'save-alt' },
    { id: 'share', title: 'Share', subtitle: '', ios: 'square.and.arrow.up', android: 'share' },
    { id: 'info', title: 'Details', subtitle: '', ios: 'info.circle', android: 'info-outline' },
    { id: 'remove', title: 'Remove from list', subtitle: '', ios: 'trash', android: 'delete-outline' },
  ] }] satisfies import('@/components/tool-grid').ToolSection[];

  return <View style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <ScreenHeader title="Edited files" onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }} />
    <View style={styles.controls}>
      <TextInput accessibilityLabel="Search edited files" placeholder="Search edited files" placeholderTextColor={colors.secondaryLabel} value={search} onChangeText={setSearch}
        style={[styles.search, { color: colors.label, backgroundColor: colors.fieldSurface }]} />
      <View style={styles.filters}>
        {FILTERS.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: filter === item.id }} onPress={() => setFilter(item.id)}
          style={[styles.chip, { backgroundColor: filter === item.id ? colors.systemBlue : colors.fieldSurface }]}>
          <ThemedText style={[styles.chipText, { color: filter === item.id ? colors.systemBackground : colors.systemBlue }]}>{item.label}</ThemedText>
        </Pressable>)}
      </View>
    </View>
    {!!error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
    {!items ? <View style={styles.center}><AppLoader size="large" /></View> : <FlatList onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig} data={items} keyExtractor={item => item.id} contentContainerStyle={styles.list}
      initialNumToRender={10} maxToRenderPerBatch={4} windowSize={5}
      ListEmptyComponent={<View style={styles.center}>
        <UniversalIcon ios="square.and.pencil" android="edit-note" size={40} color={colors.systemBlue} />
        <ThemedText style={styles.heading}>{search ? 'No matching files' : 'No edited files yet'}</ThemedText>
        <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>Files you save from the PDF and image editors appear here.</ThemedText>
      </View>}
      renderItem={renderItem} />}
    <ToolboxSheet visible={menuOpen && active} title="File actions" subtitle={menu?.name ?? 'Edited file'} sections={actions} footer={<View />} onClose={() => setMenuOpen(false)} onAction={id => void action(id)} />
  </View>;
}

const EditedFileRow = memo(function EditedFileRow({ item, active, busy, onOpen, onMenu }: {
  item: EditedFile; active: boolean; busy: boolean; onOpen: (file: EditedFile) => Promise<void>; onMenu: (file: EditedFile) => void;
}) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} disabled={busy} onPress={() => { void onOpen(item); }}
        style={({ pressed }) => [styles.row, { backgroundColor: colors.catalogSurface, borderColor: colors.separator, opacity: pressed ? 0.7 : 1 }]}>
        <View style={styles.thumbnail}><FileThumbnail uri={item.uri} kind={item.kind} active={active} /></View>
        <View style={styles.meta}>
          <ThemedText numberOfLines={2} style={styles.name}>{item.name}</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>{dateLabel(item.modified)} · {formatSize(item.size)}</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>{item.location}</ThemedText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${item.name}`} disabled={busy} onPress={() => { onMenu(item); }} style={styles.icon}><UniversalIcon ios="ellipsis" android="more-horiz" size={24} color={colors.label} /></Pressable>
      </Pressable>;
});

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
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});

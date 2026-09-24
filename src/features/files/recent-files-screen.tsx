import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { router, useFocusEffect } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { FileThumbnail } from '@/components/file-thumbnail';
import { HelpButton } from '@/components/help-button';
import { LayoutToggle, useLayoutPreference } from '@/components/layout-toggle';
import RecentImagesView, { hasNativeImageList, hasNativeMediaList } from '../../../modules/file-engine/src/RecentImagesView';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing, typography } from '@/theme/dashboard';
import { useScreenActive } from '@/hooks/use-screen-active';
import {
  FILE_LABELS,
  RECENT_LIMIT,
  importDeviceRecent,
  importRecentFile,
  listCategoryFiles,
  removeRecentFile,
  type FileKind,
  type RecentFile,
  type RecentListItem,
} from './recent-files';
import { formatSize } from './file-storage';
import { getFileAccessStatus, requestFileAccess, wasFileAccessAsked } from './file-access';
import { FileEngine } from '../../../modules/file-engine';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { hasNativePdfLibrary, useDevicePdfs } from './use-device-pdfs';

const emptyCopy: Record<FileKind, { title: string; body: string }> = {
  pdf: { title: 'Your PDFs start here', body: 'Open a PDF once and it stays in Recents for quick access next time.' },
  image: { title: 'Your images start here', body: 'Allow file access to see recent photos, or open one to keep it here.' },
  video: { title: 'Your videos start here', body: 'Allow file access to see recent videos, or open one to keep it here.' },
  audio: { title: 'Your audio starts here', body: 'Open an audio file once and it stays in Recents for quick access next time.' },
};

// Tabs revisit these lists constantly. Keep the last result per tab so returning shows it instantly,
// and only hand the native list a new array when something actually changed.
type CachedList = { items: RecentListItem[]; signature: string; loaded: number };
const listCache = new Map<string, CachedList>();
const REFRESH_AFTER_MS = 4000;
const signatureOf = (items: RecentListItem[]) => items.map(item => `${item.id}:${item.opened}:${item.size}`).join('|');
function cacheList(key: string, value: CachedList) {
  listCache.delete(key);
  listCache.set(key, value);
  if (listCache.size > 8) listCache.delete(listCache.keys().next().value!);
}

export function RecentFilesScreen({ kind }: { kind: FileKind }) {
  const colors = usePalette();
  const active = useScreenActive();
  const [grid] = useLayoutPreference();
  const [libraryFiles, setFiles] = useState<RecentListItem[]>(() => listCache.get(`${kind}|`)?.items ?? []);
  const [search, setSearch] = useState('');
  const pdfs = useDevicePdfs(kind === 'pdf' && active, search);
  const [accessBusy, setAccessBusy] = useState(false);
  const files = useMemo(() => kind === 'pdf' && hasNativePdfLibrary
    ? [...libraryFiles, ...pdfs.items].sort((a, b) => b.opened - a.opened).slice(0, RECENT_LIMIT)
    : libraryFiles, [kind, libraryFiles, pdfs.items]);
  const [loading, setLoading] = useState(() => !listCache.has(`${kind}|`));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessHint, setAccessHint] = useState(false);
  const [revision, setRevision] = useState(0);
  const focused = useRef(false);
  const picking = useRef(false);

  const lastRevision = useRef(revision);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const key = `${kind}|${search.trim()}`;
    const cached = listCache.get(key);
    const forced = lastRevision.current !== revision;
    lastRevision.current = revision;
    setBusy(picking.current);
    let cancelled = false;
    void getFileAccessStatus().then(status => {
      if (!cancelled) setAccessHint(kind !== 'pdf' && (status === 'denied' || status === 'undetermined') && wasFileAccessAsked());
    });
    if (cached) { setFiles(current => current === cached.items ? current : cached.items); setLoading(false); }
    if (cached && !forced && Date.now() - cached.loaded < REFRESH_AFTER_MS) return () => { cancelled = true; focused.current = false; };
    const timer = setTimeout(() => {
      void listCategoryFiles(kind, search).then(items => {
        if (cancelled) return;
        const signature = signatureOf(items);
        const previous = listCache.get(key);
        const next = previous?.signature === signature ? previous.items : items;
        cacheList(key, { items: next, signature, loaded: Date.now() });
        setFiles(next); setError(null);
      }).catch(() => {
        if (!cancelled) setError('Could not load your recent files. Try again.');
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, search ? 180 : 0);
    return () => { cancelled = true; focused.current = false; clearTimeout(timer); };
  }, [kind, search, revision]));

  function openLibrary(file: RecentFile) { router.push({ pathname: '/file-preview', params: { id: file.id } }); }

  async function openItem(item: RecentListItem) {
    if (picking.current) return;
    if (item.source === 'library') { openLibrary(item); return; }
    picking.current = true; setBusy(true); setError(null);
    toast(`Opening ${item.name}…`);
    try {
      const file = await importDeviceRecent(item);
      if (focused.current) openLibrary(file);
    } catch (cause) {
      if (focused.current) setError((cause as Error).message || 'Could not open this file. Try again.');
    } finally {
      picking.current = false;
      if (focused.current) setBusy(false);
    }
  }

  async function browse() {
    if (picking.current) return;
    picking.current = true; setBusy(true); setError(null);
    try {
      if (kind !== 'pdf') {
        const status = await getFileAccessStatus();
        if (status === 'denied' || status === 'undetermined') await requestFileAccess();
      }
      const file = await importRecentFile(kind);
      if (file && focused.current) openLibrary(file);
    } catch (cause) {
      if (focused.current) setError((cause as Error).message || 'Could not open this file. Try again.');
    } finally {
      picking.current = false;
      if (focused.current) {
        setBusy(false);
        void getFileAccessStatus().then(status => {
          if (focused.current) setAccessHint(kind !== 'pdf' && (status === 'denied' || status === 'undetermined') && wasFileAccessAsked());
        });
        setRevision(value => value + 1);
      }
    }
  }

  function remove(file: RecentFile) {
    showDialog('Remove from Recents?', 'The copy imported into Versara will be removed. Your original file and saved exports are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        void removeRecentFile(file).then(() => { toast('Removed from Recents'); if (focused.current) setRevision(value => value + 1); }).catch(() => {
          if (focused.current) setError('Could not remove this file. Try again.');
        });
      } },
    ], { ios: 'trash', android: 'delete-outline' });
  }

  function requestPdfAccess() {
    if (!FileEngine || accessBusy) return;
    setAccessBusy(true);
    void FileEngine.requestPdfAccessAsync().then(() => { if (focused.current) pdfs.refresh(); })
      .catch(cause => { if (focused.current) setError((cause as Error).message || 'Could not open storage settings.'); })
      .finally(() => { if (focused.current) setAccessBusy(false); });
  }

  const label = FILE_LABELS[kind];
  const article = kind === 'image' || kind === 'audio' ? 'an' : 'a';
  const nativeItems = useMemo(() => JSON.stringify(files.map(item => ({
    id: item.id, uri: item.uri, name: item.name, kind: item.kind, removable: item.source === 'library',
    detail: `${item.source === 'device' ? 'On this device' : 'In Versara'} · ${formatSize(item.size)} · ${new Date(item.opened).toLocaleDateString()}`,
  }))), [files]);
  const nativePalette = JSON.stringify({ label: colors.label, secondary: colors.secondaryLabel, surface: colors.secondarySystemBackground });

  return (
    <View style={[styles.screen, getGradients(colors).page]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to dashboard" onPress={() => router.navigate('/(tabs)')} style={styles.iconButton}>
          <UniversalIcon ios="chevron.left" android="arrow-back" color={colors.label} size={24} />
        </Pressable>
        <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.label }]}>{label}</ThemedText>
        <HelpButton /><LayoutToggle />
      </View>

      <View style={styles.toolbar}>
        <View style={[styles.search, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}>
          <UniversalIcon ios="magnifyingglass" android="search" size={20} color={colors.secondaryLabel} />
          <TextInput
            accessibilityLabel={`Search recent ${kind} files`}
            placeholder={`Search ${kind === 'pdf' ? 'PDFs' : kind === 'audio' ? 'audio' : `${label.toLowerCase()}s`}`}
            placeholderTextColor={colors.secondaryLabel}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[styles.input, { color: colors.label }]}
          />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${article} ${label.toLowerCase()}`} disabled={busy} onPress={() => { void browse(); }} style={[styles.browse, getGradients(colors).module, { borderColor: colors.moduleBorder }]}>
          {busy ? <AppLoader color={colors.moduleText} /> : <UniversalIcon ios="folder.badge.plus" android="create-new-folder" size={20} color={colors.moduleText} />}
          <ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>Open</ThemedText>
        </Pressable>
      </View>

      {kind === 'pdf' && Platform.OS !== 'web' && (hasNativePdfLibrary ? <View style={styles.pdfStatus}>
        {pdfs.access ? <>
          <ThemedText style={[styles.caption, styles.grow, { color: colors.secondaryLabel }]}>{search ? 'Matching recent PDFs' : `Recent PDFs on this device${Platform.OS === 'ios' ? ' folders' : ''}`}</ThemedText>
          {Platform.OS === 'ios' && <Pressable accessibilityRole="button" accessibilityLabel="Add PDF folder" disabled={accessBusy} onPress={requestPdfAccess} style={styles.pageButton}><UniversalIcon ios="folder.badge.plus" android="create-new-folder" size={20} color={colors.systemBlue} /></Pressable>}
          {pdfs.loading ? <View style={styles.pageButton}><AppLoader size="small" /></View>
            : <Pressable accessibilityRole="button" accessibilityLabel="Refresh recent PDFs" onPress={pdfs.refresh} style={styles.pageButton}><UniversalIcon ios="arrow.clockwise" android="refresh" size={20} color={colors.systemBlue} /></Pressable>}
        </> : <Pressable accessibilityRole="button" disabled={accessBusy} onPress={requestPdfAccess} style={[styles.accessButton, { backgroundColor: colors.accentSurface }]}>
          <UniversalIcon ios="folder.badge.plus" android="folder-shared" size={18} color={colors.systemBlue} />
          <ThemedText style={[styles.accessText, { color: colors.systemBlue }]}>{accessBusy ? 'Opening…' : Platform.OS === 'ios' ? 'Add a PDF folder to show recent PDFs' : 'Allow file access to show recent PDFs'}</ThemedText>
        </Pressable>}
      </View> : <ThemedText style={styles.message}>Install a new development build to enable native device PDF access.</ThemedText>)}
      {kind === 'pdf' && !!pdfs.error && <ThemedText accessibilityRole="alert" style={[styles.caption, styles.inset, { color: colors.label }]}>{pdfs.error}</ThemedText>}

      {accessHint && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void requestFileAccess().then(() => setRevision(value => value + 1));
          }}
          style={[styles.hint, { backgroundColor: colors.accentSurface, borderColor: colors.borderHighlight }]}
        >
          <UniversalIcon ios="lock.open" android="lock-open" size={18} color={colors.systemBlue} />
          <ThemedText style={[styles.hintText, { color: colors.systemBlue }]}>File access is off. Tap to allow access for recent device files.</ThemedText>
        </Pressable>
      )}

      {error && (
        <Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)} style={styles.message}>
          <ThemedText accessibilityRole="alert" style={{ color: colors.label }}>{error} Tap to retry.</ThemedText>
        </Pressable>
      )}
      {kind === 'image' && Platform.OS !== 'web' && !hasNativeImageList && <ThemedText style={styles.message}>Install a new development build to use the native image library.</ThemedText>}

      {loading ? (
        <View style={styles.empty}>
          <AppLoader />
          <ThemedText style={{ color: colors.secondaryLabel }}>Loading recent files...</ThemedText>
        </View>
      ) : (kind === 'image' || kind === 'pdf' || ((kind === 'video' || kind === 'audio') && hasNativeMediaList)) && RecentImagesView && Platform.OS !== 'web' && files.length > 0 ? (
        <RecentImagesView
          style={styles.nativeList}
          items={nativeItems} palette={nativePalette} grid={grid} disabled={busy}
          onOpen={({ nativeEvent }) => { const item = files.find(file => file.id === nativeEvent.id); if (item) void openItem(item); }}
          onRemove={({ nativeEvent }) => { const item = files.find(file => file.id === nativeEvent.id); if (item?.source === 'library' && !busy) remove(item); }}
        />
      ) : (
        <FlatList
          key={grid ? 'grid' : 'list'}
          numColumns={grid ? 2 : 1}
          columnWrapperStyle={grid ? styles.columns : undefined}
          data={files}
          keyExtractor={item => item.id}
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={5}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const fromDevice = item.source === 'device';
            return (
              <View style={[styles.row, grid && styles.gridCell, { borderColor: colors.separator, backgroundColor: colors.secondarySystemBackground }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} disabled={busy} onPress={() => { void openItem(item); }} style={[styles.file, grid && styles.gridFile]}>
                  <View style={[styles.thumbnail, grid && styles.gridThumbnail]}>
                    {!fromDevice || (kind === 'image' && item.uri.startsWith('content://'))
                      ? <FileThumbnail uri={item.uri} kind={kind} active={active} />
                      : <View style={[styles.deviceThumb, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios={kind === 'video' ? 'play.rectangle' : kind === 'audio' ? 'waveform' : kind === 'image' ? 'photo' : 'doc.richtext'} android={kind === 'video' ? 'smart-display' : kind === 'audio' ? 'graphic-eq' : kind === 'image' ? 'image' : 'picture-as-pdf'} size={22} color={colors.systemBlue} /></View>}
                  </View>
                  <View style={styles.grow}>
                    <ThemedText numberOfLines={2} style={[styles.name, { color: colors.label }]}>{item.name}</ThemedText>
                    <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>
                      {fromDevice ? 'On this device' : 'In Versara'} · {formatSize(item.size)} · {new Date(item.opened).toLocaleDateString()}
                    </ThemedText>
                  </View>
                </Pressable>
                {!fromDevice && (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name} from Recents`} onPress={() => remove(item)} style={[styles.iconButton, grid ? styles.removeCorner : styles.removeTop]}>
                    <UniversalIcon ios="xmark.circle.fill" android="cancel" size={20} color={colors.secondaryLabel} />
                  </Pressable>
                )}
              </View>
            );
          }}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, getGradients(colors).module, { borderColor: colors.moduleBorder }]}>
                <UniversalIcon ios="folder" android="folder-open" size={28} color={colors.moduleText} />
              </View>
              <ThemedText style={[styles.heading, { color: colors.label }]}>{search ? 'No matching files' : emptyCopy[kind].title}</ThemedText>
              <ThemedText style={[styles.emptyText, { color: colors.secondaryLabel }]}>{search ? 'Try a different file name.' : emptyCopy[kind].body}</ThemedText>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, gap: spacing.xs, minHeight: 52 },
  title: { flex: 1, ...typography.heading },
  iconButton: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  heading: { ...typography.heading, fontSize: 20, lineHeight: 26 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  browse: { minHeight: 46, paddingHorizontal: spacing.lg, borderRadius: radius.sm, borderCurve: 'continuous', borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  hint: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hintText: { flex: 1, ...typography.caption },
  search: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: { flex: 1, minHeight: 46, fontSize: 16 },
  list: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
  },
  file: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  nativeList: { flex: 1 },
  columns: { gap: spacing.sm },
  gridCell: { width: '48%', flexDirection: 'column', alignItems: 'stretch' },
  gridFile: { flexDirection: 'column', alignItems: 'flex-start' },
  gridThumbnail: { width: '100%', aspectRatio: 1, alignSelf: 'center' },
  thumbnail: { width: 36, height: 44 },
  deviceThumb: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  name: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  caption: { fontSize: 10, lineHeight: 14, marginTop: spacing.xs },
  accessButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', borderRadius: 12, gap: 8, paddingHorizontal: spacing.md },
  accessText: { flex: 1, ...typography.caption, fontWeight: '600' },
  pdfStatus: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: spacing.lg, paddingRight: spacing.sm, marginBottom: spacing.xs },
  inset: { paddingHorizontal: spacing.lg },
  removeCorner: { position: 'absolute', top: spacing.xs, right: spacing.xs },
  removeTop: { alignSelf: 'flex-start' },
  pageButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
  empty: { flex: 1, padding: spacing.xxl, gap: spacing.md, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 56, height: 56, borderRadius: radius.sm, borderCurve: 'continuous', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', maxWidth: 300, ...typography.body },
  message: { padding: spacing.lg },
});

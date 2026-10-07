import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppLoader } from '@/components/app-loader';
import { showDialog } from '@/components/app-dialog';
import { FileThumbnail } from '@/components/file-thumbnail';
import { useLayoutPreference } from '@/components/layout-toggle';
import { ThemedText } from '@/components/themed-text';
import { toast } from '@/components/toast';
import { UniversalIcon } from '@/components/universal-icon';
import { useScreenActive } from '@/hooks/use-screen-active';
import { useVisibleListItems } from '@/hooks/use-visible-list-items';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t } from '@/theme/dashboard';
import { openPdfScreen } from '@/features/pdf/open-pdf-screen';
import { formatSize } from './file-storage';
import { stagePreviewFile } from './preview-handoff';
import { importDeviceRecent, listRecentFiles, RECENT_LIMIT, type RecentFile, type RecentListItem } from './recent-files';
import { formatWhen, showRecentFileActions } from './recent-file-actions';
import { getLibraryRevision, useLibraryRevision } from './library-revision';
import type { FilePickerSelection } from './file-picker-session';
import { compareFiles, FileSortMenu, useFileSort } from './file-sort-menu';
import { isFileBookmarked, useBookmarks } from './bookmarks';
import { toggleFileBookmarkWithFeedback } from './bookmark-actions';

type Filter = 'all' | 'pdf' | 'image' | 'bookmarked';
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'pdf', label: 'PDF' }, { id: 'image', label: 'Images' }, { id: 'bookmarked', label: 'Bookmarked' }];
const MORE: Record<Exclude<Filter, 'all' | 'bookmarked'>, { label: string; href: '/(modules)/documents' | '/(modules)/image' }> = {
  pdf: { label: 'All PDFs', href: '/(modules)/documents' }, image: { label: 'All images', href: '/(modules)/image' },
};
type Cached = { items: RecentListItem[]; revision: number; loaded: number };
// Three bounded snapshots: PDF selection, image selection, and browsing all.
const cache = new Map<'pdf' | 'image' | 'any', Cached>();

/** Owns the Files screen's only scroll container; roots are its list header. */
export function RecentFilesSection({ picker, header }: { picker?: FilePickerSelection; header?: ReactNode } = {}) {
  const colors = usePalette();
  const active = useScreenActive();
  const libraryRevision = useLibraryRevision();
  const [filter, setFilter] = useState<Filter>('all');
  const pickerKind = picker?.kind;
  const currentFilter = pickerKind && pickerKind !== 'any' ? pickerKind : filter;
  const cacheKey = pickerKind ?? 'any';
  const [library, setLibrary] = useState<RecentListItem[]>(() => cache.get(cacheKey)?.items ?? []);
  const [loading, setLoading] = useState(() => !cache.has(cacheKey));
  const [error, setError] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const forced = useRef(refreshRevision);
  const [gridPreference] = useLayoutPreference();
  const { width, fontScale } = useWindowDimensions();
  const gridAvailable = width >= 340 && fontScale <= 1.5;
  const grid = gridPreference && gridAvailable;
  const [sort, setSort] = useFileSort('recent');
  const { visibleKeys, onViewableItemsChanged, viewabilityConfig } = useVisibleListItems();
  const selectedUris = useMemo(() => new Set(picker?.selected.map(file => file.uri)), [picker?.selected]);
  const [opening, setOpening] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(() => {
    if (!active) return;
    let cancelled = false, failed = false;
    const cached = cache.get(cacheKey);
    const refresh = forced.current !== refreshRevision;
    forced.current = refreshRevision;
    if (cached) setLibrary(cached.items);
    if (!refresh && cached?.revision === libraryRevision && Date.now() - cached.loaded < 4000) { setLoading(false); return; }
    setLoading(true); setError('');
    const kinds = pickerKind && pickerKind !== 'any' ? [pickerKind] : ['pdf', 'image'] as const;
    void Promise.all(kinds.map(kind => listRecentFiles(kind).then(files => files.map((file): RecentListItem => ({ ...file, source: 'library' }))).catch(cause => {
      failed = true;
      if (!cancelled) setError((cause as Error).message || 'Could not load recent files. Pull down to retry.');
      return [] as RecentListItem[];
    }))).then(groups => {
      if (cancelled || getLibraryRevision() !== libraryRevision) return;
      const next = groups.flat();
      if (!failed) cache.set(cacheKey, { items: next, revision: libraryRevision, loaded: Date.now() });
      setLibrary(next);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, cacheKey, libraryRevision, pickerKind, refreshRevision]);
  useFocusEffect(load);
  const refresh = useStableCallback(() => setRefreshRevision(value => value + 1));

  const bookmarks = useBookmarks(state => state.items);
  // Only files opened or saved in Versara, newest first. Device PDFs are browsed under All PDFs.
  const items = useMemo(() => library.filter(item => currentFilter === 'all' || (currentFilter === 'bookmarked' ? isFileBookmarked(bookmarks, item) : item.kind === currentFilter))
    .sort((a, b) => b.opened - a.opened || a.name.localeCompare(b.name)).slice(0, RECENT_LIMIT), [library, currentFilter, bookmarks]);
  const sortedItems = useMemo(() => [...items].sort((a, b) => compareFiles(a, b, sort)), [items, sort]);

  const press = useStableCallback((item: RecentListItem) => {
    if (picker) {
      picker.onSelect({ path: item.uri.startsWith('file://') ? decodeURIComponent(item.uri.slice('file://'.length)) : item.uri,
        uri: item.uri, name: item.name, directory: false, kind: item.kind,
        mimeType: item.mimeType, size: item.size, modified: item.opened, count: 0 });
      return;
    }
    if (busy.current) return;
    busy.current = true; setOpening(item.id);
    void (async () => {
      try {
        if (item.source === 'device') toast(`Opening ${item.name}…`);
        const file: RecentFile = item.source === 'library' ? item : await importDeviceRecent(item);
        if (file.kind === 'pdf') openPdfScreen(file);
        else { stagePreviewFile(file); router.push({ pathname: '/file-preview', params: { id: file.id } }); }
      } catch (cause) { showDialog('Could not open file', (cause as Error).message || 'Try again.', undefined, { ios: 'exclamationmark.triangle', android: 'error-outline' }); }
      finally { busy.current = false; setOpening(null); }
    })();
  });
  const actions = useStableCallback((item: RecentListItem) => {
    if (picker) return;
    showRecentFileActions(item, () => {
      const remove = (list: RecentListItem[]) => list.filter(entry => entry.id !== item.id);
      for (const [key, value] of cache) cache.set(key, { ...value, items: remove(value.items) });
      setLibrary(remove);
      refresh();
    });
  });
  const selecting = !!picker;
  const renderItem = useCallback(({ item }: { item: RecentListItem }) => <RecentFileRow item={item} grid={grid} active={active && visibleKeys.has(item.id)} checked={selectedUris.has(item.uri)} selecting={selecting} disabled={!!opening} opening={opening === item.id}
    bookmarked={isFileBookmarked(bookmarks, item)} onPress={press} onActions={actions} />,
    [grid, active, visibleKeys, selectedUris, selecting, opening, press, actions, bookmarks]);

  return <FlatList key={grid ? 'grid' : 'list'} data={sortedItems} numColumns={grid ? 2 : 1} keyExtractor={item => item.id} renderItem={renderItem}
    style={{ flex: 1, backgroundColor: colors.systemBackground }} contentContainerStyle={styles.content} columnWrapperStyle={grid ? styles.columns : undefined}
    initialNumToRender={8} maxToRenderPerBatch={4} windowSize={5} updateCellsBatchingPeriod={32}
    onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
    refreshing={loading} onRefresh={refresh} keyboardShouldPersistTaps="handled"
    ListHeaderComponent={<>{header}<View style={styles.section}>
      <View style={styles.titleRow}>
        <ThemedText accessibilityRole="header" style={styles.title}>Recent files</ThemedText>
        {!picker && filter !== 'all' && filter !== 'bookmarked' && <Pressable accessibilityRole="link" onPress={() => router.navigate(MORE[filter].href)} hitSlop={8}>
          <ThemedText style={{ color: colors.systemBlue, fontWeight: '600' }}>{MORE[filter].label}</ThemedText>
        </Pressable>}
      </View>
      <View style={styles.controls}>
        {(!pickerKind || pickerKind === 'any') ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.grow} contentContainerStyle={styles.chips} accessibilityRole="tablist">
          {FILTERS.map(option => <Pressable key={option.id} accessibilityRole="tab" accessibilityState={{ selected: option.id === filter }} onPress={() => setFilter(option.id)}
            style={[styles.chip, { backgroundColor: option.id === filter ? colors.systemBlue : colors.tileSurface, borderColor: option.id === filter ? colors.systemBlue : colors.tileBorder }]}>
            <ThemedText style={[styles.chipText, { color: option.id === filter ? '#FFFFFF' : colors.label }]}>{option.label}</ThemedText>
          </Pressable>)}
        </ScrollView> : <View style={styles.grow} />}
        <FileSortMenu sort={sort} onChange={setSort} />
      </View>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View></>}
    ListEmptyComponent={loading ? <View style={styles.empty}><AppLoader /></View>
      : <ThemedText style={[styles.empty, { color: colors.secondaryLabel }]}>{currentFilter === 'all' ? 'Files you open or save will appear here.' : currentFilter === 'bookmarked' ? 'No bookmarks yet. Tap the bookmark button at the top of a PDF page or image.' : `No recent ${currentFilter === 'pdf' ? 'PDFs' : 'images'} yet.`}</ThemedText>} />;
}

const RecentFileRow = memo(function RecentFileRow({ item, grid, active, checked, selecting, disabled, opening, bookmarked, onPress, onActions }: {
  item: RecentListItem; grid: boolean; active: boolean; checked: boolean; selecting: boolean; disabled: boolean; opening: boolean; bookmarked: boolean;
  onPress: (item: RecentListItem) => void; onActions: (item: RecentListItem) => void;
}) {
  const colors = usePalette();
  return <Pressable accessibilityRole={selecting ? 'checkbox' : 'button'} accessibilityState={selecting ? { checked, disabled } : { disabled }} accessibilityLabel={`${selecting ? 'Select' : 'Open'} ${item.name}`} disabled={disabled}
    onPress={() => onPress(item)} onLongPress={selecting ? undefined : () => onActions(item)}
    style={({ pressed }) => [styles.row, grid && styles.gridCell, { backgroundColor: colors.tileSurface, borderColor: checked ? colors.systemBlue : colors.tileBorder, opacity: pressed ? 0.8 : 1 }]}>
    <View style={[styles.thumb, grid && styles.gridThumb]}><FileThumbnail uri={item.uri} kind={item.kind} revision={`${item.opened}:${item.size}`} active={active} /></View>
    <View style={grid ? styles.gridMeta : styles.grow}>
      <ThemedText numberOfLines={grid ? 2 : 1} style={styles.name}>{item.name}</ThemedText>
      <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>{formatSize(item.size)} · {formatWhen(item.opened)}</ThemedText>
    </View>
    {!selecting && (item.kind === 'pdf' || item.kind === 'image') && <Pressable accessibilityRole="button" accessibilityLabel={bookmarked ? `Remove bookmark from ${item.name}` : `Bookmark ${item.name}`} accessibilityState={{ selected: bookmarked }}
      onPress={() => toggleFileBookmarkWithFeedback(item)} hitSlop={4} style={[styles.bookmark, grid && styles.bookmarkCorner]}>
      <UniversalIcon ios={bookmarked ? 'bookmark.fill' : 'bookmark'} android={bookmarked ? 'bookmark' : 'bookmark-border'} size={20} color={grid ? '#FFFFFF' : bookmarked ? colors.systemBlue : colors.secondaryLabel} />
    </Pressable>}
    <View style={grid ? styles.corner : undefined}>{selecting ? <UniversalIcon ios={checked ? 'checkmark.circle.fill' : 'circle'} android={checked ? 'check-circle' : 'radio-button-unchecked'} size={22} color={colors.systemBlue} />
      : opening ? <AppLoader size="small" /> : !grid && <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.muted} />}</View>
  </Pressable>;
});

const styles = StyleSheet.create({
  content: { padding: s.xl, paddingBottom: s.section, width: '100%', maxWidth: 720, alignSelf: 'center' },
  section: { gap: s.sm, marginTop: s.md, paddingBottom: s.md }, titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...t.heading, fontSize: 20, lineHeight: 26 }, controls: { flexDirection: 'row', alignItems: 'center', gap: s.xs }, columns: { justifyContent: 'space-between' },
  chips: { flexDirection: 'row', alignItems: 'center', gap: s.xs, paddingRight: s.xs }, chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' }, chipText: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.md, minHeight: 64, marginBottom: s.sm, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: 40, height: 48, borderRadius: 8, overflow: 'hidden' }, gridCell: { width: '48%', flexDirection: 'column', alignItems: 'stretch' }, gridThumb: { width: '100%', height: undefined, aspectRatio: 1 },
  bookmark: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bookmarkCorner: { position: 'absolute', top: 8, left: 8, borderRadius: 20, backgroundColor: '#00000059' },
  gridMeta: { gap: 2 }, corner: { position: 'absolute', top: 12, right: 12 }, grow: { flex: 1, gap: 2 }, name: { fontSize: 15, lineHeight: 20, fontWeight: '600' }, caption: { ...t.caption }, empty: { paddingVertical: s.lg, textAlign: 'center', alignItems: 'center' },
});

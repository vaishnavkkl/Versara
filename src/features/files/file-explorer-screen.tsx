import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppLoader } from '@/components/app-loader';
import { showDialog } from '@/components/app-dialog';
import { ThemedText } from '@/components/themed-text';
import { toast } from '@/components/toast';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { getGradients, gradient, spacing as s, typography as t } from '@/theme/dashboard';
import { FileEngine, type DirectoryListing, type ExplorerEntry, type StorageRoot } from '../../../modules/file-engine';
import { ExplorerRow } from './explorer-row';
import { explorerAvailable, openExplorerEntry } from './explorer';

const LISTING_CACHE = 24;
const listings = new Map<string, DirectoryListing>();
function remember(listing: DirectoryListing) {
  listings.delete(listing.path);
  listings.set(listing.path, listing);
  while (listings.size > LISTING_CACHE) listings.delete(listings.keys().next().value!);
}

const ROOT_STYLE: Record<string, { ios: 'internaldrive.fill' | 'arrow.down.circle.fill'; android: 'phone-android' | 'file-download'; tint: readonly [string, string] }> = {
  internal: { ios: 'internaldrive.fill', android: 'phone-android', tint: ['#1A1953', '#4B48B8'] },
  downloads: { ios: 'arrow.down.circle.fill', android: 'file-download', tint: ['#0A84FF', '#5AC8FA'] },
};

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export function FileExplorerScreen() {
  const colors = usePalette();
  const available = explorerAvailable();
  const [roots, setRoots] = useState<StorageRoot[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const allowed = roots.some(root => root.allowed);

  const loadRoots = useCallback(() => {
    if (!available) return;
    void FileEngine!.getStorageRoots().then(setRoots).catch(() => setRoots([]));
  }, [available]);
  useFocusEffect(loadRoots);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') loadRoots(); });
    return () => subscription.remove();
  }, [loadRoots]);

  const go = useCallback((next: string | null) => {
    setPath(next);
    setError(null);
    const cached = next ? listings.get(next) ?? null : null;
    setListing(cached);
    setLoading(!!next && !cached);
  }, []);

  useEffect(() => {
    if (!path || !FileEngine) return;
    let cancelled = false;
    FileEngine.listDirectory(path, false)
      .then(value => { remember(value); if (!cancelled) { setListing(value); setError(null); } })
      .catch(cause => { if (!cancelled) setError((cause as Error).message || 'Could not open this folder.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, reload]);

  const root = path ? roots.filter(item => path === item.path || path.startsWith(item.path + '/')).sort((a, b) => b.path.length - a.path.length)[0] : undefined;
  const crumbs = root && path ? [root.name, ...path.slice(root.path.length).split('/').filter(Boolean)] : [];
  const up = useCallback(() => {
    if (!path) return false;
    go(roots.some(item => item.path === path) ? null : listing?.parent ?? null);
    return true;
  }, [go, listing, path, roots]);

  useFocusEffect(useCallback(() => {
    if (!path) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', up);
    return () => subscription.remove();
  }, [path, up]));

  const busy = useRef(false);
  const press = useCallback((entry: ExplorerEntry) => {
    if (entry.directory) { go(entry.path); return; }
    if (busy.current) return;
    busy.current = true;
    if (entry.kind === 'image' || entry.kind === 'video' || entry.kind === 'audio') toast(`Opening ${entry.name}…`);
    void openExplorerEntry(entry)
      .catch(cause => showDialog('Could not open file', (cause as Error).message || 'Try again.', undefined, { ios: 'exclamationmark.triangle', android: 'error-outline' }))
      .finally(() => { busy.current = false; });
  }, [go]);

  async function allow() {
    try { await FileEngine?.requestPdfAccessAsync(); } catch (cause) { showDialog('File access', (cause as Error).message); } finally { loadRoots(); }
  }

  const renderItem = useCallback(({ item }: { item: ExplorerEntry }) => <ExplorerRow entry={item} onPress={press} />, [press]);

  if (!path) {
    return (
      <ScrollView style={[{ backgroundColor: colors.systemBackground }, getGradients(colors).dashboard]} contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.label }]}>Files</ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.secondaryLabel }]}>Browse folders on this device</ThemedText>
        </View>
        {!available ? (
          <View style={[styles.notice, { backgroundColor: colors.accentSurface }]}>
            <ThemedText style={{ color: colors.secondaryLabel }}>Install a new development build to browse device folders.</ThemedText>
          </View>
        ) : !allowed && roots.length > 0 ? (
          <View style={[styles.access, { backgroundColor: colors.tileSurface, borderColor: colors.tileBorder }]}>
            <UniversalIcon ios="lock.open" android="lock-open" size={26} color={colors.systemBlue} />
            <ThemedText style={[styles.cardTitle, { color: colors.label }]}>Allow file access</ThemedText>
            <ThemedText style={{ color: colors.secondaryLabel, textAlign: 'center' }}>Versara needs All files access to show your internal storage and Downloads. Files never leave this device.</ThemedText>
            <Pressable accessibilityRole="button" onPress={() => { void allow(); }} style={[styles.allow, getGradients(colors).module]}>
              <ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>Allow access</ThemedText>
            </Pressable>
          </View>
        ) : null}
        {roots.map(item => {
          const style = ROOT_STYLE[item.id] ?? ROOT_STYLE.internal;
          const used = item.total > 0 ? Math.min(1, (item.total - item.free) / item.total) : 0;
          return (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} disabled={!item.allowed} onPress={() => go(item.path)} style={({ pressed }) => [styles.root, gradient(`linear-gradient(120deg, ${style.tint[0]}${colors.tileTint} 0%, ${colors.tileSurface} 70%)`), { backgroundColor: colors.tileSurface, borderColor: colors.tileBorder, boxShadow: colors.tileShadow, opacity: !item.allowed ? 0.5 : pressed ? 0.8 : 1 }]}>
              <View style={[styles.rootIcon, gradient(`linear-gradient(145deg, ${style.tint[1]} 0%, ${style.tint[0]} 100%)`), { backgroundColor: style.tint[0] }]}>
                <UniversalIcon ios={style.ios} android={style.android} size={28} color="#FFFFFF" />
              </View>
              <View style={styles.grow}>
                <ThemedText style={[styles.cardTitle, { color: colors.label }]}>{item.name}</ThemedText>
                {item.total > 0 ? <>
                  <View style={[styles.track, { backgroundColor: colors.separator }]}><View style={[styles.fill, { width: `${Math.round(used * 100)}%`, backgroundColor: item.id === 'internal' ? colors.systemBlue : style.tint[0] }]} /></View>
                  <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{formatBytes(item.free)} free of {formatBytes(item.total)}</ThemedText>
                </> : <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Files you downloaded</ThemedText>}
              </View>
              <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.muted} />
            </Pressable>
          );
        })}
        {Platform.OS === 'ios' && available && <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>iOS keeps each app&apos;s files separate. Downloads from other apps open through Files or the share sheet.</ThemedText>}
        <Pressable accessibilityRole="button" onPress={() => router.navigate('/edited-files')} style={({ pressed }) => [styles.shortcut, { borderColor: colors.tileBorder, backgroundColor: colors.tileSurface, opacity: pressed ? 0.8 : 1 }]}>
          <UniversalIcon ios="square.and.pencil" android="edit-note" size={22} color={colors.systemBlue} />
          <ThemedText style={[styles.grow, { color: colors.label, fontWeight: '600' }]}>Edited files</ThemedText>
          <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.muted} />
        </Pressable>
      </ScrollView>
    );
  }

  const items = listing?.path === path ? listing.items : [];
  return (
    <View style={[styles.fill1, { backgroundColor: colors.systemBackground }]}>
      <View style={[styles.bar, { borderBottomColor: colors.separator }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go up one folder" onPress={up} hitSlop={8} style={styles.back}>
          <UniversalIcon ios="chevron.left" android="arrow-back" size={24} color={colors.label} />
        </Pressable>
        <View style={styles.grow}>
          <ThemedText numberOfLines={1} style={[styles.folder, { color: colors.label }]}>{crumbs[crumbs.length - 1] ?? 'Folder'}</ThemedText>
          <ThemedText numberOfLines={1} ellipsizeMode="head" style={[styles.caption, { color: colors.secondaryLabel }]}>{crumbs.join(' › ')}</ThemedText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close folder" onPress={() => go(null)} hitSlop={8} style={styles.back}>
          <UniversalIcon ios="house" android="home" size={22} color={colors.label} />
        </Pressable>
      </View>
      {loading && !items.length ? <View style={styles.center}><AppLoader /></View> : error && !items.length ? (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.secondaryLabel, textAlign: 'center' }}>{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => setReload(value => value + 1)} style={[styles.allow, getGradients(colors).module]}><ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>Try again</ThemedText></Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.path}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => { setLoading(true); setReload(value => value + 1); }} />}
          ListEmptyComponent={<ThemedText style={[styles.empty, { color: colors.secondaryLabel }]}>This folder is empty.</ThemedText>}
          ListFooterComponent={listing?.truncated ? <ThemedText style={[styles.empty, { color: colors.secondaryLabel }]}>Showing the first 4,000 items.</ThemedText> : null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: s.xl, paddingBottom: s.section, gap: s.md, width: '100%', maxWidth: 720, alignSelf: 'center' },
  intro: { gap: s.xs, marginBottom: s.sm },
  title: { ...t.title },
  subtitle: { ...t.body },
  notice: { borderRadius: 16, padding: s.lg },
  access: { borderRadius: 22, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, padding: s.xl, gap: s.sm, alignItems: 'center' },
  allow: { minHeight: 46, borderRadius: 23, paddingHorizontal: s.xl, alignItems: 'center', justifyContent: 'center', marginTop: s.sm },
  root: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth },
  rootIcon: { width: 52, height: 52, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  caption: { ...t.caption },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: s.md, minHeight: 56, paddingHorizontal: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, marginTop: s.sm },
  fill1: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: s.sm, paddingHorizontal: s.md, paddingVertical: s.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  folder: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.xl, gap: s.md },
  list: { paddingHorizontal: s.xl, paddingBottom: s.section },
  empty: { textAlign: 'center', paddingVertical: s.xl },
});

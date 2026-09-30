import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppLoader } from '@/components/app-loader';
import { showDialog } from '@/components/app-dialog';
import { FileThumbnail } from '@/components/file-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { toast } from '@/components/toast';
import { UniversalIcon } from '@/components/universal-icon';
import { useScreenActive } from '@/hooks/use-screen-active';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t } from '@/theme/dashboard';
import { isDocEditorAvailable } from '../../../modules/doc-engine';
import { openDocument } from '@/features/documents/open-document';
import { openPdfScreen } from '@/features/pdf/open-pdf-screen';
import { formatSize } from './file-storage';
import { stagePreviewFile } from './preview-handoff';
import { importDeviceRecent, listCategoryFiles, type RecentFile, type RecentListItem } from './recent-files';
import { useDevicePdfs } from './use-device-pdfs';
import { formatWhen, showRecentFileActions } from './recent-file-actions';

type Filter = 'all' | 'pdf' | 'document' | 'image';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'pdf', label: 'PDF' }, { id: 'document', label: 'Documents' }, { id: 'image', label: 'Images' },
];
const MORE: Record<Exclude<Filter, 'all'>, { label: string; href: '/(modules)/documents' | '/(modules)/word' | '/(modules)/image' }> = {
  pdf: { label: 'All PDFs', href: '/(modules)/documents' },
  document: { label: 'All documents', href: '/(modules)/word' },
  image: { label: 'All images', href: '/(modules)/image' },
};
/** Rows render inside the Files scroll view, so the list stays short. */
const SHOWN = 15;

/** Recently opened and recently changed PDFs, documents and images on this device. */
export function RecentFilesSection() {
  const colors = usePalette();
  const active = useScreenActive();
  const [filter, setFilter] = useState<Filter>('all');
  const [library, setLibrary] = useState<RecentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const busy = useRef(false);
  const pdfs = useDevicePdfs(active, '', 'pdf');
  const documents = useDevicePdfs(active, '', 'document');

  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void Promise.all((['pdf', 'document', 'image'] as const).map(kind => listCategoryFiles(kind).catch(() => [] as RecentListItem[])))
      .then(groups => { if (!cancelled) setLibrary(groups.flat()); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]));
  function refresh() { setRevision(value => value + 1); pdfs.refresh(); documents.refresh(); }

  const items = useMemo(() => {
    const names = new Set(library.map(item => `${item.kind}:${item.name.toLowerCase()}`));
    const device = [...pdfs.items, ...documents.items].filter(item => !names.has(`${item.kind}:${item.name.toLowerCase()}`));
    return [...library, ...device]
      .filter(item => filter === 'all' || item.kind === filter)
      .sort((a, b) => b.opened - a.opened)
      .slice(0, SHOWN);
  }, [library, pdfs.items, documents.items, filter]);

  async function open(item: RecentListItem) {
    if (busy.current) return;
    if (item.kind === 'document' && !isDocEditorAvailable) {
      showDialog('Documents unavailable', 'Install a new development build to edit documents.', undefined, { ios: 'doc.text', android: 'description' });
      return;
    }
    busy.current = true; setOpening(item.id);
    try {
      if (item.source === 'device') toast(`Opening ${item.name}…`);
      const file: RecentFile = item.source === 'library' ? item : await importDeviceRecent(item);
      if (file.kind === 'pdf') openPdfScreen(file);
      else if (file.kind === 'document') openDocument(file);
      else { stagePreviewFile(file); router.push({ pathname: '/file-preview', params: { id: file.id } }); }
    } catch (cause) {
      showDialog('Could not open file', (cause as Error).message || 'Try again.', undefined, { ios: 'exclamationmark.triangle', android: 'error-outline' });
    } finally { busy.current = false; setOpening(null); }
  }

  return <View style={styles.section}>
    <View style={styles.titleRow}>
      <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.label }]}>Recent files</ThemedText>
      {filter !== 'all' && <Pressable accessibilityRole="link" onPress={() => router.navigate(MORE[filter].href)} hitSlop={8}>
        <ThemedText style={{ color: colors.systemBlue, fontWeight: '600' }}>{MORE[filter].label}</ThemedText>
      </Pressable>}
    </View>
    <View style={styles.chips} accessibilityRole="tablist">
      {FILTERS.map(option => {
        const selected = option.id === filter;
        return <Pressable key={option.id} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => setFilter(option.id)}
          style={[styles.chip, { backgroundColor: selected ? colors.systemBlue : colors.tileSurface, borderColor: selected ? colors.systemBlue : colors.tileBorder }]}>
          <ThemedText style={[styles.chipText, { color: selected ? '#FFFFFF' : colors.label }]}>{option.label}</ThemedText>
        </Pressable>;
      })}
    </View>
    {loading && !items.length ? <View style={styles.empty}><AppLoader /></View>
      : !items.length ? <ThemedText style={[styles.empty, { color: colors.secondaryLabel }]}>{filter === 'all' ? 'Files you open or save will appear here.' : `No recent ${filter === 'pdf' ? 'PDFs' : filter === 'document' ? 'documents' : 'images'} yet.`}</ThemedText>
        : items.map(item => {
          const device = item.source === 'device';
          const thumbnail = !device || (item.kind === 'image' && item.uri.startsWith('content://'));
          const text = /\.txt$/i.test(item.name);
          return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} disabled={!!opening} onPress={() => { void open(item); }} onLongPress={() => showRecentFileActions(item, refresh)}
            style={({ pressed }) => [styles.row, { backgroundColor: colors.tileSurface, borderColor: colors.tileBorder, opacity: pressed ? 0.8 : 1 }]}>
            <View style={[styles.thumb, { backgroundColor: colors.accentSurface }]}>
              {thumbnail ? <FileThumbnail uri={item.uri} kind={item.kind} active={active} />
                : <UniversalIcon ios={item.kind === 'pdf' ? 'doc.richtext' : text ? 'doc.plaintext' : 'doc.text'} android={item.kind === 'pdf' ? 'picture-as-pdf' : text ? 'text-snippet' : 'description'} size={22} color={colors.systemBlue} />}
            </View>
            <View style={styles.grow}>
              <ThemedText numberOfLines={1} style={[styles.name, { color: colors.label }]}>{item.name}</ThemedText>
              <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>
                {device ? 'On this device' : 'In Versara'} · {formatSize(item.size)} · {formatWhen(item.opened)}
              </ThemedText>
            </View>
            {opening === item.id ? <AppLoader size="small" /> : <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.muted} />}
          </Pressable>;
        })}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: s.sm, marginTop: s.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...t.heading, fontSize: 20, lineHeight: 26 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: s.xs },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.md, minHeight: 64, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: 40, height: 48, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, gap: 2 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { ...t.caption },
  empty: { paddingVertical: s.lg, textAlign: 'center', alignItems: 'center' },
});

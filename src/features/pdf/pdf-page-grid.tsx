import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type ListRenderItem } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { AppBottomSheet } from '@/components/app-bottom-sheet';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { FileThumbnail } from '@/components/file-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { useVisibleListItems } from '@/hooks/use-visible-list-items';
import { usePalette } from '@/theme/colors';

const COLUMNS = 3;
const GAP = 10;
const PADDING = 12;
const LABEL_HEIGHT = 22;
const FILTER_HEIGHT = 52;

const GridPage = memo(function GridPage({ uri, index, width, selected, bookmarked, active, onSelect }: { uri: string; index: number; width: number; selected: boolean; bookmarked: boolean; active: boolean; onSelect: (page: number) => void }) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Go to page ${index + 1}${bookmarked ? ', bookmarked' : ''}`} accessibilityState={{ selected }} onPress={() => onSelect(index)} style={{ width }}>
    <View style={[styles.thumbnail, { height: width * 1.3, borderColor: selected ? colors.systemBlue : colors.separator }]}><FileThumbnail uri={uri} kind="pdf" page={index} active={active} /></View>
    {bookmarked && <View style={[styles.ribbon, { backgroundColor: colors.systemBlue }]}><UniversalIcon ios="bookmark.fill" android="bookmark" size={14} color={colors.systemBackground} /></View>}
    <ThemedText style={[styles.number, { color: selected ? colors.systemBlue : colors.secondaryLabel, fontWeight: selected ? '700' : '400' }]}>{index + 1}</ThemedText>
  </Pressable>;
});

/** Every page of the PDF, three to a row, or only the bookmarked pages; only pages on screen render thumbnails. */
export function PdfPageGrid({ visible, uri, name, count, page, onSelect, onClose, rightToLeft = false, bookmarks = [] }: {
  visible: boolean; uri: string; name: string; count: number; page: number; onSelect: (page: number) => void; onClose: () => void; rightToLeft?: boolean; bookmarks?: number[];
}) {
  const colors = usePalette();
  const { width } = useWindowDimensions();
  const [onlyBookmarks, setOnlyBookmarks] = useState(false);
  const itemWidth = Math.floor((Math.min(width, 720) - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const rowHeight = itemWidth * 1.3 + LABEL_HEIGHT + GAP;
  const { visibleKeys, onViewableItemsChanged, viewabilityConfig } = useVisibleListItems();
  const marked = useMemo(() => new Set(bookmarks.filter(index => index < count)), [bookmarks, count]);
  const showingBookmarks = onlyBookmarks && marked.size > 0;
  const rows = useMemo(() => {
    if (!visible) return [];
    const pages = showingBookmarks ? [...marked] : Array.from({ length: count }, (_, index) => index);
    return Array.from({ length: Math.ceil(pages.length / COLUMNS) }, (_, row) => pages.slice(row * COLUMNS, row * COLUMNS + COLUMNS));
  }, [visible, count, marked, showingBookmarks]);
  const select = useCallback((target: number) => { onSelect(target); onClose(); }, [onSelect, onClose]);
  // Right-to-left rows keep full width so a short last row starts at the right edge.
  const renderItem = useCallback<ListRenderItem<number[]>>(({ item, index: row }) => <View style={[styles.row, rightToLeft && { flexDirection: 'row-reverse', width: itemWidth * COLUMNS + GAP * (COLUMNS - 1) }]}>
    {item.map(index => <GridPage key={index} uri={uri} index={index} width={itemWidth} selected={index === page} bookmarked={marked.has(index)} active={visible && visibleKeys.has(String(row))} onSelect={select} />)}
  </View>, [uri, page, itemWidth, visible, visibleKeys, select, rightToLeft, marked]);
  const getItemLayout = useCallback((_: unknown, index: number) => ({ length: rowHeight, offset: FILTER_HEIGHT + rowHeight * index, index }), [rowHeight]);
  const filter = (selected: boolean, label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="tab" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={[styles.chip, { backgroundColor: selected ? colors.systemBlue : colors.fieldSurface, opacity: disabled ? 0.45 : 1 }]}>
    <ThemedText style={[styles.chipText, { color: selected ? colors.systemBackground : colors.label }]}>{label}</ThemedText>
  </Pressable>;
  return <AppBottomSheet visible={visible} onClose={onClose} title="All pages" subtitle={`${name} · ${count} ${count === 1 ? 'page' : 'pages'}`} icon={{ ios: 'square.grid.3x3', android: 'grid-view' }} snapPoints={['85%']}>
    <BottomSheetFlatList key={showingBookmarks ? 'bookmarks' : 'all'} data={rows} keyExtractor={(_, index) => String(index)} renderItem={renderItem} getItemLayout={getItemLayout}
      initialScrollIndex={!showingBookmarks && rows.length ? Math.min(rows.length - 1, Math.floor(page / COLUMNS)) : undefined}
      ListHeaderComponent={<View accessibilityRole="tablist" style={styles.filters}>
        {filter(!showingBookmarks, 'All pages', () => setOnlyBookmarks(false))}
        {filter(showingBookmarks, marked.size ? `Bookmarked · ${marked.size}` : 'No bookmarks yet', () => setOnlyBookmarks(true), !marked.size)}
      </View>}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
      initialNumToRender={4} maxToRenderPerBatch={4} windowSize={5} removeClippedSubviews contentContainerStyle={styles.content} />
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: PADDING, paddingTop: 4, paddingBottom: 24, alignItems: 'center' },
  filters: { height: FILTER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  thumbnail: { borderRadius: 10, borderWidth: 2, padding: 2, overflow: 'hidden' },
  ribbon: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  number: { height: LABEL_HEIGHT, lineHeight: LABEL_HEIGHT, fontSize: 12, textAlign: 'center' },
});

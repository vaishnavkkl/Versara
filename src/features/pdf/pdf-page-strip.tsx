import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, View, type ListRenderItem } from 'react-native';
import { FileThumbnail } from '@/components/file-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';

const ITEM_WIDTH = 68;

const PageThumb = memo(function PageThumb({ uri, index, selected, onSelect }: { uri: string; index: number; selected: boolean; onSelect: (page: number) => void }) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Page ${index + 1}`} accessibilityState={{ selected }} onPress={() => onSelect(index)} style={styles.item}>
    <View style={[styles.thumbnail, { borderColor: selected ? colors.systemBlue : 'transparent' }]}><FileThumbnail uri={uri} kind="pdf" page={index} /></View>
    <ThemedText style={[styles.number, { color: selected ? colors.systemBlue : colors.secondaryLabel, fontWeight: selected ? '700' : '400' }]}>{index + 1}</ThemedText>
  </Pressable>;
});

export function PdfPageStrip({ uri, count, page, onSelect }: { uri: string; count: number; page: number; onSelect: (page: number) => void }) {
  const colors = usePalette();
  const list = useRef<FlatList<number>>(null);
  const select = useRef(onSelect);
  useEffect(() => { select.current = onSelect; });
  const stableSelect = useCallback((value: number) => select.current(value), []);
  const pages = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);
  // Fast scrolling in the reader changes the page many times a second; follow it once it settles.
  useEffect(() => {
    if (page >= count) return;
    const timer = setTimeout(() => list.current?.scrollToIndex({ index: page, animated: true, viewPosition: 0.5 }), 160);
    return () => clearTimeout(timer);
  }, [page, count]);
  const renderItem = useCallback<ListRenderItem<number>>(({ item }) => <PageThumb uri={uri} index={item} selected={item === page} onSelect={stableSelect} />, [uri, page, stableSelect]);
  return <View style={[styles.strip, { borderColor: colors.separator, backgroundColor: colors.secondarySystemBackground }]}>
    <FlatList ref={list} horizontal data={pages} keyExtractor={String} initialNumToRender={8} maxToRenderPerBatch={6} updateCellsBatchingPeriod={80} windowSize={5}
      removeClippedSubviews showsHorizontalScrollIndicator={false} renderItem={renderItem} getItemLayout={getItemLayout} />
  </View>;
}
const getItemLayout = (_: unknown, index: number) => ({ length: ITEM_WIDTH, offset: ITEM_WIDTH * index, index });
const styles = StyleSheet.create({ strip: { height: 94, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth }, item: { width: ITEM_WIDTH, alignItems: 'center', gap: 2 }, thumbnail: { width: 48, height: 62, borderRadius: 9, borderWidth: 2, padding: 1, overflow: 'hidden' }, number: { fontSize: 11, lineHeight: 16 } });

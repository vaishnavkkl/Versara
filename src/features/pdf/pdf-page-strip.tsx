import { useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { FileThumbnail } from '@/components/file-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';

export function PdfPageStrip({ uri, count, page, onSelect }: { uri: string; count: number; page: number; onSelect: (page: number) => void }) {
  const colors = usePalette();
  const list = useRef<FlatList<number>>(null);
  const pages = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);
  useEffect(() => { if (page < count) list.current?.scrollToIndex({ index: page, animated: false, viewPosition: 0.5 }); }, [page, count]);
  return <View style={[styles.strip, { borderColor: colors.separator, backgroundColor: colors.secondarySystemBackground }]}>
    <FlatList ref={list} horizontal data={pages} keyExtractor={item => String(item)} initialNumToRender={6} maxToRenderPerBatch={4} windowSize={3} showsHorizontalScrollIndicator={false} extraData={page}
      getItemLayout={(_, index) => ({ length: 68, offset: 68 * index, index })}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Page ${item + 1}`} accessibilityState={{ selected: item === page }} onPress={() => onSelect(item)} style={styles.item}>
        <View style={[styles.thumbnail, { borderColor: item === page ? colors.systemBlue : 'transparent' }]}><FileThumbnail uri={uri} kind="pdf" page={item} /></View>
        <ThemedText style={[styles.number, { color: item === page ? colors.systemBlue : colors.secondaryLabel, fontWeight: item === page ? '700' : '400' }]}>{item + 1}</ThemedText>
      </Pressable>} />
  </View>;
}
const styles = StyleSheet.create({ strip: { height: 94, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth }, item: { width: 68, alignItems: 'center', gap: 2 }, thumbnail: { width: 48, height: 62, borderRadius: 9, borderWidth: 2, padding: 1, overflow: 'hidden' }, number: { fontSize: 11, lineHeight: 16 } });

import { HelpPressable } from '@/components/help-pressable';
import { memo, useState, type ReactElement } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewToken, type ViewabilityConfig } from 'react-native';
import { FileThumbnail } from '@/components/file-thumbnail';
import { SortableGrid } from '@/components/sortable-grid';
import { ThemedText } from '@/components/themed-text';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';

type Page = { original: number; rotation: number };
const COLUMNS = 3;
const PAD = s.lg;
const GAP = s.md;
const LABEL = 30;

type Props = {
  uri: string; pages: Page[]; busy: boolean; active: boolean; header: ReactElement;
  visibleKeys: ReadonlySet<string>; viewabilityConfig: ViewabilityConfig;
  onViewableItemsChanged: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
  /** Moves the page with this original number to a zero-based position. */
  onMove: (original: number, destination: number) => void;
  onPreview: (original: number) => void;
};

/** Pages in a three-column grid. Long-press a page and drag it to a new place; it moves there on release. */
export function ReorderPageGrid({ uri, pages, busy, active, header, visibleKeys, viewabilityConfig, onViewableItemsChanged, onMove, onPreview }: Props) {
  const colors = usePalette();
  const [width, setWidth] = useState(0);
  const tileWidth = width ? Math.floor((width - PAD * 2 - GAP * (COLUMNS - 1)) / COLUMNS) : 0;
  const thumbHeight = Math.round(tileWidth * 1.3);
  const geometry = tileWidth ? { columns: COLUMNS, itemWidth: tileWidth, itemHeight: thumbHeight + LABEL, rowGap: GAP, padX: PAD, top: PAD } : null;
  const preview = useStableCallback(onPreview);
  const shift = useStableCallback(onMove);
  const drop = useStableCallback((from: number, to: number) => { const page = pages[from]; if (page) onMove(page.original, to); });

  return <View style={styles.screen} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
    <SortableGrid data={tileWidth ? pages : []} geometry={geometry} enabled={!busy} header={header} onMove={drop}
      keyExtractor={page => String(page.original)} keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content} columnWrapperStyle={styles.row} ItemSeparatorComponent={Separator}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
      initialNumToRender={12} maxToRenderPerBatch={9} windowSize={5}
      extraData={visibleKeys}
      renderItem={({ item, index, dragging }) => <PageTile item={item} index={index} count={pages.length} uri={uri} width={tileWidth} thumbHeight={thumbHeight}
        active={active && visibleKeys.has(String(item.original))} busy={busy} lifted={dragging} onPreview={preview} onShift={shift} />}
      renderGhost={(item, index) => <View style={[styles.ghost, { backgroundColor: colors.systemBackground, borderColor: colors.systemBlue }]}>
        <View style={[styles.thumb, { flex: 1, borderColor: colors.separator }]}><FileThumbnail uri={uri} kind="pdf" page={item.original - 1} active={active} /></View>
        <ThemedText style={styles.position}>Page {index + 1}</ThemedText>
      </View>} />
  </View>;
}

const Separator = () => <View style={{ height: GAP }} />;

const PageTile = memo(function PageTile({ item, index, count, uri, width, thumbHeight, active, busy, lifted, onPreview, onShift }: {
  item: Page; index: number; count: number; uri: string; width: number; thumbHeight: number; active: boolean; busy: boolean; lifted: boolean;
  onPreview: (original: number) => void; onShift: (original: number, destination: number) => void;
}) {
  const colors = usePalette();
  const moved = item.original !== index + 1;
  return <HelpPressable accessibilityRole="button" accessibilityLabel={`Page ${index + 1}, original page ${item.original}`}
    accessibilityHint="Long press and drag to move. Tap to preview." helpText="Tap a page to preview it. Long-press and drag it to change its position in the PDF."
    accessibilityActions={[{ name: 'earlier', label: 'Move earlier' }, { name: 'later', label: 'Move later' }, { name: 'activate', label: 'Preview' }]}
    onAccessibilityAction={({ nativeEvent }) => {
      if (busy) return;
      if (nativeEvent.actionName === 'earlier' && index > 0) onShift(item.original, index - 1);
      else if (nativeEvent.actionName === 'later' && index < count - 1) onShift(item.original, index + 1);
      else if (nativeEvent.actionName === 'activate') onPreview(item.original);
    }}
    disabled={busy} onPress={() => onPreview(item.original)}
    style={[styles.tile, { width, opacity: lifted ? 0.25 : busy ? 0.6 : 1 }]}>
    <View style={[styles.thumb, { height: thumbHeight, borderColor: moved ? colors.systemBlue : colors.separator, backgroundColor: colors.secondarySystemBackground }]}>
      <FileThumbnail uri={uri} kind="pdf" page={item.original - 1} active={active} />
    </View>
    <View style={styles.caption}>
      <ThemedText style={styles.position}>{index + 1}</ThemedText>
      {moved && <ThemedText numberOfLines={1} style={[styles.original, { color: colors.secondaryLabel }]}>was {item.original}</ThemedText>}
    </View>
  </HelpPressable>;
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: PAD },
  row: { gap: GAP },
  tile: { gap: 4 },
  thumb: { borderRadius: radius.sm, borderWidth: 1.5, overflow: 'hidden' },
  caption: { height: LABEL - 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  position: { ...t.label, textAlign: 'center' },
  original: { ...t.caption },
  ghost: { flex: 1, padding: 4, gap: 4, borderRadius: radius.sm, borderWidth: 2 },
});

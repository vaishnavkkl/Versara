import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewToken, type ViewabilityConfig } from 'react-native';
import { FlatList, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { FileThumbnail } from '@/components/file-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';

type Page = { original: number; rotation: number };
const COLUMNS = 3;
const PAD = s.lg;
const GAP = s.md;
const LABEL = 30;
/** Dragging this close to the top or bottom edge scrolls the list. */
const EDGE = 72;
const SCROLL_STEP = 12;

type Props = {
  uri: string; pages: Page[]; busy: boolean; active: boolean; header: ReactElement;
  visibleKeys: ReadonlySet<string>; viewabilityConfig: ViewabilityConfig;
  onViewableItemsChanged: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
  /** Moves the page with this original number to a zero-based position. */
  onMove: (original: number, destination: number) => void;
  onPreview: (original: number) => void;
};

/** Pages in a three-column grid. Long-press a page and drag it to a new place; the other pages shift as it moves. */
export function ReorderPageGrid({ uri, pages, busy, active, header, visibleKeys, viewabilityConfig, onViewableItemsChanged, onMove, onPreview }: Props) {
  const colors = usePalette();
  const list = useRef<FlatList<Page>>(null);
  const container = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const tileWidth = width ? Math.floor((width - PAD * 2 - GAP * (COLUMNS - 1)) / COLUMNS) : 0;
  const thumbHeight = Math.round(tileWidth * 1.3);
  const tileHeight = thumbHeight + LABEL;
  const frame = useRef({ x: 0, y: 0, height: 0 });
  const headerHeight = useRef(0);
  const scrollY = useRef(0);
  const contentHeight = useRef(0);
  const finger = useRef({ x: 0, y: 0 });
  const pagesRef = useRef(pages);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  const [dragging, setDragging] = useState<number | null>(null);
  const draggingRef = useRef<number | null>(null);
  // Tiles stay put while dragging (moving one between grid rows would remount it and end the
  // gesture); the drop position is outlined and the move happens on release.
  const [target, setTarget] = useState(-1);
  const targetRef = useRef(-1);
  const scroller = useRef<ReturnType<typeof setInterval> | null>(null);
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghost = useAnimatedStyle(() => ({ transform: [{ translateX: ghostX.get() }, { translateY: ghostY.get() }, { scale: 1.06 }] }));

  const measure = () => container.current?.measureInWindow((x, y, _width, height) => { frame.current = { x, y, height }; });
  function slotAt(x: number, y: number) {
    const localX = x - frame.current.x - PAD;
    const localY = y - frame.current.y + scrollY.current - PAD - headerHeight.current;
    const column = Math.max(0, Math.min(COLUMNS - 1, Math.floor((localX + GAP / 2) / (tileWidth + GAP))));
    const row = Math.max(0, Math.floor((localY + GAP / 2) / (tileHeight + GAP)));
    return Math.min(pagesRef.current.length - 1, row * COLUMNS + column);
  }
  function follow(x: number, y: number) {
    finger.current = { x, y };
    ghostX.set(x - frame.current.x - tileWidth / 2);
    ghostY.set(y - frame.current.y - tileHeight / 2);
    if (draggingRef.current === null) return;
    const to = slotAt(x, y);
    if (to !== targetRef.current) { targetRef.current = to; setTarget(to); }
  }
  function stopScrolling() { if (scroller.current) clearInterval(scroller.current); scroller.current = null; }
  const start = useStableCallback((original: number, x: number, y: number) => {
    if (busy || pagesRef.current.length < 2) return;
    measure();
    draggingRef.current = original; setDragging(original);
    follow(x, y);
    stopScrolling();
    scroller.current = setInterval(() => {
      const offset = finger.current.y - frame.current.y;
      const delta = offset < EDGE ? -SCROLL_STEP : offset > frame.current.height - EDGE ? SCROLL_STEP : 0;
      if (!delta) return;
      const next = Math.max(0, Math.min(Math.max(0, contentHeight.current - frame.current.height), scrollY.current + delta));
      if (next === scrollY.current) return;
      scrollY.current = next;
      list.current?.scrollToOffset({ offset: next, animated: false });
      follow(finger.current.x, finger.current.y);
    }, 16);
  });
  const move = useStableCallback((x: number, y: number) => { if (draggingRef.current !== null) follow(x, y); });
  const end = useStableCallback(() => {
    stopScrolling();
    const original = draggingRef.current, to = targetRef.current;
    draggingRef.current = null; targetRef.current = -1; setDragging(null); setTarget(-1);
    if (original === null || to < 0) return;
    const from = pagesRef.current.findIndex(page => page.original === original);
    if (from >= 0 && to !== from) onMove(original, to);
  });
  useEffect(() => () => stopScrolling(), []);
  const preview = useStableCallback(onPreview);
  const shift = useStableCallback(onMove);

  const dragged = dragging === null ? undefined : pages.find(page => page.original === dragging);
  return <View ref={container} style={styles.screen} onLayout={(event: LayoutChangeEvent) => { setWidth(event.nativeEvent.layout.width); measure(); }}>
    <FlatList ref={list} data={tileWidth ? pages : []} numColumns={COLUMNS} keyExtractor={page => String(page.original)}
      scrollEnabled={dragging === null} keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content} columnWrapperStyle={styles.row} ItemSeparatorComponent={Separator}
      ListHeaderComponent={<View onLayout={event => { headerHeight.current = event.nativeEvent.layout.height; }}>{header}</View>}
      onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}
      onContentSizeChange={(_width, height) => { contentHeight.current = height; }}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
      /* A wide window while dragging keeps the dragged tile mounted as the list auto-scrolls. */
      initialNumToRender={12} maxToRenderPerBatch={9} windowSize={dragging === null ? 5 : 41} removeClippedSubviews={false}
      renderItem={({ item, index }) => <PageTile item={item} index={index} count={pages.length} uri={uri} width={tileWidth} thumbHeight={thumbHeight}
        active={active && visibleKeys.has(String(item.original))} busy={busy} placeholder={item.original === dragging} dropTarget={index === target && item.original !== dragging}
        onStart={start} onMove={move} onEnd={end} onPreview={preview} onShift={shift} />} />
    {dragged && <Animated.View pointerEvents="none" style={[styles.ghost, { width: tileWidth, backgroundColor: colors.systemBackground, borderColor: colors.systemBlue }, ghost]}>
      <View style={[styles.thumb, { height: thumbHeight }]}><FileThumbnail uri={uri} kind="pdf" page={dragged.original - 1} active={active} /></View>
      <ThemedText style={styles.position}>Page {pages.indexOf(dragged) + 1}</ThemedText>
    </Animated.View>}
  </View>;
}

const Separator = () => <View style={{ height: GAP }} />;

const PageTile = memo(function PageTile({ item, index, count, uri, width, thumbHeight, active, busy, placeholder, dropTarget, onStart, onMove, onEnd, onPreview, onShift }: {
  item: Page; index: number; count: number; uri: string; width: number; thumbHeight: number; active: boolean; busy: boolean; placeholder: boolean; dropTarget: boolean;
  onStart: (original: number, x: number, y: number) => void; onMove: (x: number, y: number) => void; onEnd: () => void;
  onPreview: (original: number) => void; onShift: (original: number, destination: number) => void;
}) {
  const colors = usePalette();
  const drag = Gesture.Pan().activateAfterLongPress(280).enabled(!busy && count > 1).runOnJS(true)
    .onStart(event => onStart(item.original, event.absoluteX, event.absoluteY))
    .onUpdate(event => onMove(event.absoluteX, event.absoluteY))
    .onFinalize(() => onEnd());
  const tap = Gesture.Tap().enabled(!busy).runOnJS(true).onEnd((_event, success) => { if (success) onPreview(item.original); });
  const moved = item.original !== index + 1;
  return <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
    <View accessible accessibilityRole="button" accessibilityLabel={`Page ${index + 1}, original page ${item.original}`}
      accessibilityHint="Long press and drag to move. Tap to preview."
      accessibilityActions={[{ name: 'earlier', label: 'Move earlier' }, { name: 'later', label: 'Move later' }, { name: 'activate', label: 'Preview' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (busy) return;
        if (nativeEvent.actionName === 'earlier' && index > 0) onShift(item.original, index - 1);
        else if (nativeEvent.actionName === 'later' && index < count - 1) onShift(item.original, index + 1);
        else if (nativeEvent.actionName === 'activate') onPreview(item.original);
      }}
      style={[styles.tile, { width, opacity: placeholder ? 0.25 : busy ? 0.6 : 1 }]}>
      <View style={[styles.thumb, { height: thumbHeight, borderColor: moved ? colors.systemBlue : colors.separator, backgroundColor: colors.secondarySystemBackground }]}>
        <FileThumbnail uri={uri} kind="pdf" page={item.original - 1} active={active} />
        {dropTarget && <View style={[styles.drop, { borderColor: colors.systemBlue, backgroundColor: `${colors.systemBlue}26` }]}><ThemedText style={[styles.dropLabel, { color: colors.systemBlue }]}>Drop here</ThemedText></View>}
      </View>
      <View style={styles.caption}>
        <ThemedText style={styles.position}>{index + 1}</ThemedText>
        {moved && <ThemedText numberOfLines={1} style={[styles.original, { color: colors.secondaryLabel }]}>was {item.original}</ThemedText>}
      </View>
    </View>
  </GestureDetector>;
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
  drop: { ...StyleSheet.absoluteFill, borderWidth: 3, borderStyle: 'dashed', borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  dropLabel: { ...t.label },
  ghost: { position: 'absolute', left: 0, top: 0, padding: 4, gap: 4, borderRadius: radius.sm, borderWidth: 2, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
});

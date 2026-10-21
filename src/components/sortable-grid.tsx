import { useEffect, useState, type ReactElement } from 'react';
import { StyleSheet, View, type FlatList, type FlatListProps, type LayoutChangeEvent, type ListRenderItemInfo } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { scrollTo, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ThemedText } from './themed-text';
import { usePalette } from '@/theme/colors';
import { radius, typography as t } from '@/theme/dashboard';

/** Dragging this close to the top or bottom edge scrolls the list; the speed grows towards the edge. */
const EDGE = 80;
const MAX_STEP = 18;
const LONG_PRESS_MS = 260;

/**
 * Where the cells sit in the list's content. Cells share one size; columns spread across `padX`..width - `padX`
 * (left-aligned rows use the same pitch within a pixel).
 */
export type SortableGeometry = {
  columns: number; itemWidth: number; itemHeight: number;
  /** Space between rows, beyond `itemHeight`. */
  rowGap: number; padX: number;
  /** Content offset of the first row, not counting the list header. */
  top: number;
};

type Props<T> = Omit<FlatListProps<T>, 'renderItem' | 'numColumns' | 'onScroll' | 'scrollEnabled' | 'ListHeaderComponent' | 'onContentSizeChange' | 'CellRendererComponent'> & {
  data: T[];
  geometry: SortableGeometry | null;
  enabled: boolean;
  header?: ReactElement;
  renderItem: (info: ListRenderItemInfo<T> & { dragging: boolean }) => ReactElement;
  renderGhost: (item: T, index: number) => ReactElement;
  /** Moves the item at `from` to `to`; the rest shift. Not called when the item is dropped where it was. */
  onMove: (from: number, to: number) => void;
};

/**
 * A virtualised grid whose cells can be long-pressed and dragged to a new place. One gesture covers the whole list,
 * and the floating cell, drop outline and edge scrolling run on the UI thread; React renders only when a drag starts and ends.
 */
export function SortableGrid<T>({ data, geometry, enabled, header, renderItem, renderGhost, onMove, contentContainerStyle, columnWrapperStyle, ...list }: Props<T>) {
  const colors = usePalette();
  const listRef = useAnimatedRef<FlatList<T>>();
  const [dragging, setDragging] = useState<number | null>(null);
  const geo = useSharedValue<SortableGeometry | null>(geometry);
  const count = useSharedValue(data.length);
  useEffect(() => { geo.set(geometry); }, [geo, geometry]);
  useEffect(() => { count.set(data.length); }, [count, data.length]);
  const width = useSharedValue(0);
  const viewport = useSharedValue(0);
  const content = useSharedValue(0);
  const headerHeight = useSharedValue(0);
  const scroll = useSharedValue(0);
  const from = useSharedValue(-1);
  const target = useSharedValue(-1);
  const origin = useSharedValue({ x: 0, y: 0, scroll: 0 });
  const offset = useSharedValue({ x: 0, y: 0 });

  const onScroll = useAnimatedScrollHandler({ onScroll: event => { scroll.set(event.contentOffset.y); } });
  const columnPitch = (g: SortableGeometry, total: number) => {
    'worklet';
    return g.columns > 1 ? (total - 2 * g.padX - g.itemWidth) / (g.columns - 1) : 0;
  };
  const updateTarget = () => {
    'worklet';
    const g = geo.get();
    if (!g || from.get() < 0) return;
    const pitch = columnPitch(g, width.get());
    const x = origin.get().x + offset.get().x + g.itemWidth / 2 - g.padX;
    const y = origin.get().y + offset.get().y + scroll.get() - origin.get().scroll + g.itemHeight / 2 - g.top - headerHeight.get();
    const column = pitch > 0 ? Math.max(0, Math.min(g.columns - 1, Math.round((x - g.itemWidth / 2) / pitch))) : 0;
    const row = Math.max(0, Math.floor(y / (g.itemHeight + g.rowGap)));
    target.set(Math.max(0, Math.min(count.get() - 1, row * g.columns + column)));
  };
  const autoScroll = useFrameCallback(() => {
    const g = geo.get();
    if (!g || from.get() < 0) return;
    const centre = origin.get().y - origin.get().scroll + offset.get().y + g.itemHeight / 2;
    const height = viewport.get();
    const edge = Math.min(EDGE, height / 4);
    const step = centre < edge ? -MAX_STEP * (1 - Math.max(0, centre) / edge) : centre > height - edge ? MAX_STEP * (1 - Math.max(0, height - centre) / edge) : 0;
    if (!step) return;
    const next = Math.max(0, Math.min(Math.max(0, content.get() - height), scroll.get() + step));
    if (next === scroll.get()) return;
    scroll.set(next);
    scrollTo(listRef, 0, next, false);
    updateTarget();
  }, false);

  function started(index: number) { setDragging(index); autoScroll.setActive(true); }
  function ended(start: number, end: number) {
    autoScroll.setActive(false);
    setDragging(null);
    if (start >= 0 && end >= 0 && start !== end) onMove(start, end);
  }
  const gesture = Gesture.Pan().activateAfterLongPress(LONG_PRESS_MS).enabled(enabled)
    .onStart(event => {
      const g = geo.get();
      if (!g || count.get() < 2) return;
      const pitch = columnPitch(g, width.get());
      const y = event.y + scroll.get() - g.top - headerHeight.get();
      const row = Math.floor(y / (g.itemHeight + g.rowGap));
      const column = pitch > 0 ? Math.max(0, Math.min(g.columns - 1, Math.floor((event.x - g.padX + (pitch - g.itemWidth) / 2) / pitch))) : 0;
      const index = row * g.columns + column;
      if (y < 0 || index < 0 || index >= count.get()) return;
      origin.set({ x: g.padX + column * pitch, y: g.top + headerHeight.get() + row * (g.itemHeight + g.rowGap), scroll: scroll.get() });
      offset.set({ x: 0, y: 0 });
      from.set(index); target.set(index);
      scheduleOnRN(started, index);
    })
    .onUpdate(event => {
      if (from.get() < 0) return;
      offset.set({ x: event.translationX, y: event.translationY });
      updateTarget();
    })
    .onFinalize(() => {
      const start = from.get();
      if (start < 0) return;
      const end = target.get();
      from.set(-1); target.set(-1);
      scheduleOnRN(ended, start, end);
    });

  const ghost = useAnimatedStyle(() => {
    const g = geo.get();
    if (!g || from.get() < 0) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    return { opacity: 1, transform: [{ translateX: origin.get().x + offset.get().x }, { translateY: origin.get().y - origin.get().scroll + offset.get().y }, { scale: 1.05 }] };
  });
  const marker = useAnimatedStyle(() => {
    const g = geo.get();
    const slot = target.get();
    if (!g || slot < 0 || slot === from.get()) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: -10000 }] };
    const column = slot % g.columns, row = Math.floor(slot / g.columns);
    return { opacity: 1, transform: [{ translateX: g.padX + column * columnPitch(g, width.get()) }, { translateY: g.top + headerHeight.get() + row * (g.itemHeight + g.rowGap) - scroll.get() }] };
  });

  const size = geometry ? { width: geometry.itemWidth, height: geometry.itemHeight } : undefined;
  return <GestureDetector gesture={gesture}>
    <View style={styles.screen} onLayout={(event: LayoutChangeEvent) => { width.set(event.nativeEvent.layout.width); viewport.set(event.nativeEvent.layout.height); }}>
      <Animated.FlatList ref={listRef} {...list} data={data} numColumns={geometry?.columns ?? 1} key={geometry?.columns ?? 1}
        scrollEnabled={dragging === null} onScroll={onScroll} scrollEventThrottle={16}
        onContentSizeChange={(_width, height) => content.set(height)}
        contentContainerStyle={contentContainerStyle} columnWrapperStyle={(geometry?.columns ?? 1) > 1 ? columnWrapperStyle : undefined}
        ListHeaderComponent={header ? <View onLayout={event => headerHeight.set(event.nativeEvent.layout.height)}>{header}</View> : undefined}
        extraData={[dragging, list.extraData]} renderItem={info => renderItem({ ...info, dragging: info.index === dragging })} />
      <Animated.View pointerEvents="none" style={[styles.overlay, size, { borderColor: colors.systemBlue, backgroundColor: `${colors.systemBlue}1F` }, styles.marker, marker]}>
        <ThemedText style={[styles.drop, { color: colors.systemBlue }]}>Drop here</ThemedText>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.overlay, size, styles.ghost, ghost]}>
        {dragging !== null && data[dragging] !== undefined && renderGhost(data[dragging], dragging)}
      </Animated.View>
    </View>
  </GestureDetector>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  overlay: { position: 'absolute', left: 0, top: 0 },
  marker: { borderWidth: 3, borderStyle: 'dashed', borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  drop: { ...t.label },
  ghost: { elevation: 10, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
});

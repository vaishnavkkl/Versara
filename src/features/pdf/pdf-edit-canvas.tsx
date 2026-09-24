import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';

export type PdfTextObject = { id: number; text: string; editable: boolean; size: number; bounds: { x: number; y: number; width: number; height: number } | null };
type Props = {
  uri: string; width: number; height: number; objects: PdfTextObject[]; selectedId?: number;
  adding: boolean; disabled: boolean; removedIds: number[]; placement: { x: number; y: number } | null;
  onSelect: (object: PdfTextObject) => void; onPlace: (point: { x: number; y: number }) => void;
};

export const PdfEditCanvas = memo(function PdfEditCanvas(props: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const colors = usePalette();
  return <View style={[styles.viewport, { backgroundColor: colors.secondarySystemBackground }]} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }}>
    {size.width > 0 && size.height > 0 && <ZoomPage {...props} viewport={size} />}
  </View>;
});

function ZoomPage({ viewport, ...props }: Props & { viewport: { width: number; height: number } }) {
  const colors = usePalette();
  const fit = Math.min(viewport.width / props.width, viewport.height / props.height);
  const width = props.width * fit, height = props.height * fit;
  const zoom = useSharedValue(1);
  const tx = useSharedValue(0), ty = useSharedValue(0);
  const startZoom = useSharedValue(1), anchorX = useSharedValue(0), anchorY = useSharedValue(0);
  const pinching = useSharedValue(false), lastPointers = useSharedValue(0);
  useEffect(() => {
    const maxX = Math.max(0, (width * zoom.get() - viewport.width) / 2);
    const maxY = Math.max(0, (height * zoom.get() - viewport.height) / 2);
    tx.set(Math.min(maxX, Math.max(-maxX, tx.get())));
    ty.set(Math.min(maxY, Math.max(-maxY, ty.get())));
  }, [width, height, viewport.width, viewport.height, tx, ty, zoom]);
  function reset() { zoom.set(1); tx.set(0); ty.set(0); }
  const clampX = (value: number, scale: number) => {
    'worklet'; const limit = Math.max(0, (width * scale - viewport.width) / 2); return Math.min(limit, Math.max(-limit, value));
  };
  const clampY = (value: number, scale: number) => {
    'worklet'; const limit = Math.max(0, (height * scale - viewport.height) / 2); return Math.min(limit, Math.max(-limit, value));
  };
  function tap(x: number, y: number, scale: number) {
    if (props.disabled || x < 0 || x > 1 || y < 0 || y > 1) return;
    if (props.adding) { props.onPlace({ x, y }); return; }
    const toleranceX = 10 / (width * scale), toleranceY = 10 / (height * scale);
    const candidates = props.objects.filter(object => {
      const b = object.bounds;
      return b && !props.removedIds.includes(object.id) && x >= b.x - toleranceX && x <= b.x + b.width + toleranceX && y >= b.y - toleranceY && y <= b.y + b.height + toleranceY;
    });
    // Prefer an exact hit, then the nearest baseline when fragments are close together.
    candidates.sort((a, b) => {
      const score = (object: PdfTextObject) => {
        const box = object.bounds!;
        const exact = x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
        return (exact ? 0 : 100) + Math.abs(y - box.y - box.height / 2) + Math.abs(x - box.x - box.width / 2) * 0.01;
      };
      return score(a) - score(b);
    });
    if (candidates[0]) props.onSelect(candidates[0]);
  }
  const pinch = Gesture.Pinch().enabled(!props.disabled).onStart(event => {
    pinching.set(true); startZoom.set(zoom.get());
    anchorX.set((event.focalX - viewport.width / 2 - tx.get()) / zoom.get());
    anchorY.set((event.focalY - viewport.height / 2 - ty.get()) / zoom.get());
  }).onUpdate(event => {
    const next = Math.max(1, Math.min(5, startZoom.get() * event.scale));
    zoom.set(next);
    tx.set(clampX(event.focalX - viewport.width / 2 - anchorX.get() * next, next));
    ty.set(clampY(event.focalY - viewport.height / 2 - anchorY.get() * next, next));
  }).onFinalize(() => { pinching.set(false); lastPointers.set(0); });
  const pan = Gesture.Pan().enabled(!props.disabled).minDistance(8).averageTouches(true).onBegin(() => { lastPointers.set(0); }).onChange(event => {
    if (!pinching.get() && event.numberOfPointers === 1 && lastPointers.get() === 1) {
      tx.set(clampX(tx.get() + event.changeX, zoom.get()));
      ty.set(clampY(ty.get() + event.changeY, zoom.get()));
    }
    lastPointers.set(event.numberOfPointers);
  });
  const doubleTap = Gesture.Tap().enabled(!props.disabled).numberOfTaps(2).maxDelay(230).onTouchesDown((event, manager) => { if (event.numberOfTouches > 1) manager.fail(); }).onEnd((event, success) => {
    if (!success) return;
    const next = zoom.get() > 1.1 ? 1 : 2.5;
    const ratio = next / zoom.get();
    tx.set(clampX((event.x - viewport.width / 2) * (1 - ratio) + tx.get() * ratio, next));
    ty.set(clampY((event.y - viewport.height / 2) * (1 - ratio) + ty.get() * ratio, next));
    zoom.set(next);
  });
  const singleTap = Gesture.Tap().enabled(!props.disabled).maxDistance(8).onTouchesDown((event, manager) => { if (event.numberOfTouches > 1) manager.fail(); }).onEnd((event, success) => {
    if (success) scheduleOnRN(tap, ((event.x - viewport.width / 2 - tx.get()) / zoom.get() + width / 2) / width, ((event.y - viewport.height / 2 - ty.get()) / zoom.get() + height / 2) / height, zoom.get());
  });
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: zoom.get() }] }));
  return <>
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap))}>
      <View style={styles.gestureSurface} collapsable={false} accessibilityLabel="PDF page. Pinch to zoom, drag to move, double tap to zoom or fit.">
        <Animated.View pointerEvents="none" style={[styles.page, { width, height }, transform]}>
          <Image source={{ uri: props.uri }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="none" allowDownscaling={false} />
          {!props.adding && props.objects.filter(object => object.id === props.selectedId || !props.removedIds.includes(object.id)).slice(0, 300).map(object => object.bounds && <View key={object.id} style={[styles.outline, {
            left: object.bounds.x * width, top: object.bounds.y * height, width: Math.max(2, object.bounds.width * width), height: Math.max(2, object.bounds.height * height),
            borderColor: object.id === props.selectedId ? '#1565ff' : '#1565ff44', backgroundColor: object.id === props.selectedId ? '#1565ff22' : 'transparent',
          }]} />)}
          {props.placement && <View style={[styles.marker, { left: props.placement.x * width, top: props.placement.y * height }]} />}
        </Animated.View>
      </View>
    </GestureDetector>
    <Pressable accessibilityRole="button" accessibilityLabel="Reset PDF zoom to fit page" onPress={reset} style={[styles.fit, { backgroundColor: colors.navBackground }]}><ThemedText style={{ color: colors.navIcon }}>Fit</ThemedText></Pressable>
  </>;
}
const styles = StyleSheet.create({
  viewport: { flex: 1, minHeight: 120, overflow: 'hidden' }, gestureSurface: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { backgroundColor: '#fff' }, outline: { position: 'absolute', borderWidth: 0.6 }, marker: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#1565ff', transform: [{ translateX: -4 }, { translateY: -4 }] },
  fit: { position: 'absolute', right: 10, top: 10, minWidth: 44, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});

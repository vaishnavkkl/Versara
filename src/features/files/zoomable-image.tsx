import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ThemedText } from '@/components/themed-text';
import NativeZoomableImage, { hasNativeZoomImage } from '../../../modules/file-engine/src/ZoomableImageView';

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;
const SPRING = { damping: 22, stiffness: 220 };

type Props = { uri: string; onClose: () => void };

/** Pinch and double-tap to zoom at the touch point, drag to pan while zoomed, swipe down at normal size to close. */
export function ZoomableImage(props: Props) {
  return hasNativeZoomImage && NativeZoomableImage ? <NativeImage {...props} /> : <GestureImage {...props} />;
}

function NativeImage({ uri, onClose }: Props) {
  const [state, setState] = useState<{ uri: string; loading: boolean; error: string | null }>({ uri, loading: true, error: null });
  const current = state.uri === uri ? state : { uri, loading: true, error: null };
  if (!NativeZoomableImage) return null;
  if (current.error) return <View style={styles.message}><ThemedText style={styles.center}>{current.error}</ThemedText></View>;
  return <View style={styles.fill}>
    <NativeZoomableImage source={uri} style={styles.fill} onLoad={() => setState({ uri, loading: false, error: null })} onError={({ nativeEvent }) => setState({ uri, loading: false, error: nativeEvent.message })} onDismiss={onClose} />
    {current.loading && <AppLoader style={StyleSheet.absoluteFill} />}
  </View>;
}

function GestureImage({ uri, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const width = useSharedValue(1);
  const height = useSharedValue(1);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const dismiss = useSharedValue(0);

  const clampX = (value: number, zoom: number) => {
    'worklet';
    const limit = (width.value * (zoom - 1)) / 2;
    return Math.min(limit, Math.max(-limit, value));
  };
  const clampY = (value: number, zoom: number) => {
    'worklet';
    const limit = (height.value * (zoom - 1)) / 2;
    return Math.min(limit, Math.max(-limit, value));
  };
  const reset = () => {
    'worklet';
    scale.value = withSpring(1, SPRING); savedScale.value = 1;
    x.value = withSpring(0, SPRING); y.value = withSpring(0, SPRING);
    savedX.value = 0; savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      const next = Math.min(MAX_SCALE, Math.max(0.8, savedScale.value * event.scale));
      // Keep the point between the fingers steady while zooming.
      const focusX = event.focalX - width.value / 2;
      const focusY = event.focalY - height.value / 2;
      const ratio = next / savedScale.value;
      x.value = focusX + (savedX.value - focusX) * ratio;
      y.value = focusY + (savedY.value - focusY) * ratio;
      scale.value = next;
    })
    .onEnd(() => {
      if (scale.value <= 1) { reset(); return; }
      savedScale.value = scale.value;
      savedX.value = clampX(x.value, scale.value); savedY.value = clampY(y.value, scale.value);
      x.value = withSpring(savedX.value, SPRING); y.value = withSpring(savedY.value, SPRING);
    });

  const pan = Gesture.Pan()
    .minDistance(6)
    .averageTouches(true)
    .onUpdate(event => {
      if (savedScale.value > 1) {
        x.value = clampX(savedX.value + event.translationX, savedScale.value);
        y.value = clampY(savedY.value + event.translationY, savedScale.value);
      } else if (scale.value <= 1) {
        dismiss.value = Math.max(0, event.translationY);
      }
    })
    .onEnd(event => {
      if (savedScale.value > 1) { savedX.value = x.value; savedY.value = y.value; return; }
      if (dismiss.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        dismiss.value = withTiming(height.value, { duration: 180 }, finished => { if (finished) scheduleOnRN(onClose); });
      } else dismiss.value = withSpring(0, SPRING);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(260)
    .onEnd(event => {
      if (savedScale.value > 1) { reset(); return; }
      const focusX = event.x - width.value / 2;
      const focusY = event.y - height.value / 2;
      const targetX = clampX(-focusX * (DOUBLE_TAP_SCALE - 1), DOUBLE_TAP_SCALE);
      const targetY = clampY(-focusY * (DOUBLE_TAP_SCALE - 1), DOUBLE_TAP_SCALE);
      scale.value = withSpring(DOUBLE_TAP_SCALE, SPRING); savedScale.value = DOUBLE_TAP_SCALE;
      x.value = withSpring(targetX, SPRING); y.value = withSpring(targetY, SPRING);
      savedX.value = targetX; savedY.value = targetY;
    });

  // Double tap must not block pinch; pan needs movement so taps never trigger it.
  const gesture = Gesture.Simultaneous(doubleTap, pinch, pan);
  const imageStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.6, dismiss.value / (height.value * 1.2)),
    transform: [
      { translateX: x.value },
      { translateY: y.value + dismiss.value },
      { scale: scale.value * (1 - Math.min(0.25, dismiss.value / (height.value * 2))) },
    ],
  }));

  if (error) return <View style={styles.message}><ThemedText style={styles.center}>This image format could not be previewed on your device.</ThemedText></View>;
  return <GestureDetector gesture={gesture}>
    <View collapsable={false} style={styles.fill} onLayout={event => { width.set(event.nativeEvent.layout.width); height.set(event.nativeEvent.layout.height); }}
      accessible accessibilityRole="image" accessibilityHint="Pinch or double tap to zoom. Swipe down to close.">
      <Animated.View style={[styles.fill, imageStyle]}>
        <Image source={{ uri }} contentFit="contain" cachePolicy="none" style={styles.fill} onLoad={() => setLoading(false)} onError={() => { setLoading(false); setError(true); }} />
      </Animated.View>
      {loading && <AppLoader style={StyleSheet.absoluteFill} />}
    </View>
  </GestureDetector>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  center: { textAlign: 'center' },
});

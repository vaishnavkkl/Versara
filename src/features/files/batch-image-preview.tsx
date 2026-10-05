import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ThemedText } from '@/components/themed-text';
import { ToolRowButton } from '@/components/tool-action-row';
import { AppLoader } from '@/components/app-loader';
import { PdfPreviewStage, type PdfPreviewImage } from '../pdf/pdf-preview';

/** Only the selected, bounded native preview is decoded. Batch exports remain sequential. */
export function BatchImagePreview({ image, name, index, count, active, disabled, updating, onSelect }: {
  image?: PdfPreviewImage; name: string; index: number; count: number; active: boolean;
  disabled: boolean; updating: boolean; onSelect: (index: number) => void;
}) {
  const reduced = useReducedMotion();
  const drag = useSharedValue(0);
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  useEffect(() => { drag.set(0); scale.set(1); }, [index, drag, scale]);
  useEffect(() => () => { cancelAnimation(drag); cancelAnimation(scale); }, [drag, scale]);
  const swipe = Gesture.Pan().enabled(active && !disabled && count > 1).maxPointers(1)
    .activeOffsetX([-18, 18]).failOffsetY([-24, 24])
    .onUpdate(event => { if (scale.get() <= 1.05) drag.set(event.translationX * .35); })
    .onEnd(event => {
      if (scale.get() <= 1.05 && (Math.abs(event.translationX) > 55 || Math.abs(event.velocityX) > 600)) {
        const next = Math.max(0, Math.min(count - 1, index + (event.translationX < 0 ? 1 : -1)));
        if (next !== index) scheduleOnRN(onSelect, next);
      }
    }).onFinalize(() => { drag.set(withTiming(0, { duration: reduced ? 0 : 160 })); });
  const pinch = Gesture.Pinch().enabled(active && !disabled)
    .onBegin(() => { startScale.set(scale.get()); })
    .onUpdate(event => { scale.set(Math.max(1, Math.min(3, startScale.get() * event.scale))); });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: drag.get() }, { scale: scale.get() }] }));
  return <>
    <View style={styles.navigation}>
      <ToolRowButton label="Previous image" icon={{ ios: 'chevron.left', android: 'chevron-left' }} disabled={disabled || index === 0} onPress={() => onSelect(index - 1)} />
      <ThemedText numberOfLines={1} accessibilityLiveRegion="polite" style={styles.label}>{index + 1} / {count} · {name}</ThemedText>
      <ToolRowButton label="Next image" icon={{ ios: 'chevron.right', android: 'chevron-right' }} disabled={disabled || index === count - 1} onPress={() => onSelect(index + 1)} />
    </View>
    <PdfPreviewStage hint="Swipe left or right for another image. Pinch to zoom; Fit restores swiping." status={updating ? 'Updating…' : undefined} onFit={() => { scale.set(1); drag.set(0); }}>
      <GestureDetector gesture={Gesture.Simultaneous(swipe, pinch)}>
        <Animated.View style={[styles.image, style]}>
          {active && image ? <Image source={image.uri} style={styles.image} contentFit="contain" cachePolicy="none" recyclingKey={image.uri} transition={reduced ? 0 : 100} accessibilityLabel={name} /> : <View style={styles.loading}><AppLoader /></View>}
        </Animated.View>
      </GestureDetector>
    </PdfPreviewStage>
  </>;
}

const styles = StyleSheet.create({
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  label: { flex: 1, minWidth: 0, fontSize: 12, textAlign: 'center' },
  image: { flex: 1, width: '100%' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

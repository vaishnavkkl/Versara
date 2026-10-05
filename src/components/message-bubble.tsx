import { useEffect, useState } from 'react';
import { AppState, Dimensions, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';

export type BubbleAnchor = { x: number; y: number; width: number; height: number };

/** An anchored, dismissible explanation. No expiry timer; long/accessibility text can scroll. */
export function MessageBubble({ anchor, message, onClose }: { anchor: BubbleAnchor; message: string; onClose: () => void }) {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [openedWindow] = useState({ width: window.width, height: window.height });
  const [height, setHeight] = useState(120);
  useEffect(() => {
    const resize = Dimensions.addEventListener('change', onClose);
    const app = AppState.addEventListener('change', state => { if (state !== 'active') onClose(); });
    return () => { resize.remove(); app.remove(); };
  }, [onClose]);
  const width = Math.min(300, window.width - insets.left - insets.right - s.md * 2);
  const minY = insets.top + s.sm;
  const maxY = window.height - insets.bottom - s.sm;
  const maxHeight = Math.max(80, maxY - minY);
  const measuredHeight = Math.min(height, maxHeight);
  const above = anchor.y - s.sm - measuredHeight >= minY;
  const top = Math.max(minY, Math.min(maxY - measuredHeight, above ? anchor.y - s.sm - measuredHeight : anchor.y + anchor.height + s.sm));
  const left = Math.max(insets.left + s.md, Math.min(window.width - insets.right - s.md - width, anchor.x + anchor.width / 2 - width / 2));
  const pointer = Math.max(s.md, Math.min(width - s.md, anchor.x + anchor.width / 2 - left));
  if (openedWindow.width !== window.width || openedWindow.height !== window.height) return null;
  return <Modal transparent animationType="none" presentationStyle="overFullScreen" statusBarTranslucent navigationBarTranslucent supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
    <View style={styles.fill} accessibilityViewIsModal onAccessibilityEscape={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss help message" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={[styles.bubble, { left, top, width, maxHeight, backgroundColor: colors.sheetBackground, borderColor: colors.separator, shadowColor: colors.label }]} onLayout={event => {
        // Native events are pooled; retain only the number for the deferred update.
        const nextHeight = event.nativeEvent.layout.height;
        setHeight(current => Math.abs(current - nextHeight) < 1 ? current : nextHeight);
      }}>
        <View pointerEvents="none" style={[styles.pointer, { left: pointer - s.xs, backgroundColor: colors.sheetBackground }, above ? { bottom: -s.xs } : { top: -s.xs }]} />
        <View style={styles.row}>
          <ScrollView style={styles.text} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ThemedText accessibilityLiveRegion="polite" style={t.body}>{message}</ThemedText>
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel="Close help message" onPress={onClose} style={styles.close}><UniversalIcon ios="xmark" android="close" size={20} color={colors.secondaryLabel} /></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  bubble: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: s.sm, elevation: 8, shadowOpacity: 0.18, shadowRadius: s.sm, shadowOffset: { width: 0, height: s.xs } },
  pointer: { position: 'absolute', width: s.sm, height: s.sm, transform: [{ rotate: '45deg' }] },
  row: { flexDirection: 'row', flexShrink: 1, alignItems: 'flex-start' },
  text: { flexShrink: 1 }, content: { padding: s.sm },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, TextInput, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import type { OptionIcon } from '@/theme/editor-icons';
import { ControlHelpBridge, useControlHelp } from './control-help';
import { HelpButton } from './help-button';

type Props = {
  visible: boolean;
  /** The user asked to close: swipe down, backdrop tap, back button or the close button. */
  onClose: () => void;
  /** Runs once the sheet has finished hiding, whatever closed it. */
  onDismissed?: () => void;
  title?: string;
  subtitle?: string;
  icon?: OptionIcon;
  /** Largest share of the window a content-sized sheet may take. */
  maxHeight?: number;
  /** Fixed heights such as ['75%']. Children then own their scrolling with gorhom scrollables. */
  snapPoints?: (string | number)[];
  contentStyle?: StyleProp<ViewStyle>;
  /** Dim what is behind the sheet. Turn off for live editing controls whose result should stay visible. */
  dim?: boolean;
  /** Form inputs use BottomSheetTextInput; the sheet owns keyboard avoidance. */
  keyboardInput?: boolean;
  children: ReactNode;
};

/** The app's only bottom sheet: gorhom's modal sheet with a titled handle, backdrop and back-button support. */
export function AppBottomSheet({ visible, onClose, onDismissed, title, subtitle, icon, maxHeight = 0.85, snapPoints, contentStyle, dim = true, keyboardInput = false, children }: Props) {
  const colors = usePalette();
  const help = useControlHelp();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheet = useRef<BottomSheetModal>(null);
  const shown = useRef(false);
  const position = useSharedValue(0);
  const close = useCallback(() => { Keyboard.dismiss(); onClose(); }, [onClose]);

  useEffect(() => {
    if (visible && !shown.current) { shown.current = true; if (Keyboard.isVisible()) Keyboard.dismiss(); sheet.current?.present(); }
    else if (!visible && shown.current) sheet.current?.dismiss();
  }, [visible]);
  // Close option sheets when a field behind them opens the keyboard.
  // Form sheets use BottomSheetTextInput and handle their own keyboard positioning.
  useEffect(() => {
    if (!visible || keyboardInput) return;
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      const input = TextInput.State.currentlyFocusedInput();
      if (!input) return;
      const top = position.value;
      input.measureInWindow((_x, y, _width, inputHeight) => {
        if (y + inputHeight / 2 < top) onClose();
      });
    });
    return () => subscription.remove();
  }, [visible, keyboardInput, onClose, position]);
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => subscription.remove();
  }, [visible, close]);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" opacity={dim ? 0.45 : 0} />, [dim]);
  const handle = useCallback(() => <View style={styles.handleArea}>
    <View style={[styles.indicator, { backgroundColor: colors.separator }]} />
    {!!title && <View style={styles.header}>
      {icon && <View style={[styles.badge, { backgroundColor: colors.accentSurface }]}><UniversalIcon {...icon} size={18} color={colors.systemBlue} /></View>}
      <View style={styles.grow}>
        <ThemedText accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</ThemedText>
        {!!subtitle && <ThemedText numberOfLines={1} style={[styles.subtitle, { color: colors.secondaryLabel }]}>{subtitle}</ThemedText>}
      </View>
      {help && <ControlHelpBridge value={help}><HelpButton /></ControlHelpBridge>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={close} hitSlop={4} style={({ pressed }) => [styles.close, { backgroundColor: colors.fieldSurface, opacity: pressed ? 0.6 : 1 }]}>
        <UniversalIcon ios="xmark" android="close" size={20} color={colors.secondaryLabel} />
      </Pressable>
    </View>}
  </View>, [colors, title, subtitle, icon, close, help]);

  const dynamic = !snapPoints;
  return <BottomSheetModal ref={sheet} animatedPosition={position} snapPoints={snapPoints} enableDynamicSizing={dynamic} maxDynamicContentSize={Math.max(200, height * maxHeight - insets.top)}
    topInset={insets.top} backdropComponent={backdrop} handleComponent={handle} enableContentPanningGesture={false}
    backgroundStyle={{ backgroundColor: colors.sheetBackground }} keyboardBehavior="interactive" keyboardBlurBehavior="restore" enableBlurKeyboardOnGesture android_keyboardInputMode="adjustResize"
    onDismiss={() => { const user = shown.current && visible; shown.current = false; if (user) onClose(); onDismissed?.(); }}>
    <ControlHelpBridge value={help}>{dynamic
      ? <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }, contentStyle]}>{children}</BottomSheetScrollView>
      : <View style={[styles.fill, { paddingBottom: insets.bottom }, contentStyle]}>{children}</View>}</ControlHelpBridge>
  </BottomSheetModal>;
}

const styles = StyleSheet.create({
  handleArea: { paddingTop: 8 },
  indicator: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  badge: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { fontSize: 13 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 12, gap: 10 },
  fill: { flex: 1 },
});

import React, { memo, useEffect, useRef, useState } from 'react';
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { motion, radius, spacing as s, typography as t } from '@/theme/dashboard';

type IconProps = React.ComponentProps<typeof UniversalIcon>;
type TabDef = { key: string; label: string; ios: IconProps['ios']; iosActive: IconProps['ios']; android: IconProps['android']; androidActive: IconProps['android'] };
type Props = { tabs: readonly TabDef[]; activeIndex: number; onTabPress: (index: number) => void };
const PILL_WIDTH = 60;
const PILL_HEIGHT = 34;

function TabItem({ tab, index, selected, position, onPress }: { tab: TabDef; index: number; selected: boolean; position: SharedValue<number>; onPress: () => void }) {
  const colors = usePalette();
  const activeStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(position.get() - index)) }));
  return <Pressable onPress={onPress} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
    style={({ pressed }) => [styles.slot, { opacity: pressed ? 0.7 : 1 }]}>
    <View style={styles.icon} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <UniversalIcon ios={tab.ios} android={tab.android} size={23} color={colors.secondaryLabel} />
      <Animated.View style={[styles.activeIcon, activeStyle]}><UniversalIcon ios={tab.iosActive} android={tab.androidActive} size={23} color={colors.systemBlue} /></Animated.View>
    </View>
    <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={[styles.label, { color: selected ? colors.label : colors.secondaryLabel }]}>{tab.label}</Text>
  </Pressable>;
}

/** Stable hit targets and one interruptible indicator; tab content never waits for its animation. */
export const CustomTabBar = memo(function CustomTabBar({ tabs, activeIndex, onTabPress }: Props) {
  const insets = useSafeAreaInsets();
  const colors = usePalette();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const previousWidth = useRef(0);
  const position = useSharedValue(activeIndex);
  const slotWidth = width / Math.max(1, tabs.length);
  const rtl = I18nManager.isRTL;
  useEffect(() => {
    // First layout, rotation and accessibility layout changes should not fly in from the wrong slot.
    const resized = previousWidth.current !== width;
    previousWidth.current = width;
    position.set(reduced || resized ? activeIndex : withSpring(activeIndex, { ...motion.tab, reduceMotion: ReduceMotion.System, overshootClamping: true }));
  }, [activeIndex, position, reduced, width]);
  useEffect(() => () => cancelAnimation(position), [position]);
  const indicator = useAnimatedStyle(() => ({
    transform: [{ translateX: (rtl ? tabs.length - 1 - position.get() : position.get()) * slotWidth + (slotWidth - PILL_WIDTH) / 2 }],
  }));
  return <View style={[styles.bar, { backgroundColor: colors.systemBackground, borderColor: colors.separator, paddingBottom: Math.max(insets.bottom, s.sm) }]}>
    <View style={[styles.row, rtl && styles.rtl]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 && <Animated.View pointerEvents="none" style={[styles.indicator, { backgroundColor: `${colors.systemBlue}26` }, indicator]} />}
      {tabs.map((tab, index) => <TabItem key={tab.key} tab={tab} index={index} selected={activeIndex === index} position={position} onPress={() => onTabPress(index)} />)}
    </View>
  </View>;
});

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: s.md, paddingTop: s.sm },
  row: { direction: 'ltr', flexDirection: 'row', width: '100%', maxWidth: 560, alignSelf: 'center' },
  rtl: { flexDirection: 'row-reverse' },
  slot: { flex: 1, minWidth: 0, minHeight: 62, alignItems: 'center', paddingHorizontal: s.xs, gap: s.xs },
  icon: { height: PILL_HEIGHT, width: PILL_WIDTH, alignItems: 'center', justifyContent: 'center' },
  activeIcon: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  indicator: { position: 'absolute', left: 0, top: 0, width: PILL_WIDTH, height: PILL_HEIGHT, borderRadius: radius.pill },
  label: { ...t.tabLabel, textAlign: 'center' },
});

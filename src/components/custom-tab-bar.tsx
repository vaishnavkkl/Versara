import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { brandFont, getGradients, spacing } from '@/theme/dashboard';

type IconProps = React.ComponentProps<typeof UniversalIcon>;
type TabDef = {
  key: string;
  label: string;
  ios: IconProps['ios'];
  iosActive: IconProps['ios'];
  android: IconProps['android'];
  androidActive: IconProps['android'];
};
type CustomTabBarProps = { tabs: readonly TabDef[]; activeIndex: number; onTabPress: (index: number) => void };

const MOVE = LinearTransition.duration(140).easing(Easing.out(Easing.quad));
const LABEL_IN = FadeIn.duration(110);
const LABEL_OUT = FadeOut.duration(60);

/** Fixed bottom bar: primary gradient, white icons and a white pill that grows to show the active tab's name. */
export const CustomTabBar = memo(function CustomTabBar({ tabs, activeIndex, onTabPress }: CustomTabBarProps) {
  const insets = useSafeAreaInsets();
  const colors = usePalette();
  const reduced = useReducedMotion();
  const layout = reduced ? undefined : MOVE;
  return (
    <View style={[styles.bar, getGradients(colors).navigation, { backgroundColor: colors.navBackground, boxShadow: colors.navShadow, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={styles.row}>
        {tabs.map((tab, index) => {
          const selected = activeIndex === index;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabPress(index)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              hitSlop={4}
              style={styles.slot}
            >
              <Animated.View layout={layout} style={[styles.item, selected && [styles.active, { backgroundColor: colors.navSelected }]]}>
                <UniversalIcon
                  ios={selected ? tab.iosActive : tab.ios}
                  android={selected ? tab.androidActive : tab.android}
                  size={24}
                  color={selected ? colors.navSelectedIcon : colors.navIcon}
                />
                {selected && <Animated.View entering={reduced ? undefined : LABEL_IN} exiting={reduced ? undefined : LABEL_OUT}>
                  <Text numberOfLines={1} style={[styles.label, { color: colors.navSelectedIcon }]}>{tab.label}</Text>
                </Animated.View>}
              </Animated.View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 560, alignSelf: 'center' },
  slot: { minHeight: 58, minWidth: 52, alignItems: 'center', justifyContent: 'center' },
  item: {
    height: 50,
    minWidth: 50,
    paddingHorizontal: 12,
    borderRadius: 25,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  active: { paddingLeft: 16, paddingRight: 18, boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)' },
  label: { ...brandFont.label, fontSize: 14, lineHeight: 19, letterSpacing: 0.1 },
});

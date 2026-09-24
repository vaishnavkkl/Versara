import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette, type Palette } from '@/theme/colors';
import { getGradients, radius, spacing } from '@/theme/dashboard';

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

export function CustomTabBar({ tabs, activeIndex, onTabPress }: CustomTabBarProps) {
  const insets = useSafeAreaInsets();
  const colors = usePalette();
  const styles = createStyles(colors);

  return (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={[styles.pill, getGradients(colors).navigation]}>
        {tabs.map((tab, index) => {
          const selected = activeIndex === index;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabPress(index)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <View style={[styles.icon, selected && styles.selected, selected && getGradients(colors).tabSelected]}>
                <UniversalIcon
                  ios={selected ? tab.iosActive : tab.ios}
                  android={selected ? tab.androidActive : tab.android}
                  size={24}
                  color={selected ? colors.navSelectedIcon : colors.navIcon}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (colors: Palette) => StyleSheet.create({
  // Reserve space below the screen so the floating shape never covers a card.
  dock: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.systemBackground,
    alignItems: 'center',
  },
  pill: {
    width: '100%',
    maxWidth: 440,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xs,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.navBackground,
    borderWidth: 1,
    borderColor: colors.navBorder,
    boxShadow: colors.navShadow,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 64,
    maxWidth: '100%',
    height: 46,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.navSelected },
  pressed: { opacity: 0.65 },
});

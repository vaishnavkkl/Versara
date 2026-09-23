import React, { useCallback } from 'react';
import {
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolateColor,
  runOnJS,
} from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';

// ─── Types ────────────────────────────────────────────────────────────────────

type IOSSymbol = import('expo-symbols').SFSymbol;
type AndroidIcon = React.ComponentProps<typeof MaterialIcons>['name'];

type TabDef = {
  key: string;
  label: string;
  ios: IOSSymbol;
  iosActive: IOSSymbol;
  android: AndroidIcon;
  androidActive: AndroidIcon;
};

type CustomTabBarProps = {
  tabs: TabDef[];
  activeIndex: number;
  onTabPress: (index: number) => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCENT = '#FC8019'; // Swiggy-orange brand accent
const SPRING_CONFIG = { damping: 18, stiffness: 280, mass: 0.8 };

// ─── Single Tab Item ──────────────────────────────────────────────────────────

type TabItemProps = {
  tab: TabDef;
  isActive: boolean;
  onPress: () => void;
};

function TabItem({ tab, isActive, onPress }: TabItemProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const scale = useSharedValue(1);
  const activeProgress = useSharedValue(isActive ? 1 : 0);

  // Keep shared value in sync when active state changes externally
  React.useEffect(() => {
    activeProgress.value = withTiming(isActive ? 1 : 0, { duration: 180 });
  }, [isActive, activeProgress]);

  const handlePress = useCallback(() => {
    scale.value = withSpring(0.82, SPRING_CONFIG, () => {
      scale.value = withSpring(1, SPRING_CONFIG);
    });
    onPress();
  }, [scale, onPress]);

  const animatedContainer = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const animatedIndicator = useAnimatedStyle(() => ({
    opacity: activeProgress.value,
    transform: [{ scaleX: withSpring(isActive ? 1 : 0, SPRING_CONFIG) }],
  }));

  const inactiveColor = isDark ? '#888' : '#999';

  return (
    <TouchableOpacity
      style={styles.tabItem}
      onPress={handlePress}
      activeOpacity={1}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: isActive }}
    >
      {/* Indicator pill above icon */}
      <Animated.View style={[styles.indicator, animatedIndicator]} />

      {/* Icon */}
      <Animated.View style={animatedContainer}>
        {process.env.EXPO_OS === 'ios' ? (
          <SymbolView
            name={isActive ? tab.iosActive : tab.ios}
            tintColor={isActive ? ACCENT : inactiveColor}
            resizeMode="scaleAspectFit"
            style={{ width: 26, height: 26 }}
          />
        ) : (
          <MaterialIcons
            name={isActive ? tab.androidActive : tab.android}
            size={26}
            color={isActive ? ACCENT : inactiveColor}
          />
        )}
      </Animated.View>

      {/* Label */}
      <Animated.Text
        style={[
          styles.label,
          { color: isActive ? ACCENT : inactiveColor },
        ]}
        numberOfLines={1}
      >
        {tab.label}
      </Animated.Text>
    </TouchableOpacity>
  );
}

// ─── Custom Tab Bar ───────────────────────────────────────────────────────────

export function CustomTabBar({ tabs, activeIndex, onTabPress }: CustomTabBarProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const barBg = isDark ? '#111111' : '#FFFFFF';

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: barBg,
          paddingBottom: Math.max(insets.bottom, 8),
          // Premium glass-like shadow
          boxShadow: isDark
            ? '0 -1px 0 rgba(255,255,255,0.06)'
            : '0 -1px 0 rgba(0,0,0,0.08), 0 -4px 16px rgba(0,0,0,0.04)',
        } as any,
      ]}
    >
      {tabs.map((tab, i) => (
        <TabItem
          key={tab.key}
          tab={tab}
          isActive={i === activeIndex}
          onPress={() => onTabPress(i)}
        />
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 8,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },

  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingTop: 6,
  },

  indicator: {
    width: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: ACCENT,
    position: 'absolute',
    top: -6,
  },

  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

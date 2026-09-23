import React from 'react';
import { SymbolView } from 'expo-symbols';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';

type IOSSymbol = import('expo-symbols').SFSymbol;
type AndroidIcon = React.ComponentProps<typeof MaterialIcons>['name'];

type IconProps = {
  /** SF Symbol name for iOS */
  ios: IOSSymbol;
  /** Material icon name for Android */
  android: AndroidIcon;
  size?: number;
  color?: string;
};

/**
 * Cross-platform icon: SF Symbols on iOS, Material Icons on Android.
 * Never use emoji or SF Symbol names on Android.
 */
export function UniversalIcon({
  ios,
  android,
  size = 24,
  color = colors.label as string,
}: IconProps) {
  if (process.env.EXPO_OS === 'ios') {
    return (
      <SymbolView
        name={ios}
        tintColor={color}
        resizeMode="scaleAspectFit"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <MaterialIcons
      name={android}
      size={size}
      color={color}
    />
  );
}

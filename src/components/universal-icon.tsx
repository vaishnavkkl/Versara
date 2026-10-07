import React from 'react';
import { SymbolView } from 'expo-symbols';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { usePalette } from '@/theme/colors';

type IOSSymbol = import('expo-symbols').SFSymbol;
type CommunityIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
/** A Material icon name, or `mdi:<name>` for the Material Community outline set. */
type AndroidIcon = React.ComponentProps<typeof MaterialIcons>['name'] | `mdi:${CommunityIcon}`;

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
  color,
}: IconProps) {
  const colors = usePalette();
  const tint = color ?? colors.label;
  if (process.env.EXPO_OS === 'ios') {
    return (
      <SymbolView
        name={ios}
        weight="medium"
        tintColor={tint}
        resizeMode="scaleAspectFit"
        style={{ width: size, height: size }}
      />
    );
  }

  if (android.startsWith('mdi:')) {
    return <MaterialCommunityIcons name={android.slice(4) as CommunityIcon} size={size} color={tint} />;
  }
  return (
    <MaterialIcons
      name={android as React.ComponentProps<typeof MaterialIcons>['name']}
      size={size}
      color={tint}
    />
  );
}

import React from 'react';
import { SymbolView } from 'expo-symbols';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { usePalette } from '@/theme/colors';

type IOSSymbol = import('expo-symbols').SFSymbol;
type CommunityIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type MaterialIcon = React.ComponentProps<typeof MaterialIcons>['name'];
/** A Material icon name, or `mdi:<name>` for the Material Community outline set. */
type AndroidIcon = MaterialIcon | `mdi:${CommunityIcon}`;

type IconProps = {
  /** SF Symbol name for iOS */
  ios: IOSSymbol;
  /** Material icon name for Android */
  android: AndroidIcon;
  size?: number;
  color?: string;
  /** Solid, layered artwork for app-style tiles: hierarchical SF Symbols and filled Material glyphs. */
  filled?: boolean;
};

function solid<T extends string>(name: T, glyphs: object): T {
  for (const suffix of ['-outline', '-outlined', '-border']) {
    if (!name.endsWith(suffix)) continue;
    const base = name.slice(0, -suffix.length);
    if (base in glyphs) return base as T;
  }
  return name;
}

/**
 * Cross-platform icon: SF Symbols on iOS, Material Icons on Android.
 * Never use emoji or SF Symbol names on Android.
 */
export function UniversalIcon({
  ios,
  android,
  size = 24,
  color,
  filled = false,
}: IconProps) {
  const colors = usePalette();
  const tint = color ?? colors.label;
  if (process.env.EXPO_OS === 'ios') {
    return (
      <SymbolView
        name={ios}
        weight={filled ? 'semibold' : 'medium'}
        type={filled ? 'hierarchical' : 'monochrome'}
        tintColor={tint}
        resizeMode="scaleAspectFit"
        style={{ width: size, height: size }}
      />
    );
  }

  if (android.startsWith('mdi:')) {
    const name = android.slice(4) as CommunityIcon;
    return <MaterialCommunityIcons name={filled ? solid(name, MaterialCommunityIcons.glyphMap) : name} size={size} color={tint} />;
  }
  const name = android as MaterialIcon;
  return (
    <MaterialIcons
      name={filled ? solid(name, MaterialIcons.glyphMap) : name}
      size={size}
      color={tint}
    />
  );
}

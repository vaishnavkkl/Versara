import { useId, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { AppLoader } from './app-loader';
import { UniversalIcon } from './universal-icon';
import { usePalette, type Palette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';

type Icon = ComponentProps<typeof UniversalIcon>;
export type BrandArt = 'pdf' | 'image' | 'files' | 'privacy' | 'tools';

const isDark = (colors: Palette) => colors.systemBackground === '#000000';

/** The white app-icon tile every tool glyph sits on; a soft lift in light mode, a raised grey in dark mode. */
export function GlyphTile({ size, selected = false, style, children }: { size: number; selected?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const colors = usePalette();
  const dark = isDark(colors);
  return <View style={[styles.tile, {
    width: size, height: size, borderRadius: Math.round(size * 0.3),
    backgroundColor: dark ? '#2C2C2E' : '#FFFFFF',
    borderColor: selected ? colors.systemBlue : dark ? '#FFFFFF1A' : '#0F172A12',
    borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
    boxShadow: dark ? undefined : size >= 40 ? '0px 2px 6px rgba(15, 23, 42, 0.10)' : '0px 1px 3px rgba(15, 23, 42, 0.10)',
  }, style]}>{children}</View>;
}

/** Document + pen mark for Edit PDF — reads clearer than a lone pencil in a tool grid. */
function EditPdfArt({ size, color }: { size: number; color: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M5.4 3.2h8.1L18.6 8v11.4a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V5a1.8 1.8 0 0 1 1.8-1.8z" fill={color} fillOpacity={0.14} />
    <Path d="M5.4 3.2h8.1L18.6 8v11.4a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V5a1.8 1.8 0 0 1 1.8-1.8z" stroke={color} strokeWidth={1.65} strokeLinejoin="round" fill="none" />
    <Path d="M13.5 3.3V7a1.4 1.4 0 0 0 1.4 1.4h3.7" stroke={color} strokeWidth={1.65} strokeLinejoin="round" fill="none" />
    <Path d="M7.2 12.2h6.8M7.2 15.1h4.6" stroke={color} strokeWidth={1.55} strokeLinecap="round" />
    <Path d="M13.8 19.2 19.9 8.6a1.05 1.05 0 0 1 1.45-.35l.55.32a1.05 1.05 0 0 1 .35 1.45L16.1 20.6l-2.45.55z" fill={color} />
    <Path d="M14.55 18.45 19.7 9.5" stroke="#FFFFFF" strokeWidth={1.1} strokeLinecap="round" strokeOpacity={0.55} />
  </Svg>;
}

/** A tool icon drawn like an app icon: a white tile holding a solid glyph in the tool's own colour. */
export function AppGlyph({ id, ios, android, size = 46, color, selected, loading = false, filled = true, style }: {
  /** Picks the tool's colour family. */
  id: string; ios: Icon['ios']; android: Icon['android']; size?: number;
  /** Overrides the family colour. */
  color?: string; selected?: boolean; loading?: boolean;
  /** Stateful icons (such as a bookmark outline) keep their outline form. */
  filled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const colors = usePalette();
  const ink = color ?? toolColors(id, colors).vivid;
  const art = Math.round(size * 0.58);
  return <GlyphTile size={size} selected={selected} style={style}>
    {loading ? <AppLoader color={ink} /> : id === 'edit_text'
      ? <EditPdfArt size={art} color={ink} />
      : <UniversalIcon ios={ios} android={android} filled={filled} size={Math.round(size * 0.56)} color={ink} />}
  </GlyphTile>;
}

/** Colour id for an icon without a tool id, so the same icon keeps the same colour everywhere. */
export function glyphKey(android: Icon['android']) {
  return android.replace(/^mdi:/, '').replace(/-(outline|outlined|border|variant)+$/g, '');
}

/** A compact app-icon tile for header and toolbar buttons; outline icons stay outlined so state stays readable. */
export function HeaderGlyph({ ios, android, size = 40, selected, loading = false }: { id?: string; ios: Icon['ios']; android: Icon['android']; size?: number; selected?: boolean; loading?: boolean }) {
  const colors = usePalette();
  // Controls share the theme ink so a row of them reads as one set; tool colours stay with the tools themselves.
  const ink = colors.systemBlue;
  return <GlyphTile size={size} selected={selected}>
    {loading ? <AppLoader color={ink} /> : <UniversalIcon ios={ios} android={android} size={Math.round(size * 0.6)} color={ink} />}
  </GlyphTile>;
}

/** Hand-drawn artwork for the dashboard's main areas, in the spirit of document-app icons. */
/** `color` draws the tools grid in one ink, for header controls. `iconStyle` animates only the mark, not the tile. */
export function BrandGlyph({ art, size = 48, loading = false, selected, color, iconStyle }: {
  art: BrandArt; size?: number; loading?: boolean; selected?: boolean; color?: string; iconStyle?: AnimatedStyle<ViewStyle>;
}) {
  const id = useId().replace(/:/g, '');
  const artSize = Math.round(size * (art === 'tools' ? 0.56 : 0.68));
  const mark = loading ? <AppLoader color={color} /> : <Svg width={artSize} height={artSize} viewBox="0 0 24 24">
    {art === 'pdf' && <>
      <Defs><LinearGradient id={`${id}p`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FF5A5F" /><Stop offset="1" stopColor="#D11F2B" /></LinearGradient></Defs>
      <Rect x="2" y="4" width="20" height="16" rx="4.2" fill={`url(#${id}p)`} />
      <SvgText x="12" y="14.9" fontSize="7.4" fontWeight="800" fill="#FFFFFF" textAnchor="middle" letterSpacing="0.2">PDF</SvgText>
    </>}
    {art === 'image' && <>
      <Defs><LinearGradient id={`${id}i`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#3DD68C" /><Stop offset="1" stopColor="#0E9455" /></LinearGradient></Defs>
      <Rect x="2.5" y="4" width="19" height="16" rx="4" fill={`url(#${id}i)`} />
      <Circle cx="8.6" cy="9.4" r="2" fill="#FFE27A" />
      <Path d="M4.6 18 9.9 12.2l3.4 3.6 2.4-2.5 3.7 4.7z" fill="#FFFFFF" fillOpacity={0.95} />
    </>}
    {art === 'files' && <>
      <Defs><LinearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFD84D" /><Stop offset="1" stopColor="#FFB800" /></LinearGradient></Defs>
      <Path d="M2.5 7.2a2 2 0 0 1 2-2h4.7l2.1 2.3h8.2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="#E59A00" />
      <Path d="M2.5 10.4a1.7 1.7 0 0 1 1.7-1.7h15.6a1.7 1.7 0 0 1 1.7 1.7V17a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill={`url(#${id}f)`} />
    </>}
    {art === 'privacy' && <>
      <Defs><LinearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#9B7BFF" /><Stop offset="1" stopColor="#5532D6" /></LinearGradient></Defs>
      <Path d="M12 2.6 19.6 5.5v5.7c0 4.7-3.2 8.6-7.6 10.2-4.4-1.6-7.6-5.5-7.6-10.2V5.5z" fill={`url(#${id}s)`} />
      <Path d="m8.5 12.2 2.4 2.4 4.7-4.9" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>}
    {art === 'tools' && <>
      <Rect x="3" y="3" width="8" height="8" rx="2.4" fill={color ?? '#FF5A5F'} />
      <Rect x="13" y="3" width="8" height="8" rx="2.4" fill={color ?? '#2F6BFF'} />
      <Rect x="3" y="13" width="8" height="8" rx="2.4" fill={color ?? '#16A463'} />
      <Rect x="13" y="13" width="8" height="8" rx="2.4" fill={color ?? '#FFB800'} />
    </>}
  </Svg>;
  return <GlyphTile size={size} selected={selected}>
    {iconStyle ? <Animated.View style={iconStyle}>{mark}</Animated.View> : mark}
  </GlyphTile>;
}

const styles = StyleSheet.create({
  tile: { borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
});

import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette, type Palette } from '@/theme/colors';
import { brandFont, catalog, getGradients, spacing as s, typography as t } from '@/theme/dashboard';

type Icon = React.ComponentProps<typeof UniversalIcon>;
const PROMISES: { label: string; ios: Icon['ios']; android: Icon['android'] }[] = [
  { label: 'Works offline', ios: 'wifi.slash', android: 'wifi-off' },
  { label: 'No uploads', ios: 'icloud.slash', android: 'cloud-off' },
  { label: 'Private', ios: 'lock', android: 'lock-outline' },
];
const SPARKLE = 'M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z';

/** A PDF page, a photo and a privacy badge in the module colours. */
function Illustration({ colors, size }: { colors: Palette; size: number }) {
  return <Svg width={size} height={size * 110 / 140} viewBox="0 0 140 110">
    <G rotation={-6} origin="49, 54">
      <Rect x={18} y={14} width={62} height={80} rx={9} fill={colors.pdfSurface} stroke={colors.pdfInk} strokeWidth={2} />
      {[28, 36, 44, 52].map((y, index) => <Rect key={y} x={27} y={y} width={index === 3 ? 26 : 42} height={4} rx={2} fill={colors.pdfInk} opacity={0.45} />)}
      <Rect x={27} y={70} width={30} height={14} rx={4} fill={colors.pdfInk} />
      <Path d="M33 77 h18" stroke={colors.pdfSurface} strokeWidth={2.5} strokeLinecap="round" />
    </G>
    <G rotation={8} origin="95, 55">
      <Rect x={66} y={26} width={58} height={58} rx={9} fill={colors.imageSurface} stroke={colors.imageInk} strokeWidth={2} />
      <Circle cx={109} cy={41} r={6} fill={colors.imageInk} opacity={0.75} />
      <Path d="M71 78 L88 55 L99 69 L107 60 L119 78 Z" fill={colors.imageInk} />
    </G>
    <Circle cx={30} cy={92} r={14} fill={colors.privacySurface} stroke={colors.privacyInk} strokeWidth={2} />
    <Path d="M24 92 l4 4 l8 -8" stroke={colors.privacyInk} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <G x={130} y={14}><Path d={SPARKLE} fill={colors.filesInk} /></G>
    <G x={8} y={38} scale={0.7}><Path d={SPARKLE} fill={colors.wordInk} /></G>
    <G x={132} y={96} scale={0.6}><Path d={SPARKLE} fill={colors.privacyInk} /></G>
  </Svg>;
}

/** The Home banner: what Versara does, with an illustration so the dashboard opens with some character. */
export function DashboardHero() {
  const colors = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const art = width < 360 || fontScale > 1.4 ? 0 : width < 420 ? 118 : 140;
  return <View accessible accessibilityLabel={`PDF and image tools on your phone. ${PROMISES.map(item => item.label).join(', ')}.`}
    style={[styles.hero, getGradients(colors).hero, { borderColor: colors.catalogBorder }]}>
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="xMaxYMin slice">
      <Circle cx={96} cy={4} r={34} fill={colors.systemBlue} opacity={0.05} />
      <Circle cx={100} cy={0} r={20} fill={colors.systemBlue} opacity={0.05} />
    </Svg>
    <View style={styles.top}>
      <View style={styles.grow}>
        <ThemedText style={[styles.headline, brandFont.display, { color: colors.label }]}>Edit PDFs and photos, right here</ThemedText>
        <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>Everything happens on this phone. Pick a tool to get started.</ThemedText>
      </View>
      {art > 0 && <Illustration colors={colors} size={art} />}
    </View>
    <View style={styles.promises}>
      {PROMISES.map(item => <View key={item.label} style={[styles.promise, { backgroundColor: colors.accentSurface }]}>
        <UniversalIcon ios={item.ios} android={item.android} size={14} color={colors.systemBlue} />
        <ThemedText style={[styles.promiseLabel, { color: colors.label }]}>{item.label}</ThemedText>
      </View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  hero: { borderRadius: catalog.cardRadius + 4, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, padding: s.lg, gap: s.md, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  grow: { flex: 1, minWidth: 0, gap: s.xs },
  headline: { fontSize: 21, lineHeight: 27 },
  caption: { ...t.caption },
  promises: { flexDirection: 'row', flexWrap: 'wrap', gap: s.xs },
  promise: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  promiseLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
});

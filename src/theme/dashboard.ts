import { Platform, type ViewStyle } from 'react-native';
import { type Palette } from './colors';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, section: 32, large: 48 } as const;
export const radius = { sm: 12, md: 18, lg: 24, pill: 999 } as const;
export const typography = {
  eyebrow: { fontSize: 10, lineHeight: 16, fontWeight: '700', letterSpacing: 1.4 },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
  body: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  moduleTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -0.3 },
  heading: { fontSize: 21, lineHeight: 28, fontWeight: '600', letterSpacing: -0.5 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -1.2 },
} as const;

// RN 0.86 uses the experimental name; react-native-web uses the CSS name.
function gradient(value: string): ViewStyle {
  return Platform.OS === 'web'
    ? ({ backgroundImage: value } as ViewStyle)
    : { experimental_backgroundImage: value };
}
export const getGradients = (colors: Palette) => ({
  page: gradient(`linear-gradient(160deg, ${colors.heroEnd} 0%, ${colors.systemBackground} 48%)`),
  hero: gradient(`linear-gradient(115deg, ${colors.heroStart} 0%, ${colors.heroEnd} 100%)`),
  card: gradient(`linear-gradient(135deg, ${colors.cardStart} 0%, ${colors.secondarySystemBackground} 60%, ${colors.cardEnd} 100%)`),
  module: gradient(`linear-gradient(135deg, ${colors.moduleStart} 0%, ${colors.moduleMiddle} 48%, ${colors.moduleEnd} 100%)`),
  tabIdle: gradient(`linear-gradient(145deg, ${colors.tabIdleStart} 0%, ${colors.tabIdleEnd} 100%)`),
  icon: gradient(`linear-gradient(145deg, ${colors.iconStart} 0%, ${colors.iconEnd} 100%)`),
  navigation: gradient(`linear-gradient(115deg, ${colors.navStart} 0%, ${colors.navEnd} 100%)`),
  tabSelected: gradient(`linear-gradient(135deg, ${colors.navActiveStart} 0%, ${colors.navActiveEnd} 100%)`),
});

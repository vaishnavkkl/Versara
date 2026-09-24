import 'expo-sqlite/localStorage/install';
import { create } from 'zustand';

export const palettes = {
  dark: {
    label: '#FFFFFF', secondaryLabel: '#A1A1A6', separator: '#262626',
    systemBackground: '#000000', secondarySystemBackground: '#111111',
    systemBlue: '#FFFFFF', accent: '#2C2C2E', accentSurface: '#1C1C1E',
    cyan: '#D1D1D6', muted: '#8E8E93', onAccent: '#FFFFFF',
    heroStart: '#161616', heroEnd: '#0A0A0A', borderHighlight: '#2C2C2E',
    navBackground: '#000000', navBorder: '#1F1F1F', navIcon: '#FFFFFF',
    navSelected: '#FFFFFF', navSelectedIcon: '#000000', navShadow: '0 -1px 0 rgba(255, 255, 255, 0.08)',
    navStart: '#0A0A0A', navEnd: '#000000', navActiveStart: '#FFFFFF', navActiveEnd: '#EDEDED',
    tabIdleStart: '#1C1C1E', tabIdleEnd: '#111111', tabIdleBorder: '#2C2C2E',
    tabActiveBorder: '#FFFFFF', tabActiveShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
    cardStart: '#161616', cardEnd: '#0B0B0B', iconStart: '#3A3A3C', iconEnd: '#2C2C2E',
    iconBorder: '#48484A', cardShadow: '0 6px 16px rgba(0, 0, 0, 0.35)',
    moduleStart: '#1F1F1F', moduleMiddle: '#161616', moduleEnd: '#0D0D0D',
    moduleBorder: '#2C2C2E', moduleHighlight: '#3A3A3C', moduleText: '#FFFFFF', moduleDescription: '#A1A1A6',
    moduleIconSurface: '#FFFFFF12', moduleIconBorder: '#FFFFFF26', moduleShadow: '0 6px 16px rgba(0, 0, 0, 0.35)',
    tileSurface: '#101010', tileBorder: '#1F1F1F', tileShadow: '0 1px 2px rgba(0, 0, 0, 0.4)', tileTint: '2E',
  },
  light: {
    label: '#101643', secondaryLabel: '#555D83', separator: '#DADFF4',
    systemBackground: '#F4F5FD', secondarySystemBackground: '#FFFFFF',
    systemBlue: '#1A1953', accent: '#1A1953', accentSurface: '#E6E5F4',
    cyan: '#345F9B', muted: '#717998', onAccent: '#FFFFFF',
    heroStart: '#E0E5FF', heroEnd: '#EEF0FC', borderHighlight: '#B3BDED',
    navBackground: '#1A1953', navBorder: '#353391', navIcon: '#FFFFFF',
    navSelected: '#FFFFFF', navSelectedIcon: '#1A1953', navShadow: '0 -6px 20px rgba(26, 25, 83, 0.24)',
    navStart: '#2A2878', navEnd: '#0E0D33', navActiveStart: '#FFFFFF', navActiveEnd: '#E7E6FA',
    tabIdleStart: '#59649D', tabIdleEnd: '#374479', tabIdleBorder: '#7684B4',
    tabActiveBorder: '#6978D6', tabActiveShadow: '0 4px 12px rgba(40, 48, 140, 0.20)',
    cardStart: '#E1E7FF', cardEnd: '#FFFFFF', iconStart: '#2D2B80', iconEnd: '#1A1953',
    iconBorder: '#7774CC', cardShadow: '0 6px 16px rgba(24, 32, 94, 0.06)',
    moduleStart: '#2B2980', moduleMiddle: '#1A1953', moduleEnd: '#100F38',
    moduleBorder: '#353391', moduleHighlight: '#5E5BC2', moduleText: '#FFFFFF', moduleDescription: '#D0D9F1',
    moduleIconSurface: '#FFFFFF14', moduleIconBorder: '#FFFFFF2E', moduleShadow: '0 6px 16px rgba(18, 34, 82, 0.14)',
    tileSurface: '#FFFFFF', tileBorder: '#E8EAF3', tileShadow: '0 6px 18px rgba(26, 25, 83, 0.08)', tileTint: '24',
  },
} as const;
export type Palette = { [Key in keyof typeof palettes.dark]: string };
export type ThemeMode = keyof typeof palettes;
const THEME_STORAGE_KEY = 'versara.appearance.mode';
type AppearanceState = {
  mode: ThemeMode;
  hydrated: boolean;
  hydrate: () => void;
  setMode: (mode: ThemeMode) => void;
};
export const useAppearance = create<AppearanceState>((set, get) => ({
  mode: 'dark',
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    let mode: ThemeMode = 'dark';
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') mode = stored;
    } catch (error) {
      console.warn('Could not restore appearance preference.', error);
    }
    set({ mode, hydrated: true });
  },
  setMode: mode => {
    set({ mode });
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (error) {
      console.warn('Could not save appearance preference.', error);
    }
  },
}));
export function usePalette(): Palette {
  return palettes[useAppearance(state => state.mode)];
}
// Static fallback for legacy non-interactive assets. Screens use usePalette().
export const colors = palettes.dark;

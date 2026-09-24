import 'expo-sqlite/localStorage/install';
import { create } from 'zustand';

export const palettes = {
  dark: {
    label: '#F3F4FF', secondaryLabel: '#B2B8DE', separator: '#292F68',
    systemBackground: '#000000', secondarySystemBackground: '#101647',
    systemBlue: '#ADB8FF', accent: '#353EC0', accentSurface: '#20275E',
    cyan: '#9ABEFF', muted: '#8991BF', onAccent: '#FFFFFF',
    heroStart: '#181F87', heroEnd: '#0C1148', borderHighlight: '#414C9E',
    navBackground: '#0C1045', navBorder: '#303778', navIcon: '#FFFFFF',
    navSelected: '#3844CA', navSelectedIcon: '#FFFFFF', navShadow: '0 6px 20px rgba(2, 3, 24, 0.32)',
    navStart: '#192174', navEnd: '#0A0E36', navActiveStart: '#515CE2', navActiveEnd: '#26319B',
    tabIdleStart: '#2A337E', tabIdleEnd: '#181F59', tabIdleBorder: '#414B8E',
    tabActiveBorder: '#8A99F0', tabActiveShadow: '0 4px 12px rgba(35, 45, 160, 0.28)',
    cardStart: '#1B2479', cardEnd: '#0D1241', iconStart: '#4B56D6', iconEnd: '#252E92',
    iconBorder: '#7F8AE8', cardShadow: '0 6px 16px rgba(2, 3, 24, 0.20)',
    moduleStart: '#203582', moduleMiddle: '#14235F', moduleEnd: '#0B123D',
    moduleBorder: '#2D4080', moduleHighlight: '#4B61A6', moduleText: '#FFFFFF', moduleDescription: '#C0CCE9',
    moduleIconSurface: '#FFFFFF12', moduleIconBorder: '#FFFFFF26', moduleShadow: '0 6px 16px rgba(2, 5, 28, 0.20)',
  },
  light: {
    label: '#101643', secondaryLabel: '#555D83', separator: '#DADFF4',
    systemBackground: '#F4F5FD', secondarySystemBackground: '#FFFFFF',
    systemBlue: '#2D3798', accent: '#303AA5', accentSurface: '#E8EBFC',
    cyan: '#345F9B', muted: '#717998', onAccent: '#FFFFFF',
    heroStart: '#E0E5FF', heroEnd: '#EEF0FC', borderHighlight: '#B3BDED',
    navBackground: '#11174E', navBorder: '#353E83', navIcon: '#FFFFFF',
    navSelected: '#4553CF', navSelectedIcon: '#FFFFFF', navShadow: '0 6px 20px rgba(15, 20, 65, 0.20)',
    navStart: '#202A7B', navEnd: '#0C1040', navActiveStart: '#6571ED', navActiveEnd: '#3844B2',
    tabIdleStart: '#59649D', tabIdleEnd: '#374479', tabIdleBorder: '#7684B4',
    tabActiveBorder: '#6978D6', tabActiveShadow: '0 4px 12px rgba(40, 48, 140, 0.20)',
    cardStart: '#E2E7FF', cardEnd: '#FFFFFF', iconStart: '#4B58C8', iconEnd: '#28338B',
    iconBorder: '#8592E3', cardShadow: '0 6px 16px rgba(24, 32, 94, 0.06)',
    moduleStart: '#2A448F', moduleMiddle: '#1B306F', moduleEnd: '#111D4D',
    moduleBorder: '#394F8E', moduleHighlight: '#687FBA', moduleText: '#FFFFFF', moduleDescription: '#D0D9F1',
    moduleIconSurface: '#FFFFFF14', moduleIconBorder: '#FFFFFF2E', moduleShadow: '0 6px 16px rgba(18, 34, 82, 0.14)',
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

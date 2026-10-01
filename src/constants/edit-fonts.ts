import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as Font from 'expo-font';

export type FontStyleName = 'Regular' | 'Bold' | 'Italic' | 'BoldItalic';
export type EditFontFamily = {
  id: string; label: string; category: 'Standard' | 'Sans serif' | 'Serif' | 'Monospace' | 'Display' | 'Script';
  /** File prefix of a bundled OFL font; standard PDF fonts have none. */
  prefix?: string; styles: FontStyleName[]; preview?: string;
};

const ALL: FontStyleName[] = ['Regular', 'Bold', 'Italic', 'BoldItalic'];
const ONLY: FontStyleName[] = ['Regular'];

/** Standard PDF fonts first (every reader has them), then bundled SIL Open Font License families. */
export const EDIT_FONTS: EditFontFamily[] = [
  { id: 'sans', label: 'Arial / Helvetica', category: 'Standard', styles: ALL, preview: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }) },
  { id: 'serif', label: 'Times New Roman', category: 'Standard', styles: ALL, preview: Platform.select({ ios: 'Times New Roman', default: 'serif' }) },
  { id: 'mono', label: 'Courier New', category: 'Standard', styles: ALL, preview: Platform.select({ ios: 'Courier New', default: 'monospace' }) },
  { id: 'carlito', label: 'Calibri style (Carlito)', category: 'Sans serif', prefix: 'Carlito', styles: ALL },
  { id: 'poppins', label: 'Poppins', category: 'Sans serif', prefix: 'Poppins', styles: ALL },
  { id: 'archivoblack', label: 'Archivo Black', category: 'Sans serif', prefix: 'ArchivoBlack', styles: ONLY },
  { id: 'caladea', label: 'Cambria style (Caladea)', category: 'Serif', prefix: 'Caladea', styles: ALL },
  { id: 'crimson', label: 'Crimson Text', category: 'Serif', prefix: 'CrimsonText', styles: ALL },
  { id: 'zillaslab', label: 'Zilla Slab', category: 'Serif', prefix: 'ZillaSlab', styles: ALL },
  { id: 'courierprime', label: 'Courier Prime', category: 'Monospace', prefix: 'CourierPrime', styles: ALL },
  { id: 'anton', label: 'Anton', category: 'Display', prefix: 'Anton', styles: ONLY },
  { id: 'bebas', label: 'Bebas Neue', category: 'Display', prefix: 'BebasNeue', styles: ONLY },
  { id: 'abril', label: 'Abril Fatface', category: 'Display', prefix: 'AbrilFatface', styles: ONLY },
  { id: 'lobster', label: 'Lobster', category: 'Script', prefix: 'Lobster', styles: ONLY },
  { id: 'pacifico', label: 'Pacifico', category: 'Script', prefix: 'Pacifico', styles: ONLY },
  { id: 'greatvibes', label: 'Great Vibes', category: 'Script', prefix: 'GreatVibes', styles: ONLY },
  { id: 'patrickhand', label: 'Patrick Hand', category: 'Script', prefix: 'PatrickHand', styles: ONLY },
];

const FILES: Record<string, number> = {
  'Carlito-Regular': require('@/assets/fonts/edit/Carlito-Regular.ttf'),
  'Carlito-Bold': require('@/assets/fonts/edit/Carlito-Bold.ttf'),
  'Carlito-Italic': require('@/assets/fonts/edit/Carlito-Italic.ttf'),
  'Carlito-BoldItalic': require('@/assets/fonts/edit/Carlito-BoldItalic.ttf'),
  'Poppins-Regular': require('@/assets/fonts/edit/Poppins-Regular.ttf'),
  'Poppins-Bold': require('@/assets/fonts/edit/Poppins-Bold.ttf'),
  'Poppins-Italic': require('@/assets/fonts/edit/Poppins-Italic.ttf'),
  'Poppins-BoldItalic': require('@/assets/fonts/edit/Poppins-BoldItalic.ttf'),
  'ArchivoBlack-Regular': require('@/assets/fonts/edit/ArchivoBlack-Regular.ttf'),
  'Caladea-Regular': require('@/assets/fonts/edit/Caladea-Regular.ttf'),
  'Caladea-Bold': require('@/assets/fonts/edit/Caladea-Bold.ttf'),
  'Caladea-Italic': require('@/assets/fonts/edit/Caladea-Italic.ttf'),
  'Caladea-BoldItalic': require('@/assets/fonts/edit/Caladea-BoldItalic.ttf'),
  'CrimsonText-Regular': require('@/assets/fonts/edit/CrimsonText-Regular.ttf'),
  'CrimsonText-Bold': require('@/assets/fonts/edit/CrimsonText-Bold.ttf'),
  'CrimsonText-Italic': require('@/assets/fonts/edit/CrimsonText-Italic.ttf'),
  'CrimsonText-BoldItalic': require('@/assets/fonts/edit/CrimsonText-BoldItalic.ttf'),
  'ZillaSlab-Regular': require('@/assets/fonts/edit/ZillaSlab-Regular.ttf'),
  'ZillaSlab-Bold': require('@/assets/fonts/edit/ZillaSlab-Bold.ttf'),
  'ZillaSlab-Italic': require('@/assets/fonts/edit/ZillaSlab-Italic.ttf'),
  'ZillaSlab-BoldItalic': require('@/assets/fonts/edit/ZillaSlab-BoldItalic.ttf'),
  'CourierPrime-Regular': require('@/assets/fonts/edit/CourierPrime-Regular.ttf'),
  'CourierPrime-Bold': require('@/assets/fonts/edit/CourierPrime-Bold.ttf'),
  'CourierPrime-Italic': require('@/assets/fonts/edit/CourierPrime-Italic.ttf'),
  'CourierPrime-BoldItalic': require('@/assets/fonts/edit/CourierPrime-BoldItalic.ttf'),
  'Anton-Regular': require('@/assets/fonts/edit/Anton-Regular.ttf'),
  'BebasNeue-Regular': require('@/assets/fonts/edit/BebasNeue-Regular.ttf'),
  'AbrilFatface-Regular': require('@/assets/fonts/edit/AbrilFatface-Regular.ttf'),
  'Lobster-Regular': require('@/assets/fonts/edit/Lobster-Regular.ttf'),
  'Pacifico-Regular': require('@/assets/fonts/edit/Pacifico-Regular.ttf'),
  'GreatVibes-Regular': require('@/assets/fonts/edit/GreatVibes-Regular.ttf'),
  'PatrickHand-Regular': require('@/assets/fonts/edit/PatrickHand-Regular.ttf'),
};

const paths = new Map<string, string>();
let loading: Promise<void> | null = null;

/** Copies bundled fonts to local files once per launch and registers them for on-screen previews. */
export function loadEditFonts() {
  loading ??= (async () => {
    await Promise.all(Object.entries(FILES).map(async ([name, module]) => {
      const asset = await Asset.fromModule(module).downloadAsync();
      if (asset.localUri) paths.set(name, asset.localUri);
    }));
    await Font.loadAsync(FILES).catch(() => {});
  })().catch(cause => { loading = null; throw cause; });
  return loading;
}

/** Local file for a bundled font name such as `Poppins-Bold`; undefined for standard PDF fonts. */
export const fontFile = (font: string | undefined) => font ? paths.get(font) : undefined;

/** Adds `fontFile` to items whose font is bundled, for native drawing and PDF embedding. Drafts keep only the name. */
export function withFontFiles<T extends { font?: string }>(items: T[]): (T & { fontFile?: string })[] {
  return items.map(item => { const file = fontFile(item.font); return file ? { ...item, fontFile: file } : item; });
}

/** Every bundled font name and file, for native style matching. */
export const fontCatalog = () => Object.fromEntries(paths);

export function useEditFonts() {
  const [ready, setReady] = useState(paths.size === Object.keys(FILES).length);
  useEffect(() => {
    let live = true;
    if (!ready) void loadEditFonts().then(() => { if (live) setReady(true); }).catch(() => {});
    return () => { live = false; };
  }, [ready]);
  return ready;
}

export const familyById = (id: string) => EDIT_FONTS.find(item => item.id === id);
export const familyOfFont = (font: string) => EDIT_FONTS.find(item => item.prefix && font.startsWith(item.prefix + '-'));

import 'expo-sqlite/localStorage/install';
import { create } from 'zustand';

export type PageScroll = 'continuous' | 'page';
export type PageLayout = 'single' | 'double';
export type ReadingDirection = 'ltr' | 'rtl';
export type ReadingPreferences = { scroll: PageScroll; layout: PageLayout; direction: ReadingDirection };

const KEY = 'versara.pdf.reading';
const DEFAULTS: ReadingPreferences = { scroll: 'continuous', layout: 'single', direction: 'ltr' };

function stored(): ReadingPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ReadingPreferences> | null;
    return {
      scroll: value?.scroll === 'page' ? 'page' : 'continuous',
      layout: value?.layout === 'double' ? 'double' : 'single',
      direction: value?.direction === 'rtl' ? 'rtl' : 'ltr',
    };
  } catch { return DEFAULTS; }
}

/** How PDFs are shown in the reader, chosen from its Reading options and kept across launches. */
export const useReadingPreferences = create<ReadingPreferences & { set: (change: Partial<ReadingPreferences>) => void }>((set, get) => ({
  ...stored(),
  set: change => {
    set(change);
    const { scroll, layout, direction } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ scroll, layout, direction })); } catch { /* Keep this session usable. */ }
  },
}));

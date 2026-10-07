import 'expo-sqlite/localStorage/install';
import { create } from 'zustand';

type Kind = 'pdf' | 'image';
/** `file` marks the whole file; `pages` are bookmarked PDF pages (0-based). */
export type Bookmark = { name: string; kind: Kind; file: boolean; pages: number[]; added: number };
type Bookmarks = Record<string, Bookmark>;

const KEY = 'versara.bookmarks.v2';
const LIMIT = 300;
const PAGE_LIMIT = 500;

// Device files are copied into Versara under new paths when opened, so a bookmark follows the file's type and name,
// the same identity Recents uses to merge device and library entries.
export const bookmarkKey = (kind: string, name: string) => `${kind}:${name.trim().toLowerCase()}`;

function stored(): Bookmarks {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Bookmarks;
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

function persist(items: Bookmarks) {
  const entries = Object.entries(items);
  const kept = entries.length > LIMIT ? Object.fromEntries(entries.sort((a, b) => b[1].added - a[1].added).slice(0, LIMIT)) : items;
  try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* Keep this session usable. */ }
  return kept;
}

/** Bookmarked files and PDF pages, kept on this device. */
export const useBookmarks = create<{ items: Bookmarks }>(() => ({ items: stored() }));

function update(key: string, change: (entry: Bookmark | undefined) => Bookmark | undefined) {
  useBookmarks.setState(state => {
    const items = { ...state.items };
    const next = change(items[key]);
    if (next && (next.file || next.pages.length)) items[key] = next;
    else delete items[key];
    return { items: persist(items) };
  });
}

/** Whether the file appears under Bookmarked: bookmarked itself, or a PDF with bookmarked pages. */
export function isFileBookmarked(items: Bookmarks, file: { kind: string; name: string }) {
  const entry = items[bookmarkKey(file.kind, file.name)];
  return !!entry && (entry.file || entry.pages.length > 0);
}

export function useFileBookmarked(file: { kind: string; name: string } | null | undefined) {
  return useBookmarks(state => !!file && isFileBookmarked(state.items, file));
}

export function bookmarkedPageCount(file: { kind: string; name: string }) {
  return useBookmarks.getState().items[bookmarkKey(file.kind, file.name)]?.pages.length ?? 0;
}

/** Bookmarks the whole file, or removes every bookmark on it. Returns whether it is now bookmarked. */
export function toggleFileBookmark(file: { kind: string; name: string }) {
  if (file.kind !== 'pdf' && file.kind !== 'image') return false;
  const kind = file.kind;
  const on = !isFileBookmarked(useBookmarks.getState().items, file);
  update(bookmarkKey(kind, file.name), entry => on ? { name: file.name, kind, file: true, pages: entry?.pages ?? [], added: Date.now() } : undefined);
  return on;
}

/** Adds or removes a bookmark on a PDF page (0-based); returns whether that page is now bookmarked. */
export function togglePageBookmark(file: { name: string }, page: number) {
  const key = bookmarkKey('pdf', file.name);
  const pages = useBookmarks.getState().items[key]?.pages ?? [];
  const on = !pages.includes(page);
  update(key, entry => ({
    name: file.name, kind: 'pdf', file: entry?.file ?? false, added: Date.now(),
    pages: on ? [...pages, page].sort((a, b) => a - b).slice(0, PAGE_LIMIT) : pages.filter(item => item !== page),
  }));
  return on;
}

const NO_PAGES: number[] = [];
export function usePageBookmarks(name: string | undefined) {
  return useBookmarks(state => (name ? state.items[bookmarkKey('pdf', name)]?.pages : undefined) ?? NO_PAGES);
}

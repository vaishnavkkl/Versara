import 'expo-sqlite/localStorage/install';
import { Paths } from 'expo-file-system';
import { notifyLibraryChanged } from './library-revision';

const KEY = 'versara.protected.pdfs';
const MAX = 200;
let cache: Set<string> | null = null;

const documentRoot = () => Paths.document.uri.replace(/\/+$/, '') + '/';

/** Absolute file URI and the durable `document://` form used in the library DB. */
function keys(uri: string) {
  if (!uri) return [] as string[];
  const root = documentRoot();
  const absolute = uri.startsWith('document://') ? root + uri.slice('document://'.length) : uri;
  const stored = absolute.startsWith(root) ? 'document://' + absolute.slice(root.length) : absolute;
  return absolute === stored ? [absolute] : [absolute, stored];
}

function load() {
  if (cache) return cache;
  cache = new Set<string>();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw) as unknown;
      if (Array.isArray(list)) for (const uri of list) if (typeof uri === 'string' && uri) cache.add(uri);
    }
  } catch { /* Keep an empty set; listing still works without badges. */ }
  return cache;
}

function persist() {
  if (!cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...cache].slice(-MAX)));
  } catch { /* Storage full; badges are best-effort. */ }
}

/** Remember a PDF Versara password-protected so lists can show a lock badge. */
export function markProtectedPdf(...uris: string[]) {
  const set = load();
  let changed = false;
  const notified: string[] = [];
  for (const uri of uris) {
    if (!uri) continue;
    for (const key of keys(uri)) {
      if (!key || set.has(key)) continue;
      set.add(key);
      changed = true;
    }
    notified.push(uri);
  }
  if (changed) {
    persist();
    notifyLibraryChanged(notified);
  }
}

/** True when Versara saved this URI with a password (or an earlier protect / unlock marked it). */
export function isProtectedPdf(uri: string) {
  if (!uri) return false;
  const set = load();
  return keys(uri).some(key => set.has(key));
}

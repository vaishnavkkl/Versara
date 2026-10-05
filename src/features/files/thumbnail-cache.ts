import { Directory, File, Paths } from 'expo-file-system';
import { PdfEngine } from '../../../modules/pdf-engine';
import type { FileKind } from './recent-files';

type Entry = { key: string; source: string; kind: FileKind; page: number; id: string; uri: string | null; users: number; done: boolean; started: boolean; cancelled: boolean; promise: Promise<string | null>; resolve: (uri: string | null) => void };
const entries = new Map<string, Entry>();
// Replaced cache entries can still be displayed until their last viewer leaves.
const retired = new Set<Entry>();
const waiting: Entry[] = [];
let running = false;
let prepared = false;
const directory = () => new Directory(Paths.cache, 'versara-thumbnails');
function remove(uri: string | null) { if (uri) try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Cache eviction retries later. */ } }
function evict() {
  for (const [key, entry] of entries) {
    if (entries.size < 80) break;
    if (entry.done && entry.users === 0) { entries.delete(key); remove(entry.uri); }
  }
}

/** Only unused thumbnail files are disposable; editor inputs and active jobs are excluded. */
function unusedThumbnailFiles() {
  const root = directory();
  if (!root.exists) return [];
  const protectedUris = new Set([...entries.values(), ...retired].filter(entry => entry.users > 0 || !entry.done)
    .map(entry => entry.uri ?? new File(root, `${entry.id}.jpg`).uri));
  return root.list().filter((file): file is File => file instanceof File && !protectedUris.has(file.uri));
}
export function unusedThumbnailBytes() {
  return unusedThumbnailFiles().reduce((total, file) => total + (file.size ?? 0), 0);
}
export function clearUnusedThumbnails() {
  let freed = 0;
  for (const file of unusedThumbnailFiles()) {
    const size = file.size ?? 0;
    file.delete();
    freed += size;
    for (const [key, entry] of entries) if (entry.done && !entry.users && entry.uri === file.uri) entries.delete(key);
  }
  return freed;
}
async function drain() {
  if (running) return;
  running = true;
  try {
    while (waiting.length) {
      const entry = waiting.shift()!;
      if (!entry.users) { if (entries.get(entry.key) === entry) entries.delete(entry.key); entry.done = true; entry.resolve(null); continue; }
      entry.started = true;
      let uri: string | null = null;
      try {
        if (!prepared) {
          const root = directory(); root.create({ intermediates: true, idempotent: true });
          // Files from previous app runs are disposable. Keep at most 256 old thumbnails.
          const old = root.list().filter(item => item instanceof File).sort((a, b) => b.name.localeCompare(a.name));
          old.forEach((file, index) => { if (index >= 256 || Date.now() - Number(file.name.split('-')[0]) > 86400000) remove(file.uri); });
          prepared = true;
        }
        uri = new File(directory(), `${entry.id}.jpg`).uri;
        if (!PdfEngine?.renderFileThumbnail) throw new Error('Thumbnail module unavailable');
        await PdfEngine.renderFileThumbnail(entry.id, entry.source, entry.kind, entry.page, uri);
        if (!entry.users) { remove(uri); uri = null; }
      } catch { remove(uri); uri = null; }
      entry.uri = uri; entry.done = true; entry.resolve(uri);
      if (!entry.users) retired.delete(entry);
      if (!entry.users && !uri && entries.get(entry.key) === entry) entries.delete(entry.key);
      evict();
    }
  } finally { running = false; }
}
/** Detach cached and pending thumbnails so a replacement cannot reuse an old render. */
export function invalidateThumbnails(source: string) {
  for (const [key, entry] of entries) {
    if (entry.source !== source) continue;
    entries.delete(key);
    if (!entry.users) remove(entry.uri);
    else retired.add(entry);
  }
}
export function requestThumbnail(source: string, kind: FileKind, page = 0, revision = '') {
  const key = `${source}|${kind}|${page}|${revision}`;
  let entry = entries.get(key);
  if (entry?.cancelled) { entries.delete(key); entry = undefined; }
  if (entry?.done && (!entry.uri || !new File(entry.uri).exists)) { entries.delete(key); entry = undefined; }
  if (!entry) {
    evict();
    if (entries.size >= 128) return { promise: Promise.resolve(null), release() {} };
    let resolve!: Entry['resolve'];
    const promise = new Promise<string | null>(done => { resolve = done; });
    entry = { key, source, kind, page, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, uri: null, users: 0, done: false, started: false, cancelled: false, promise, resolve };
    entries.set(key, entry); waiting.push(entry);
  } else { entries.delete(key); entries.set(key, entry); }
  entry.users++;
  void drain();
  const value = entry;
  let released = false;
  return { promise: value.promise, release() {
    if (released) return;
    released = true; value.users--;
    // Invalidation can detach an entry while a mounted thumbnail still owns it.
    // Dispose that old file when its last owner releases it, too.
    if (!value.users && value.done && entries.get(key) !== value) {
      retired.delete(value);
      remove(value.uri);
    }
    if (!value.users && !value.done) {
      value.cancelled = true;
      if (value.started) PdfEngine?.cancelThumbnail?.(value.id);
      else {
        const index = waiting.indexOf(value); if (index >= 0) waiting.splice(index, 1);
        if (entries.get(key) === value) entries.delete(key);
        value.done = true; value.resolve(null);
        retired.delete(value);
      }
    }
    evict();
  } };
}

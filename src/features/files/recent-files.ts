import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { FileEngine, type DeviceRecentFile } from '../../../modules/file-engine';
import { retainPickerCopy } from '../pdf/pdf-cache';

export type FileKind = 'pdf' | 'image' | 'video' | 'audio';
export type RecentFile = { id: string; uri: string; name: string; kind: FileKind; mimeType: string; size: number; opened: number };
export type LibraryItem = RecentFile & { source: 'library' };
export type DeviceItem = DeviceRecentFile & { kind: FileKind; opened: number };
export type RecentListItem = LibraryItem | DeviceItem;
/** Libraries show only the most recent items; older files stay reachable through Open and search. */
export const RECENT_LIMIT = 30;
export const FILE_LABELS = { pdf: 'PDF', image: 'Image', video: 'Video', audio: 'Audio' } as const;
const mimeTypes = { pdf: 'application/pdf', image: 'image/*', video: 'video/*', audio: 'audio/*' };
const library = () => new Directory(Paths.document, 'Versara Library');
const documentRoot = () => Paths.document.uri.replace(/\/+$/, '') + '/';
// iOS may change its sandbox prefix after an app update. Persist relative paths.
const storedUri = (uri: string) => uri.startsWith(documentRoot()) ? 'document://' + uri.slice(documentRoot().length) : uri;
const restored = (file: RecentFile): RecentFile => ({ ...file, uri: file.uri.startsWith('document://') ? documentRoot() + file.uri.slice('document://'.length) : file.uri });
let database: Promise<SQLiteDatabase> | undefined;
function db() {
  if (!database) database = (async () => {
    const value = await openDatabaseAsync('versara-library.db');
    try {
      await value.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS recent_files (id TEXT PRIMARY KEY, uri TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, mimeType TEXT NOT NULL, size INTEGER NOT NULL, opened INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS recent_kind_opened ON recent_files(kind, opened DESC);');
      return value;
    } catch (error) { await value.closeAsync(); throw error; }
  })().catch(error => { database = undefined; throw error; });
  return database;
}

export const libraryDatabase = db;
export { storedUri, documentRoot };

export async function listRecentFiles(kind: FileKind, search = '') {
  const database = await db();
  return (await database.getAllAsync<RecentFile>(`SELECT * FROM recent_files WHERE kind = ? AND instr(lower(name), lower(?)) > 0 ORDER BY opened DESC LIMIT ${RECENT_LIMIT}`, kind, search.trim())).map(restored);
}

/** Library imports plus bounded native device recents (MediaStore / Photos). Metadata only. */
export async function listCategoryFiles(kind: FileKind, search = ''): Promise<RecentListItem[]> {
  const libraryFiles = (await listRecentFiles(kind, search)).map(file => ({ ...file, source: 'library' as const }));
  let device: DeviceItem[] = [];
  if (FileEngine?.listDeviceRecents && !(kind === 'pdf' && FileEngine.nativePdfLibraryVersion)) {
    try {
      const items = await FileEngine.listDeviceRecents(kind, RECENT_LIMIT, search.trim());
      const libraryNames = new Set(libraryFiles.map(file => file.name.toLowerCase()));
      device = items
        .filter(item => !libraryNames.has(item.name.toLowerCase()))
        .map(item => ({ ...item, kind, opened: item.modified }));
    } catch { /* Keep library results if device listing is unavailable. */ }
  }
  return [...libraryFiles, ...device].sort((a, b) => b.opened - a.opened).slice(0, RECENT_LIMIT);
}

export async function getRecentFile(id: string) { const file = await (await db()).getFirstAsync<RecentFile>('SELECT * FROM recent_files WHERE id = ?', id); return file ? restored(file) : null; }
export async function touchRecentFile(id: string) { await (await db()).runAsync('UPDATE recent_files SET opened = ? WHERE id = ?', Date.now(), id); }
export async function forgetRecentUri(uri: string) { await (await db()).runAsync('DELETE FROM recent_files WHERE uri = ?', storedUri(uri)); }

/** Save tool outputs to the library without keeping document contents in JS. */
export async function rememberPdfResults(files: { uri: string; name: string; size: number }[]) {
  const database = await db();
  await database.withExclusiveTransactionAsync(async transaction => {
    for (const file of files) {
      const opened = Date.now();
      await transaction.runAsync('INSERT INTO recent_files(id,uri,name,kind,mimeType,size,opened) VALUES (?,?,?,?,?,?,?) ON CONFLICT(uri) DO UPDATE SET opened=excluded.opened', `${opened}-${Math.random().toString(36).slice(2)}`, storedUri(file.uri), file.name, 'pdf', 'application/pdf', file.size, opened);
    }
  });
}

export async function rememberFile(file: { uri: string; name: string; mimeType?: string; size?: number }, kind: FileKind): Promise<RecentFile> {
  // Recents must outlive tool caches. Only durable app-owned paths are indexed.
  if (!file.uri.startsWith(documentRoot())) throw new Error('This file must be imported before it can be kept in Recents.');
  const database = await db();
  const existing = await database.getFirstAsync<RecentFile>('SELECT * FROM recent_files WHERE uri = ?', storedUri(file.uri));
  const value: RecentFile = { id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, uri: file.uri, name: file.name, kind, mimeType: file.mimeType ?? mimeTypes[kind], size: file.size ?? new File(file.uri).size, opened: Date.now() };
  await database.runAsync('INSERT INTO recent_files(id,uri,name,kind,mimeType,size,opened) VALUES (?,?,?,?,?,?,?) ON CONFLICT(uri) DO UPDATE SET name=excluded.name, size=excluded.size, opened=excluded.opened', value.id, storedUri(value.uri), value.name, value.kind, value.mimeType, value.size, value.opened);
  return value;
}

export async function importRecentFile(kind: FileKind): Promise<RecentFile | null> {
  const { getDocumentAsync } = await import('expo-document-picker');
  const selection = await getDocumentAsync({ type: mimeTypes[kind], multiple: false, copyToCacheDirectory: true });
  if (selection.canceled) return null;
  const asset = selection.assets[0];
  const root = library();
  const extension = asset.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? (kind === 'pdf' ? '.pdf' : '');
  const copy = new File(root, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
  try {
    root.create({ intermediates: true, idempotent: true });
    const expected = kind === 'pdf' ? asset.mimeType === 'application/pdf' || /\.pdf$/i.test(asset.name) : asset.mimeType?.startsWith(kind + '/');
    if (asset.mimeType && asset.mimeType !== 'application/octet-stream' && !expected) throw new Error(`Choose a ${FILE_LABELS[kind].toLowerCase()} file.`);
    await retainPickerCopy(asset.uri, copy);
    return await rememberFile({ uri: copy.uri, name: asset.name, mimeType: asset.mimeType, size: copy.size }, kind);
  } catch (error) { if (copy.exists) copy.delete(); throw error; }
  finally {
    const pickerRoot = new Directory(Paths.cache, 'DocumentPicker').uri.replace(/\/+$/, '') + '/';
    if (asset.uri.startsWith(pickerRoot)) try { const temporary = new File(asset.uri); if (temporary.exists) temporary.delete(); } catch { /* OS cache cleanup. */ }
  }
}

/** Copy a MediaStore/Photos URI into Versara Library on a native worker, then index it. */
export async function importDeviceRecent(item: DeviceItem): Promise<RecentFile> {
  if (!FileEngine?.importDeviceFile) throw new Error('Install a new development build to open device files.');
  const root = library();
  const extension = item.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? (item.kind === 'pdf' ? '.pdf' : item.kind === 'image' ? '.jpg' : item.kind === 'video' ? '.mp4' : '');
  const copy = new File(root, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
  try {
    root.create({ intermediates: true, idempotent: true });
    const imported = await FileEngine.importDeviceFile(item.uri, item.kind, copy.uri);
    return await rememberFile({ uri: imported.uri, name: imported.name || item.name, mimeType: imported.mimeType, size: imported.size }, item.kind);
  } catch (error) {
    if (copy.exists) copy.delete();
    throw error;
  }
}

/** Same cleanup as removing each item from its list. Returns how many entries were removed. */
export async function clearRecentFiles() {
  const rows = (await (await db()).getAllAsync<RecentFile>('SELECT * FROM recent_files')).map(restored);
  for (const row of rows) await removeRecentFile(row);
  return rows.length;
}

export async function removeRecentFile(file: RecentFile) {
  // Never remove saved tool outputs or originals outside our import directory.
  const root = library().uri.replace(/\/+$/, '') + '/';
  if (file.uri.startsWith(root) && !decodeURIComponent(file.uri.slice(root.length)).includes('/')) {
    const copy = new File(file.uri); if (copy.exists) copy.delete();
  }
  await (await db()).runAsync('DELETE FROM recent_files WHERE id = ?', file.id);
}

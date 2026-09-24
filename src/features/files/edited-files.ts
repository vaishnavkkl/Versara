import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { documentRoot, libraryDatabase, storedUri, type FileKind } from './recent-files';

/** A file the user saved from an editor or tool. `deviceUri` is its copy in the shared device folder. */
export type EditedFile = {
  id: string; uri: string; name: string; kind: FileKind; mimeType: string; size: number;
  deviceUri: string; location: string; created: number; modified: number;
};
export const EDITED_LIMIT = 200;

let ready: Promise<SQLiteDatabase> | undefined;
function db() {
  if (!ready) ready = (async () => {
    const database = await libraryDatabase();
    await database.execAsync('CREATE TABLE IF NOT EXISTS edited_files (id TEXT PRIMARY KEY, uri TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, mimeType TEXT NOT NULL, size INTEGER NOT NULL, deviceUri TEXT NOT NULL, location TEXT NOT NULL, created INTEGER NOT NULL, modified INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS edited_modified ON edited_files(modified DESC);');
    return database;
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}
const restored = (file: EditedFile): EditedFile => ({ ...file, uri: file.uri.startsWith('document://') ? documentRoot() + file.uri.slice('document://'.length) : file.uri });

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeEditedFiles(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const notify = () => { for (const listener of listeners) listener(); };

export async function listEditedFiles(search = '', kind?: FileKind) {
  const database = await db();
  const rows = kind
    ? await database.getAllAsync<EditedFile>(`SELECT * FROM edited_files WHERE kind = ? AND instr(lower(name), lower(?)) > 0 ORDER BY modified DESC LIMIT ${EDITED_LIMIT}`, kind, search.trim())
    : await database.getAllAsync<EditedFile>(`SELECT * FROM edited_files WHERE instr(lower(name), lower(?)) > 0 ORDER BY modified DESC LIMIT ${EDITED_LIMIT}`, search.trim());
  return rows.map(restored);
}
export async function countEditedFiles() {
  const row = await (await db()).getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM edited_files');
  return row?.total ?? 0;
}
export async function findEditedFile(uri: string) {
  const row = await (await db()).getFirstAsync<EditedFile>('SELECT * FROM edited_files WHERE uri = ?', storedUri(uri));
  return row ? restored(row) : null;
}

export async function recordEditedFile(file: Omit<EditedFile, 'id' | 'created' | 'modified'> & { id?: string }) {
  const database = await db();
  const now = Date.now();
  const existing = file.id
    ? await database.getFirstAsync<EditedFile>('SELECT * FROM edited_files WHERE id = ?', file.id)
    : await database.getFirstAsync<EditedFile>('SELECT * FROM edited_files WHERE uri = ?', storedUri(file.uri));
  const value: EditedFile = { ...file, id: existing?.id ?? `${now}-${Math.random().toString(36).slice(2)}`, created: existing?.created ?? now, modified: now };
  await database.withExclusiveTransactionAsync(async transaction => {
    await transaction.runAsync('DELETE FROM edited_files WHERE uri = ? AND id != ?', storedUri(value.uri), value.id);
    await transaction.runAsync('INSERT INTO edited_files(id,uri,name,kind,mimeType,size,deviceUri,location,created,modified) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET uri=excluded.uri, name=excluded.name, size=excluded.size, mimeType=excluded.mimeType, deviceUri=excluded.deviceUri, location=excluded.location, modified=excluded.modified',
      value.id, storedUri(value.uri), value.name, value.kind, value.mimeType, value.size, value.deviceUri, value.location, value.created, value.modified);
  });
  notify();
  return value;
}

/** Removes the entry only; the app copy may still be in Recents and the device copy belongs to the user. */
export async function removeEditedFile(file: EditedFile) {
  await (await db()).runAsync('DELETE FROM edited_files WHERE id = ?', file.id);
  notify();
}
export const editedFileExists = (file: EditedFile) => { try { return new File(file.uri).exists; } catch { return false; } };

import { Directory, File, Paths } from 'expo-file-system';
import { libraryDatabase, storedUri } from '../files/recent-files';

const SIGNATURE_KEYS = new Set(['imageUri','pixelPath','originalImageUri','originalPixelPath','cleanImageUri','cleanPixelPath']);
function signatureNames(payload: string) {
  const names = new Set<string>();
  try { JSON.parse(payload, (key,value) => {
    if (SIGNATURE_KEYS.has(key) && typeof value === 'string' && decodeURIComponent(value).includes('/Versara Signature Drafts/')) {
      const name=decodeURIComponent(value.split('/').at(-1)!);
      if (/^signature-[a-zA-Z0-9.-]+\.png(?:\.bgra)?$/.test(name)) names.add(name);
    }
    return value;
  }); } catch { /* Invalid drafts are never used as file paths. */ }
  return names;
}
/** Clear crash leftovers after a grace period; keep every asset referenced by a draft. */
export async function pruneSignatureDraftAssets() {
  await writes.catch(() => {});
  const folder=new Directory(Paths.document,'Versara Signature Drafts');
  if (!folder.exists) return;
  const rows=await (await database()).getAllAsync<{payload:string}>('SELECT payload FROM editor_drafts');
  const retained=new Set(rows.flatMap(row => [...signatureNames(row.payload)]));
  for (const file of folder.list()) if (file instanceof File && !retained.has(file.name) && file.modificationTime && Date.now()-file.modificationTime > 3600000) {
    try { file.delete(); } catch { /* Retry next session. */ }
  }
}
const MAX_BYTES = 2_000_000;
const MAX_DRAFTS = 100;
const discarded = new Set<string>();
let prepared: Promise<void> | undefined;
let writes: Promise<unknown> = Promise.resolve();
type PendingDraft = { source: string; payload: string; promise: Promise<void> };
const pendingDrafts = new Map<string, PendingDraft>();
const scheduledDrafts = new Set<PendingDraft>();
async function database() {
  const db = await libraryDatabase();
  prepared ??= db.execAsync('CREATE TABLE IF NOT EXISTS editor_drafts (id TEXT PRIMARY KEY, source TEXT NOT NULL, payload TEXT NOT NULL, updated INTEGER NOT NULL);').catch(cause => { prepared = undefined; throw cause; });
  await prepared;
  return db;
}

// File metadata is native; do not load image/PDF bytes into JavaScript for drafts.
export function draftSource(uri: string) {
  try { const file = new File(uri); return file.exists ? `${storedUri(uri)}|${file.size}|${file.modificationTime ?? 0}` : ''; }
  catch { return ''; }
}

export async function readEditorDraft<T>(id: string, source: string): Promise<T | null> {
  await writes.catch(() => {});
  discarded.delete(id);
  const db = await database();
  const row = await db.getFirstAsync<{ source: string; payload: string }>('SELECT source,payload FROM editor_drafts WHERE id = ?', id);
  if (!row || row.source !== source || row.payload.length > MAX_BYTES) return null;
  try {
    return JSON.parse(row.payload, (key, value) => {
      if (SIGNATURE_KEYS.has(key) && typeof value === 'string' && decodeURIComponent(value).includes('/Versara Signature Drafts/')) {
        const name = decodeURIComponent(value.split('/').at(-1)!);
        if (!/^signature-[a-zA-Z0-9.-]+\.png(?:\.bgra)?$/.test(name)) return value;
        const uri = new File(Paths.document, 'Versara Signature Drafts', name).uri;
        return key.endsWith('Path') ? decodeURIComponent(uri.replace(/^file:\/\//, '')) : uri;
      }
      return value;
    }) as T;
  } catch { return null; }
}

export function writeEditorDraft(id: string, source: string, value: unknown) {
  const payload = JSON.stringify(value);
  // Three bytes per UTF-16 code unit bounds UTF-8 without allocating another buffer.
  if (!payload || payload.length * 3 > MAX_BYTES) return Promise.reject(new Error('This draft is too large to autosave. Save your work before continuing.'));
  const previous = pendingDrafts.get(id);
  const queuedBytes = [...scheduledDrafts].reduce((sum, item) => sum + (item === previous ? 0 : item.payload.length * 3), 0);
  if (queuedBytes + payload.length * 3 > 4_000_000 || !previous && scheduledDrafts.size >= 8) return Promise.reject(new Error('Draft storage is busy. Use Save to keep your changes.'));
  if (previous) { previous.source = source; previous.payload = payload; return previous.promise; }
  const entry: PendingDraft = { source, payload, promise: Promise.resolve() };
  const operation = writes.catch(() => {}).then(async () => {
    if (pendingDrafts.get(id) === entry) pendingDrafts.delete(id);
    scheduledDrafts.delete(entry);
    if (discarded.has(id)) return;
    const db = await database();
    const count = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM editor_drafts WHERE id <> ?', id);
    if ((count?.count ?? 0) >= MAX_DRAFTS) throw new Error('Save or discard existing drafts before creating more.');
    await db.runAsync('INSERT INTO editor_drafts(id,source,payload,updated) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,payload=excluded.payload,updated=excluded.updated', id, entry.source, entry.payload, Date.now());
  });
  entry.promise = operation;
  pendingDrafts.set(id, entry);
  scheduledDrafts.add(entry);
  writes = operation;
  return operation;
}

/** Prevent an outgoing screen from recreating a draft after explicit Discard. */
export function discardEditorDraft(id: string) {
  if (discarded.size >= MAX_DRAFTS) discarded.delete(discarded.values().next().value!);
  discarded.add(id);
  return removeEditorDraft(id);
}

export function pdfDraftId(uri: string, tool: string) {
  return `pdf:${storedUri(uri)}:${['edit_text', 'text', 'remove_text'].includes(tool) ? 'text' : tool}`;
}

export function removeEditorDraft(id: string) {
  // Delete is a barrier: a subsequent edit must enqueue after it, never coalesce
  // into an older write that this delete would erase.
  pendingDrafts.delete(id);
  const operation = writes.catch(() => {}).then(async () => {
    const db=await database();
    const row=await db.getFirstAsync<{payload:string}>('SELECT payload FROM editor_drafts WHERE id = ?',id);
    await db.runAsync('DELETE FROM editor_drafts WHERE id = ?', id);
    if (row && signatureNames(row.payload).size) {
      const others=await db.getAllAsync<{payload:string}>('SELECT payload FROM editor_drafts');
      const retained=new Set(others.flatMap(other => [...signatureNames(other.payload)]));
      for (const name of signatureNames(row.payload)) if (!retained.has(name)) try { const file=new File(Paths.document,'Versara Signature Drafts',name); if (file.exists) file.delete(); } catch { /* Pruning retries. */ }
    }
  });
  writes = operation;
  return operation;
}

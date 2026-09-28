import { Directory, File, Paths } from 'expo-file-system';
import { recordEditedFile, type EditedFile } from './edited-files';
import { documentRoot, rememberFile, storedUri } from './recent-files';
import { invalidateThumbnails } from './thumbnail-cache';

const recoveryRoot = () => new Directory(Paths.document, '.save-recovery');
const MAX_RECOVERY_BYTES = 512 * 1024 * 1024;
type FileRecord = Omit<EditedFile, 'id' | 'created' | 'modified'> & { id?: string };
type Journal = { version: 1; original: string; stage: string; backupSize: number; phase: 'prepared' | 'app-replaced' | 'rollback' | 'complete'; record?: FileRecord };
const restored = (uri: string) => uri.startsWith('document://') ? documentRoot() + uri.slice('document://'.length) : uri;
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Could not complete the save.';

let pending: Promise<unknown> = Promise.resolve();
export function serializeSave<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.catch(() => {});
  return result;
}

async function writeJournal(directory: Directory, value: Journal) {
  const committed = new File(directory, `${value.phase}.json`);
  if (committed.exists) return;
  const temporary = new File(directory, `${value.phase}.next`);
  temporary.write(JSON.stringify(value));
  await temporary.move(committed);
}

async function restoreOriginal(directory: Directory, value: Journal) {
  const original = new File(restored(value.original));
  if (!original.uri.startsWith(documentRoot())) throw new Error('An interrupted save needs manual recovery. Its original is kept inside Versara.');
  const backup = new File(directory, 'original');
  if (!backup.exists || backup.size !== value.backupSize) throw new Error('An interrupted save backup could not be verified. Your remaining files have been kept.');
  const stage = new File(restored(value.stage));
  if (!stage.uri.startsWith(directory.uri.replace(/\/+$/, '') + '/')) throw new Error('The recovery staging location is invalid. Your files have been kept.');
  await backup.copy(stage, { overwrite: true });
  if (stage.size !== value.backupSize) throw new Error('Could not restore the original file. Its recovery copy has been kept.');
  await stage.move(original, { overwrite: true });
  if (!original.exists || original.size !== value.backupSize) throw new Error('The restored original could not be verified. Its recovery copy has been kept.');
  invalidateThumbnails(original.uri);
}

/** Called under serializeSave before starting another replacement. */
export async function recoverAppSaves() {
  const root = recoveryRoot();
  if (!root.exists) return;
  for (const directory of root.list()) {
    if (!(directory instanceof Directory)) continue;
    const journal = ['complete', 'rollback', 'app-replaced', 'prepared'].map(phase => new File(directory, `${phase}.json`)).find(file => file.exists);
    if (!journal) { directory.delete(); continue; } // No original can change before the first journal exists.
    const value = JSON.parse(await journal.text()) as Journal;
    if (value.version !== 1 || !value.original || !value.stage) throw new Error('An earlier save needs recovery before another replacement. Its files have been kept.');
    if (value.phase === 'prepared' || value.phase === 'rollback') await restoreOriginal(directory, value);
    else if (value.phase === 'app-replaced') {
      if (!value.record) throw new Error('An interrupted save is missing its library information. Its files have been kept.');
      const record = { ...value.record, uri: restored(value.record.uri) };
      const file = new File(record.uri);
      if (!file.exists || file.size !== record.size) throw new Error('An interrupted saved file could not be verified. The original recovery copy has been kept.');
      await recordEditedFile(record);
      await rememberFile(record, record.kind);
      invalidateThumbnails(record.uri);
    } else if (value.phase !== 'complete') throw new Error('An earlier save could not be recovered. Its files have been kept.');
    await writeJournal(directory, { ...value, phase: 'complete' });
    directory.delete();
  }
}

export function recoverPendingAppSaves() { return serializeSave(recoverAppSaves); }

export async function prepareAppReplacement(originalUri: string, outputUri: string) {
  const original = new File(originalUri);
  const output = new File(outputUri);
  if (!original.exists || !output.exists || output.size <= 0) throw new Error('The original or generated file is missing. Open it again before saving.');
  if (original.size > MAX_RECOVERY_BYTES) throw new Error('This file is too large for a safe replacement. Choose Save as new to keep the original.');
  const root = recoveryRoot();
  root.create({ intermediates: true, idempotent: true });
  if (root.list().length >= 4) throw new Error('An earlier save needs recovery. Choose Save as new after recovering the saved files.');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const directory = new Directory(root, id);
  directory.create();
  const backup = new File(directory, 'original');
  const stage = new File(directory, 'replacement');
  const value: Journal = { version: 1, original: storedUri(originalUri), stage: storedUri(stage.uri), backupSize: original.size, phase: 'prepared' };
  try {
    await original.copy(backup);
    await output.copy(stage);
    if (backup.size !== original.size || stage.size !== output.size) throw new Error('Could not verify the staged save. The original has not been changed.');
    await writeJournal(directory, value);
  } catch (cause) {
    try { if (stage.exists) stage.delete(); if (directory.exists) directory.delete(); } catch { /* No original has been changed. */ }
    throw cause;
  }
  let replaced = false;
  return {
    async replace(record: FileRecord) {
      try {
        replaced = true; // Preserve the backup even if a failed move removed its destination.
        await stage.move(original, { overwrite: true });
        if (original.size !== record.size) throw new Error('Could not verify the replacement file.');
        value.phase = 'app-replaced';
        value.record = { ...record, uri: storedUri(record.uri) };
        await writeJournal(directory, value);
      } catch (cause) {
        try {
          await writeJournal(directory, { ...value, phase: 'rollback' });
          await restoreOriginal(directory, value);
          await writeJournal(directory, { ...value, phase: 'complete' });
          replaced = false;
          try { directory.delete(); } catch { /* A completed rollback is safe to clean up later. */ }
        }
        catch { throw new Error(`${message(cause)} The original recovery copy remains inside Versara. Try saving again to retry recovery.`); }
        throw new Error(`${message(cause)} The original in Versara was restored. The device copy may already contain the saved changes.`);
      }
    },
    async complete() {
      await writeJournal(directory, { ...value, phase: 'complete' });
      try { directory.delete(); } catch { /* A later recovery removes this committed backup. */ }
    },
    async abandon() {
      if (replaced) return; // Keep the committed file and journal if indexing needs to be retried.
      try { if (stage.exists) stage.delete(); if (directory.exists) directory.delete(); } catch { /* A later recovery safely restores the original. */ }
    },
  };
}

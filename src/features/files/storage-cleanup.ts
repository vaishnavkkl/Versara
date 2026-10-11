import { Directory, File, Paths } from 'expo-file-system';
import { pruneSignatureDraftAssets } from '../editor/editor-drafts';
import { prunePdfCache } from '../pdf/pdf-cache';
import { pruneImageWorkspaces } from './image-workspace';
import { savedPdfDirectory } from './file-storage';

/** Per-session cache folders, named `<prefix><created ms>-…`. Tool sessions live in memory, so earlier ones are orphans. */
const SESSION_FOLDERS = ['versara-imports-', 'image-text-'];
const SHARE_GRACE = 60 * 60 * 1000;
const startedAt = Date.now();
let cleaned = false;

/** Clears working files left by an earlier run that closed before its tools cleaned up. Runs once per launch. */
export async function cleanStaleStorage() {
  if (cleaned) return;
  cleaned = true;
  try {
    for (const entry of Paths.cache.list()) {
      if (!(entry instanceof Directory)) continue;
      const prefix = SESSION_FOLDERS.find(item => entry.name.startsWith(item));
      const created = prefix ? Number(entry.name.slice(prefix.length).split('-')[0]) : NaN;
      if (Number.isFinite(created) && created > 0 && created < startedAt) try { entry.delete(); } catch { /* The next launch retries. */ }
    }
    // Share receivers read attachments after the chooser closes, so only older ones are removed.
    const shares = new Directory(Paths.cache, 'versara-share');
    if (shares.exists) for (const entry of shares.list()) {
      const created = Number(entry.name.split('-')[0]);
      if (entry instanceof Directory && Number.isFinite(created) && created > 0 && created < startedAt - SHARE_GRACE) try { entry.delete(); } catch { /* The next launch retries. */ }
    }
    for (const entry of Paths.cache.list()) {
      // Native text exports from page text previews.
      if (entry instanceof File && /^page-text-\d+-[a-z0-9]+\.txt$/.test(entry.name) && Number(entry.name.split('-')[2]) < startedAt) try { entry.delete(); } catch { /* The next launch retries. */ }
    }
    // Hidden renders the native editor staged in the saved PDF folder before moving them out.
    const library = savedPdfDirectory();
    if (library.exists) for (const entry of library.list()) {
      const staged = /^\.(?:share|handoff)-(\d+)-/.exec(entry.name);
      if (entry instanceof File && staged && Number(staged[1]) < startedAt) try { entry.delete(); } catch { /* The next launch retries. */ }
    }
  } catch (cause) { console.warn('Temporary file cleanup failed.', cause); }
  prunePdfCache();
  await pruneImageWorkspaces(startedAt).catch(cause => console.warn('Image workspace cleanup failed.', cause));
  await pruneSignatureDraftAssets().catch(() => {});
}

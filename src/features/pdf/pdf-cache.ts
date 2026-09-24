import { Directory, File, Paths } from 'expo-file-system';

const viewerDirectory = () => new Directory(Paths.cache, 'versara-pdf-viewer');
const exportDirectory = () => new Directory(Paths.cache, 'versara-pdf-exports');
const DAY = 24 * 60 * 60 * 1000;
let lastPruned = 0;

export async function retainPickerCopy(uri: string, destination: File) {
  const source = new File(uri);
  const pickerCache = new Directory(Paths.cache, 'DocumentPicker').uri.replace(/\/+$/, '') + '/';
  // The picker already copied the file. Rename only that disposable app-owned copy.
  // Never move files supplied from a user's storage or another provider.
  if (uri.startsWith(pickerCache) && !decodeURIComponent(uri.slice(pickerCache.length)).includes('..')) await source.move(destination);
  else await source.copy(destination);
}

export function removeViewerFile(uri: string) {
  // Only our own temporary copies may be removed; never delete a user's original.
  if (!uri.startsWith(viewerDirectory().uri.replace(/\/+$/, '') + '/')) return;
  try { const file = new File(uri); if (file.exists) file.delete(); }
  catch (error) { console.warn('PDF temporary file cleanup failed.', error); }
}

export async function importViewerFile(uri: string): Promise<string> {
  const directory = viewerDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await retainPickerCopy(uri, file);
    return file.uri;
  } catch (error) {
    removeViewerFile(file.uri);
    throw error;
  } finally {
    // DocumentPicker was explicitly asked for a disposable cached copy.
    const pickerCache = new Directory(Paths.cache, 'DocumentPicker').uri.replace(/\/+$/, '') + '/';
    if (uri.startsWith(pickerCache)) {
      try { const copy = new File(uri); if (copy.exists) copy.delete(); } catch { /* OS cache eviction remains available. */ }
    }
  }
}

export async function copyForExport(uri: string, name: string): Promise<string> {
  const directory = exportDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'document.pdf';
  const copy = new File(directory, `${Date.now()}-${safeName}`);
  try { await new File(uri).copy(copy); return copy.uri; }
  catch (error) { if (copy.exists) copy.delete(); throw error; }
}

export function prunePdfCache() {
  if (Date.now() - lastPruned < DAY) return;
  lastPruned = Date.now();
  // Export copies outlive the viewer: Android printing may read after its Promise resolves.
  for (const directory of [viewerDirectory(), exportDirectory()]) {
    try {
      if (!directory.exists) continue;
      for (const file of directory.list()) {
        const created = Number(file.name.split('-')[0]);
        if (file instanceof File && Number.isFinite(created) && created > 0 && Date.now() - created > DAY) file.delete();
      }
    } catch (error) { console.warn('PDF cache maintenance failed.', error); }
  }
}

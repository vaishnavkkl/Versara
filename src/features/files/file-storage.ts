import { Directory, File, Paths } from 'expo-file-system';
import { retainPickerCopy } from '../pdf/pdf-cache';

export type LocalFile = { uri: string; name: string; mimeType: string; size: number };
export const savedPdfDirectory = () => new Directory(Paths.document, 'Versara PDFs');
export const createImportDirectory = () => new Directory(Paths.cache, `versara-imports-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function disposeImports(directory: Directory) {
  const root = Paths.cache.uri.replace(/\/+$/, '') + '/versara-imports-';
  if (!directory.uri.startsWith(root)) return;
  try { if (directory.exists) directory.delete(); } catch (error) { console.warn('Temporary file cleanup failed.', error); }
}

export async function browseFiles(directory: Directory, imagesOnly = false, limit = 1, pdfsOnly = false): Promise<LocalFile[]> {
  const { getDocumentAsync } = await import('expo-document-picker');
  const result = await getDocumentAsync({ type: imagesOnly ? 'image/*' : pdfsOnly ? 'application/pdf' : '*/*', multiple: imagesOnly || limit > 1, copyToCacheDirectory: true });
  if (result.canceled) return [];
  const copies: File[] = [];
  try {
    if (result.assets.length > limit) throw new Error(`Choose up to ${limit} ${imagesOnly ? 'images' : pdfsOnly ? 'PDFs' : 'file'} at a time.`);
    directory.create({ intermediates: true, idempotent: true });
    const files: LocalFile[] = [];
    for (const asset of result.assets) {
      const name = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'file';
      const file = new File(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
      copies.push(file);
      await retainPickerCopy(asset.uri, file);
      files.push({ uri: file.uri, name: asset.name, mimeType: asset.mimeType ?? '', size: file.size });
    }
    return files;
  } catch (error) {
    for (const file of copies) { try { if (file.exists) file.delete(); } catch { /* Cleared with the session. */ } }
    throw error;
  } finally {
    const pickerRoot = new Directory(Paths.cache, 'DocumentPicker').uri.replace(/\/+$/, '') + '/';
    for (const asset of result.assets) {
      if (asset.uri.startsWith(pickerRoot)) { try { const file = new File(asset.uri); if (file.exists) file.delete(); } catch { /* OS cache eviction remains available. */ } }
    }
  }
}

export function formatSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }

export async function shareFile(file: { uri: string; mimeType?: string }) {
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: file.mimeType, dialogTitle: 'Save or share file', ...(file.mimeType === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {}) });
}

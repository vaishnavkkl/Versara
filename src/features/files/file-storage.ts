import { selectFileAssets } from './file-picker-session';
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
  const assets = await selectFileAssets(imagesOnly ? 'image' : pdfsOnly ? 'pdf' : 'any', limit);
  if (!assets.length) return [];
  const copies: File[] = [];
  try {
    if (assets.length > limit) throw new Error(`Choose up to ${limit} ${imagesOnly ? 'images' : pdfsOnly ? 'PDFs' : 'file'} at a time.`);
    directory.create({ intermediates: true, idempotent: true });
    const files: LocalFile[] = [];
    for (const asset of assets) {
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
    for (const asset of assets) {
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

/** A named file in the share cache. Receivers read attachments after the Android chooser returns, so they are kept. */
export function createShareAttachment(name: string) {
  const root = new Directory(Paths.cache, 'versara-share');
  root.create({ intermediates: true, idempotent: true });
  const entries = root.list().filter((entry): entry is Directory => entry instanceof Directory)
    .sort((a, b) => b.name.localeCompare(a.name));
  // Eight recent attachments at most.
  for (const entry of entries.slice(7)) { try { entry.delete(); } catch { /* OS cache eviction remains available. */ } }
  const folder = new Directory(root, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  folder.create();
  return new File(folder, name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-120) || 'file');
}

export function discardShareAttachment(attachment: File) {
  try { const folder = attachment.parentDirectory; if (folder.exists) folder.delete(); } catch { /* OS cache eviction remains available. */ }
}

export async function shareNamedFile(file: LocalFile) {
  // Avoid copying exceptionally large files into the cache.
  if (file.size > 32 * 1024 * 1024) return shareFile(file);
  const attachment = createShareAttachment(file.name);
  try { await new File(file.uri).copy(attachment); await shareFile({ uri: attachment.uri, mimeType: file.mimeType }); }
  catch (cause) { discardShareAttachment(attachment); throw cause; }
}

/**
 * Renders an edited copy into the share cache, then opens the share sheet.
 * Renderers that only write inside one folder render into `staging` first.
 */
export async function shareRenderedFile(name: string, mimeType: string, render: (outputUri: string) => Promise<unknown>, staging?: Directory) {
  const attachment = createShareAttachment(name);
  const extension = name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '';
  const target = staging ? new File(staging, `.share-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`) : attachment;
  try {
    staging?.create({ intermediates: true, idempotent: true });
    await render(target.uri);
    if (!target.exists) throw new Error('Could not prepare the file to share.');
    if (target !== attachment) await target.move(attachment);
    await shareFile({ uri: attachment.uri, mimeType });
  } catch (cause) {
    if (target !== attachment) { try { if (target.exists) target.delete(); } catch { /* Removed with the next save cleanup. */ } }
    discardShareAttachment(attachment);
    throw cause;
  }
}

/** Edited PDFs are written by the native editor, which only writes inside the saved PDF folder. */
export function shareRenderedPdf(name: string, render: (outputUri: string) => Promise<unknown>) {
  return shareRenderedFile(name, 'application/pdf', render, savedPdfDirectory());
}

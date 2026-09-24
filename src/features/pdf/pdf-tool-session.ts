import { browseFiles, createImportDirectory, disposeImports, type LocalFile } from '../files/file-storage';
import { File, type Directory } from 'expo-file-system';

export type InitialSelection = { directory: Directory; files: LocalFile[] };
export type PdfTool = 'viewer' | 'edit_text' | 'remove_text' | 'text' | 'merge' | 'split' | 'extract' | 'delete' | 'reorder' | 'rotate' | 'from_image';
export type PdfToolSession = InitialSelection & { tool: PdfTool; title: string };
const sessions = new Map<string, PdfToolSession>();
export const implementedPdfTools = new Set<string>(['viewer', 'edit_text', 'remove_text', 'text', 'merge', 'split', 'extract', 'delete', 'reorder', 'rotate', 'from_image']);

export async function pickPdfTool(tool: PdfTool, title: string) {
  const directory = createImportDirectory();
  try {
    const images = tool === 'from_image';
    const files = await browseFiles(directory, images, images || tool === 'merge' ? 30 : 1, !images);
    if (!files.length) { disposeImports(directory); return null; }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessions.set(id, { directory, files, tool, title });
    return id;
  } catch (error) { disposeImports(directory); throw error; }
}

/** Give a tool its own input lifetime while the reader keeps the current PDF open. */
export async function createPdfToolForDocument(tool: PdfTool, title: string, document: { uri: string; name: string }) {
  if (tool === 'from_image') return pickPdfTool(tool, title);
  const directory = createImportDirectory();
  try {
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, 'source.pdf');
    await new File(document.uri).copy(file);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessions.set(id, { directory, tool, title, files: [{ uri: file.uri, name: document.name, mimeType: 'application/pdf', size: file.size }] });
    return id;
  } catch (error) { disposeImports(directory); throw error; }
}
export function getPdfToolSession(id: string) { return sessions.get(id); }
export async function createImagePdfToolForFile(source: LocalFile) {
  const directory = createImportDirectory();
  try {
    directory.create({ intermediates: true, idempotent: true });
    const extension = source.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '.jpg';
    const copy = new File(directory, `image${extension}`);
    await new File(source.uri).copy(copy);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessions.set(id, { directory, tool: 'from_image', title: 'Images to PDF', files: [{ ...source, uri: copy.uri, size: copy.size }] });
    return id;
  } catch (error) { disposeImports(directory); throw error; }
}
// Once mounted, the tool owns its inputs until its native job has finished.
export function forgetPdfToolSession(id: string) { sessions.delete(id); }
export function discardPdfToolSession(id: string) {
  const session = sessions.get(id);
  if (session) disposeImports(session.directory);
  sessions.delete(id);
}

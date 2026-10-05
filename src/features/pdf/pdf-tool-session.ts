import { browseFiles, createImportDirectory, disposeImports, type LocalFile } from '../files/file-storage';
import { File, Directory, Paths } from 'expo-file-system';
import { documentRoot, rememberFile } from '../files/recent-files';

/** `origin` is the Versara file the tool was opened from, so edits can be saved back over it. */
export type PdfReturnRoute = '/file-preview' | '/pdf-viewer';
/** `initialQuery` pre-fills Find and replace when it is opened from the reader's search. */
export type InitialSelection = { directory: Directory; files: LocalFile[]; origin?: { uri: string; name: string }; initialPage?: number; returnRoute?: PdfReturnRoute; initialQuery?: string };
export const advancedPdfTools = new Set<string>(['info', 'duplicate', 'insert', 'compress', 'to_image', 'highlight', 'draw', 'shapes', 'add_image', 'sign', 'watermark', 'numbers', 'protect', 'metadata', 'flatten', 'ocr', 'extract_text', 'repair']);
export type PdfTool = 'viewer' | 'edit_text' | 'remove_text' | 'text' | 'replace_text' | 'merge' | 'split' | 'extract' | 'delete' | 'reorder' | 'rotate' | 'from_image' | 'info' | 'duplicate' | 'insert' | 'compress' | 'to_image' | 'highlight' | 'draw' | 'shapes' | 'add_image' | 'sign' | 'watermark' | 'numbers' | 'protect' | 'metadata' | 'flatten' | 'ocr' | 'extract_text' | 'repair';
export type PdfToolSession = InitialSelection & { tool: PdfTool; title: string };
const sessions = new Map<string, PdfToolSession>();
export const implementedPdfTools = new Set<string>(['viewer', 'edit_text', 'remove_text', 'text', 'replace_text', 'merge', 'split', 'extract', 'delete', 'reorder', 'rotate', 'from_image', ...advancedPdfTools]);

/** Drafts require an original that survives picker/session cache cleanup. */
export async function retainPdfEditingSource(file: LocalFile) {
  if (file.uri.startsWith(documentRoot())) return { uri: file.uri, name: file.name };
  const library = new Directory(Paths.document, 'Versara Library');
  library.create({ intermediates: true, idempotent: true });
  const copy = new File(library, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await new File(file.uri).copy(copy);
    await rememberFile({ ...file, uri: copy.uri, size: copy.size }, 'pdf');
    return { uri: copy.uri, name: file.name };
  } catch (cause) { if (copy.exists) copy.delete(); throw cause; }
}

export async function pickPdfTool(tool: PdfTool, title: string) {
  const directory = createImportDirectory();
  try {
    const images = tool === 'from_image';
    const files = await browseFiles(directory, images, images || tool === 'merge' ? 30 : 1, !images);
    if (!files.length) { disposeImports(directory); return null; }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const origin = !images && files.length === 1 && ['edit_text', 'text', 'remove_text', 'replace_text', 'highlight', 'draw', 'shapes', 'add_image', 'sign'].includes(tool) ? await retainPdfEditingSource(files[0]) : undefined;
    sessions.set(id, { directory, files, tool, title, origin });
    return id;
  } catch (error) { disposeImports(directory); throw error; }
}

/** Give a tool its own input lifetime while the reader keeps the current PDF open. */
export async function createPdfToolForDocument(tool: PdfTool, title: string, document: { uri: string; name: string }, initialPage = 0, returnRoute?: PdfReturnRoute, initialQuery?: string) {
  if (tool === 'from_image') return pickPdfTool(tool, title);
  const directory = createImportDirectory();
  try {
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, 'source.pdf');
    await new File(document.uri).copy(file);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessions.set(id, { directory, tool, title, initialPage, returnRoute, initialQuery, origin: { uri: document.uri, name: document.name }, files: [{ uri: file.uri, name: document.name, mimeType: 'application/pdf', size: file.size }] });
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

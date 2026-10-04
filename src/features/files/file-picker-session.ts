import { router } from 'expo-router';
import { Platform } from 'react-native';
import { FileEngine, type ExplorerEntry } from '../../../modules/file-engine';
import type { DocumentPickerAsset } from 'expo-document-picker';

export type PickerKind = 'image' | 'pdf' | 'any';
export type FilePickerSelection = { kind: PickerKind; selected: ExplorerEntry[]; onSelect: (file: ExplorerEntry) => void };
type Request = { id: string; kind: PickerKind; limit: number; resolve: (files: ExplorerEntry[] | null) => void };
let current: Request | undefined;
export function getFilePickerRequest(id: string) { return current?.id === id ? current : undefined; }
export function finishFilePicker(id: string, files: ExplorerEntry[] | null) {
  if (current?.id !== id) return;
  const request = current; current = undefined; request.resolve(files);
}

/** Android all-files access differs from Photos/media access. iOS uses Files. */
export async function selectFileAssets(kind: PickerKind, limit: number): Promise<DocumentPickerAsset[]> {
  let fullAccess = false;
  if (Platform.OS === 'android' && FileEngine?.nativeExplorerVersion && FileEngine.getPdfAccessAsync) {
    try { fullAccess = (await FileEngine.getPdfAccessAsync()).granted; } catch { /* Use the system picker. */ }
  }
  if (fullAccess) {
    if (current) throw new Error('Finish the open file selection first.');
    const files = await new Promise<ExplorerEntry[] | null>((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      current = { id, kind, limit, resolve };
      try { router.push({ pathname: '/file-picker', params: { request: id } }); }
      catch (error) { current = undefined; reject(error); }
    });
    if (files !== null) return files.map(file => ({ uri: file.uri, name: file.name, size: file.size, mimeType: file.mimeType, lastModified: file.modified }));
  }
  const { getDocumentAsync } = await import('expo-document-picker');
  const result = await getDocumentAsync({ type: kind === 'image' ? 'image/*' : kind === 'pdf' ? 'application/pdf' : '*/*', multiple: limit > 1, copyToCacheDirectory: true });
  if (result.canceled) return [];
  // Let the returning screen commit its focus/AppState update before it starts
  // native preview work; otherwise its off-screen cleanup can cancel the import.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return result.assets;
}

import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { showDialog } from '@/components/app-dialog';
import { withLoading } from '@/components/app-loader';
import { toast } from '@/components/toast';
import { FileEngine, type SavedDeviceFile } from '../../../modules/file-engine';
import { findEditedFile, recordEditedFile, type EditedFile } from './edited-files';
import { invalidateThumbnails } from './thumbnail-cache';
import { documentRoot, rememberFile, type FileKind, type RecentFile } from './recent-files';

export type SaveMode = 'replace' | 'new';
type Origin = { uri: string; name: string };
const extensionOf = (value: string) => decodeURIComponent(value).match(/\.[a-zA-Z0-9]{1,8}$/)?.[0].toLowerCase() ?? '';
const sameExtension = (a: string, b: string) => a === b || (/^\.jpe?g$/.test(a) && /^\.jpe?g$/.test(b));

export function deviceFolderLabel(mimeType: string) {
  if (Platform.OS === 'ios') return 'Files › On My iPhone › Versara › Saved';
  if (mimeType.startsWith('image/')) return 'Pictures › Versara';
  if (mimeType.startsWith('video/')) return 'Movies › Versara';
  if (mimeType.startsWith('audio/')) return 'Music › Versara';
  return 'Downloads › Versara';
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', pdf: 'application/pdf',
};
/** Library entries may store wildcard types like `image/*`; device folders need a real type. */
export function concreteMimeType(file: { name: string; mimeType: string; kind: FileKind }) {
  if (file.mimeType && !file.mimeType.includes('*')) return file.mimeType;
  const extension = file.name.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1].toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? (file.kind === 'pdf' ? 'application/pdf' : file.kind === 'image' ? 'image/jpeg' : file.kind === 'video' ? 'video/mp4' : 'audio/mpeg');
}

/** Resolves null when the user cancels or presses Back. */
export function askSaveMode(name: string, mimeType: string): Promise<SaveMode | null> {
  return new Promise(resolve => showDialog('Save your changes',
    `Save updates “${name}” in Versara and its copy in ${deviceFolderLabel(mimeType)}.\n\nSave as new keeps the original and creates a new file.`,
    [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(null) }, { text: 'Save as new', onPress: () => resolve('new') }, { text: 'Save', onPress: () => resolve('replace') }],
    { ios: 'square.and.arrow.down', android: 'save' }));
}

export function newFileName(name: string, suffix = 'edited') {
  const extension = name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '';
  const base = name.slice(0, name.length - extension.length).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'File';
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  return `${base} (${suffix} ${stamp})${extension}`;
}

/** Writes to the shared device folder (Downloads/Pictures on Android, Files on iOS). */
export async function saveToDevice(uri: string, name: string, mimeType: string, replaceUri = ''): Promise<SavedDeviceFile> {
  if (!FileEngine?.nativeDeviceSaveVersion) throw new Error('Install a new development build to save files to your device.');
  return FileEngine.saveToDevice(uri, name, mimeType, replaceUri);
}

/** Save button for PDF tool results. Asks Save / Save as new when the tool was opened from a Versara file. */
export async function savePdfResult(result: { uri: string; name: string }, origin?: Origin | null) {
  const mode: SaveMode | null = origin ? await askSaveMode(origin.name, 'application/pdf') : 'new';
  if (!mode) return null;
  const saved = await withLoading('Saving to your device…', () => saveEditedOutput({ output: result.uri, mimeType: 'application/pdf', kind: 'pdf', mode, origin, name: result.name }));
  toast(`Saved to ${saved.device.location}`);
  showDialog('PDF saved', `${saved.file.name}\nSaved to ${saved.device.location}\n\nYou can also find it in Edited files on the home screen.`, undefined, { ios: 'checkmark.circle', android: 'check-circle' });
  return saved;
}

/**
 * Saves an editor output. `replace` overwrites the opened file inside Versara (when Versara owns it)
 * and the device copy saved from it before; `new` keeps both and adds a new file.
 */
export async function saveEditedOutput(options: { output: string; mimeType: string; kind: FileKind; mode: SaveMode; origin?: Origin | null; name: string }): Promise<{ file: EditedFile; device: SavedDeviceFile; recent: RecentFile | null }> {
  const { output, mimeType, kind, mode, origin } = options;
  let uri = output;
  let name = options.name;
  let previous: EditedFile | null = null;
  if (mode === 'replace' && origin) {
    const outputExtension = extensionOf(output);
    const sameFormat = sameExtension(extensionOf(origin.uri), outputExtension);
    name = sameFormat ? origin.name : origin.name.replace(/\.[a-zA-Z0-9]{1,8}$/, '') + outputExtension;
    previous = await findEditedFile(origin.uri).catch(() => null);
    if (sameFormat && origin.uri.startsWith(documentRoot()) && origin.uri !== output) {
      const target = new File(origin.uri);
      if (target.exists) target.delete();
      new File(output).move(target);
      uri = origin.uri;
      invalidateThumbnails(uri);
    }
  }
  const device = await saveToDevice(uri, name, mimeType, previous?.deviceUri ?? '');
  const size = new File(uri).size;
  const recent = uri.startsWith(documentRoot()) ? await rememberFile({ uri, name, mimeType, size }, kind).catch(() => null) : null;
  const file = await recordEditedFile({ id: previous?.id, uri, name, kind, mimeType, size, deviceUri: device.uri, location: device.location });
  return { file, device, recent };
}

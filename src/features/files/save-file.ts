import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { promptFileName, showDialog } from '@/components/app-dialog';
import { withLoading } from '@/components/app-loader';
import { toast } from '@/components/toast';
import { FileEngine, type SavedDeviceFile } from '../../../modules/file-engine';
import { findEditedFile, recordEditedFile, type EditedFile } from './edited-files';
import { invalidateThumbnails } from './thumbnail-cache';
import { documentRoot, rememberFile, type FileKind, type RecentFile } from './recent-files';
import { prepareAppReplacement, recoverAppSaves, serializeSave } from './save-recovery';

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
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', tiff: 'image/tiff', tif: 'image/tiff', bmp: 'image/bmp',
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

export async function askNewFileName(suggested: string) {
  const extension = suggested.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '';
  const baseOf = (value: string) => extension && value.toLowerCase().endsWith(extension.toLowerCase()) ? value.slice(0, -extension.length).trim() : value.trim();
  const value = await promptFileName(suggested, name => {
    if (!baseOf(name) || /^\.+$/.test(baseOf(name))) return 'Enter a file name.';
    if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) return 'Avoid slashes and these characters: : * ? " < > |';
    if (/[. ]$/.test(baseOf(name))) return 'The name cannot end with a dot or space.';
    return '';
  });
  return value === null ? null : `${baseOf(value)}${extension}`;
}

export async function askSaveOptions(originName: string, mimeType: string, suggestedName: string) {
  const mode = await askSaveMode(originName, mimeType);
  if (!mode) return null;
  const name = mode === 'new' ? await askNewFileName(suggestedName) : originName;
  return name === null ? null : { mode, name };
}

/** Writes to the shared device folder (Downloads/Pictures on Android, Files on iOS). */
export async function saveToDevice(uri: string, name: string, mimeType: string, replaceUri = ''): Promise<SavedDeviceFile> {
  if (!FileEngine?.nativeDeviceSaveVersion) throw new Error('Install a new development build to save files to your device.');
  if (replaceUri && FileEngine.nativeDeviceSaveVersion < 2) throw new Error('Update the app build before replacing a saved device file, or choose Save as new.');
  return FileEngine.saveToDevice(uri, name, mimeType, replaceUri);
}

/** Save button for PDF tool results. Asks Save / Save as new when the tool was opened from a Versara file. */
export async function savePdfResult(result: { uri: string; name: string }, origin?: Origin | null) {
  const mode: SaveMode | null = origin ? await askSaveMode(origin.name, 'application/pdf') : 'new';
  if (!mode) return null;
  const name = mode === 'new' ? await askNewFileName(result.name) : result.name;
  if (name === null) return null;
  const saved = await withLoading('Saving to your device…', () => saveEditedOutput({ output: result.uri, mimeType: 'application/pdf', kind: 'pdf', mode, origin, name }));
  toast(`Saved to ${saved.device.location}`);
  showDialog('PDF saved', `${saved.file.name}\nSaved to ${saved.device.location}\n\nYou can also find it in Edited files on the home screen.`, undefined, { ios: 'checkmark.circle', android: 'check-circle' });
  return saved;
}

/**
 * Saves an editor output. `replace` overwrites the opened file inside Versara (when Versara owns it)
 * and the device copy saved from it before; `new` keeps both and adds a new file.
 */
export async function saveEditedOutput(options: { output: string; mimeType: string; kind: FileKind; mode: SaveMode; origin?: Origin | null; name: string }): Promise<{ file: EditedFile; device: SavedDeviceFile; recent: RecentFile | null }> {
  return serializeSave(() => saveEditedOutputSerial(options));
}

async function saveEditedOutputSerial(options: { output: string; mimeType: string; kind: FileKind; mode: SaveMode; origin?: Origin | null; name: string }): Promise<{ file: EditedFile; device: SavedDeviceFile; recent: RecentFile | null }> {
  await recoverAppSaves();
  const { output, mimeType, kind, mode, origin } = options;
  let uri = output;
  let name = options.name;
  let previous: EditedFile | null = null;
  let replaceDeviceUri = '';
  let replacement: Awaited<ReturnType<typeof prepareAppReplacement>> | undefined;
  if (mode === 'replace' && origin) {
    const outputExtension = extensionOf(output);
    const sameFormat = sameExtension(extensionOf(origin.uri), outputExtension);
    name = sameFormat ? origin.name : origin.name.replace(/\.[a-zA-Z0-9]{1,8}$/, '') + outputExtension;
    previous = await findEditedFile(origin.uri).catch(() => null);
    replaceDeviceUri = sameFormat ? previous?.deviceUri ?? '' : '';
    if (sameFormat && origin.uri.startsWith(documentRoot()) && origin.uri !== output) {
      replacement = await prepareAppReplacement(origin.uri, output);
      uri = origin.uri;
    }
  }
  let device: SavedDeviceFile | undefined;
  try {
    // Publishing may fail (permission, full storage, removed provider). Keep the
    // app original untouched until the native saver has verified its device copy.
    device = await saveToDevice(output, name, mimeType, replaceDeviceUri);
    const size = new File(output).size;
    const record = { id: previous?.id, uri, name, kind, mimeType, size, deviceUri: device.uri, location: device.location };
    if (replacement) { await replacement.replace(record); invalidateThumbnails(uri); }
    const file = await recordEditedFile(record);
    const recent = uri.startsWith(documentRoot()) ? await rememberFile({ uri, name, mimeType, size }, kind) : null;
    await replacement?.complete();
    if (replacement) try { const generated = new File(output); if (generated.exists) generated.delete(); } catch { /* The successful saved copies remain authoritative. */ }
    return { file, device, recent };
  } catch (cause) {
    await replacement?.abandon();
    if (device) throw new Error(`${cause instanceof Error ? cause.message : 'Could not finish the save.'} The device copy was saved to ${device.location}. Your generated output and any recovery copy have been kept; try saving again to finish the library update.`);
    throw cause;
  }
}

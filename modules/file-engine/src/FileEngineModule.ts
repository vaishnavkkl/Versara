import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Lines found on-device. Boxes are normalised to the upright image; colours are 0xRRGGBB. */
export type RecognizedTextLine = {
  id: number; text: string; x: number; y: number; width: number; height: number; angle: number;
  color: number; background: number; backgroundLeft: number; backgroundRight: number;
};
export type RecognizedImageText = { width: number; height: number; lines: RecognizedTextLine[] };

export type FileAccessResult = {
  status: 'granted' | 'denied' | 'undetermined';
  granted: boolean;
  canAskAgain: boolean;
};

export type DeviceRecentFile = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  modified: number;
  kind: string;
  source: 'device';
};

export type ImportedDeviceFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  kind: string;
};

export type SavedDeviceFile = { uri: string; name: string; location: string; size: number; mimeType: string };

export type StorageRoot = { id: string; name: string; path: string; total: number; free: number; allowed: boolean };
export type ExplorerKind = 'folder' | 'pdf' | 'image' | 'video' | 'audio' | 'archive' | 'document' | 'app' | 'other';
export type ExplorerEntry = {
  name: string; path: string; uri: string; directory: boolean; size: number; modified: number;
  /** Visible child count for folders; -1 when not counted. */
  count: number; mimeType: string; kind: ExplorerKind;
};
export type DirectoryListing = { path: string; parent: string | null; items: ExplorerEntry[]; truncated: boolean };

declare class FileEngine extends NativeModule {
  readonly nativeExplorerVersion?: number;
  getStorageRoots(): Promise<StorageRoot[]>;
  listDirectory(path: string, showHidden: boolean): Promise<DirectoryListing>;
  searchFiles(query: string, limit: number): Promise<ExplorerEntry[]>;
  readonly nativeImageListVersion?: number;
  readonly nativePdfLibraryVersion?: number;
  readonly nativeZoomImageVersion?: number;
  readonly nativeVideoVersion?: number;
  readonly nativeImageEditorVersion?: number;
  readonly nativeImageTextVersion?: number;
  recognizeImageText(uri: string): Promise<RecognizedImageText>;
  renderImageText(options: string): Promise<{ uri: string; width: number; height: number; size: number; mimeType: string }>;
  editImage(options: string): Promise<{ uri: string; width: number; height: number; size: number; mimeType: string }>;
  readonly nativeDeviceSaveVersion?: number;
  /** Copies an app file into a shared device folder; `replaceUri` overwrites a copy saved earlier. */
  saveToDevice(sourceUri: string, name: string, mimeType: string, replaceUri: string): Promise<SavedDeviceFile>;
  readonly nativeRecentPdfsVersion?: number;
  listRecentPdfs(limit: number, search: string): Promise<DeviceRecentFile[]>;
  getPdfAccessAsync(): Promise<FileAccessResult>;
  requestPdfAccessAsync(): Promise<FileAccessResult>;
  scanPdfFiles(id: string): Promise<number>;
  cancelPdfScan(id: string): void;
  listPdfPage(offset: number, limit: number, search: string): Promise<{ items: DeviceRecentFile[]; total: number }>;
  getFileAccessAsync(): Promise<FileAccessResult>;
  requestFileAccessAsync(): Promise<FileAccessResult>;
  listDeviceRecents(kind: string, limit: number, search: string): Promise<DeviceRecentFile[]>;
  importDeviceFile(uri: string, kind: string, destinationUri: string): Promise<ImportedDeviceFile>;
}

export default requireOptionalNativeModule<FileEngine>('FileEngine');

import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Lines found on-device. Boxes are normalised to the upright image; colours are 0xRRGGBB. */
export type RecognizedTextLine = {
  id: number; text: string; x: number; y: number; width: number; height: number; angle: number;
  color: number; background: number; backgroundLeft: number; backgroundRight: number;
  /** Estimated from the line's ink when it contrasts with the background: size in analysed-image pixels, normalised baseline and start. */
  size?: number; baseline?: number; left?: number; bold?: boolean;
  /** Closest standard PDF font name, and the horizontal stretch that makes it span the original's width. */
  font?: string; scaleX?: number;
};
export type RecognizedImageText = { width: number; height: number; lines: RecognizedTextLine[] };

export type ImagePrivacyCategory = 'personal' | 'financial' | 'identity' | 'authentication' | 'location' | 'other';
/** Heuristic suggestions, not a guarantee that all private information was detected. */
export type ImagePrivacyFinding = {
  id: string; category: ImagePrivacyCategory; kind: string; text: string; confidence: number;
  /** Expanded full-line rectangle, normalized to the upright source image. */
  x: number; y: number; width: number; height: number;
};
export type ImagePrivacyScan = { width: number; height: number; findings: ImagePrivacyFinding[]; truncated: boolean };

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
  readonly nativeImageToolsVersion?: number;
  readonly nativeImageColorVersion?: number;
  readonly nativeStrokePatternsVersion?: number;
  readonly nativeMarkupEditingVersion?: number;
  readonly nativeImageResizeVersion?: number;
  readonly nativeImageHistoryVersion?: number;
  readonly nativeImagePrivacyVersion?: number;
  readonly nativeSignatureImageVersion?: number;
  scanImagePrivacy(id: string, uri: string): Promise<ImagePrivacyScan>;
  cancelPrivacyScan(id: string): void;
  processImage(id: string, request: string): Promise<Record<string, unknown>>;
  cancelImageJob(id: string): void;
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
  /** `fonts` (version 2+) is a JSON map of bundled font names to local files, matched against each line's shapes. */
  recognizeImageText(uri: string, fonts?: string): Promise<RecognizedImageText>;
  cancelImageTextRecognition?(uri: string): void;
  renderImageText(options: string): Promise<{ uri: string; width: number; height: number; size: number; mimeType: string }>;
  editImage(options: string): Promise<{ uri: string; width: number; height: number; size: number; mimeType: string }>;
  readonly nativeDeviceSaveVersion?: number;
  /** Copies an app file into a shared device folder; `replaceUri` overwrites a copy saved earlier. */
  saveToDevice(sourceUri: string, name: string, mimeType: string, replaceUri: string): Promise<SavedDeviceFile>;
  readonly nativeRecentPdfsVersion?: number;
  listRecentPdfs(limit: number, search: string): Promise<DeviceRecentFile[]>;
  readonly nativeDeviceDeleteVersion?: number;
  /** Deletes a file listed from the device (MediaStore, Photos or a chosen folder). */
  deleteDeviceFile(uri: string): Promise<boolean>;
  getPdfAccessAsync(): Promise<FileAccessResult>;
  requestPdfAccessAsync(): Promise<FileAccessResult>;
  scanPdfFiles(id: string): Promise<number>;
  cancelPdfScan(id: string): void;
  listPdfPage(offset: number, limit: number, search: string): Promise<{ items: DeviceRecentFile[]; total: number }>;
  getFileAccessAsync(): Promise<FileAccessResult>;
  requestFileAccessAsync(): Promise<FileAccessResult>;
  listDeviceRecents(kind: string, limit: number, search: string): Promise<DeviceRecentFile[]>;
  importDeviceFile(uri: string, kind: string, destinationUri: string): Promise<ImportedDeviceFile>;
  /** Android: imports the file another app opened Versara with, using the exact URI its intent granted. */
  readonly nativeIncomingFileVersion?: number;
  importIncomingFile?(uri: string, destinationUri: string): Promise<ImportedDeviceFile>;
}

export default requireOptionalNativeModule<FileEngine>('FileEngine');

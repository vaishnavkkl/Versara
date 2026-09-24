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

const unavailable: FileAccessResult = { status: 'undetermined', granted: false, canAskAgain: false };

export default {
  nativeExplorerVersion: undefined as number | undefined,
  async getStorageRoots() { return []; },
  async listDirectory(): Promise<never> { throw new Error('Browsing device folders is available in the Android and iOS apps.'); },
  async searchFiles() { return []; },
  nativePdfLibraryVersion: undefined as number | undefined,
  async getPdfAccessAsync() { return unavailable; },
  async requestPdfAccessAsync() { return unavailable; },
  async scanPdfFiles(_id: string) { return 0; },
  cancelPdfScan(_id: string) {},
  async listPdfPage(_offset: number, _limit: number, _search: string) { return { items: [] as DeviceRecentFile[], total: 0 }; },
  async listRecentPdfs(_limit: number, _search: string) { return [] as DeviceRecentFile[]; },
  async recognizeImageText(_uri: string): Promise<{ width: number; height: number; lines: never[] }> { throw new Error('Image text editing is available in the Android and iOS apps.'); },
  async renderImageText(_options: string): Promise<{ uri: string; width: number; height: number; size: number; mimeType: string }> { throw new Error('Image text editing is available in the Android and iOS apps.'); },
  async editImage(_options: string): Promise<{ uri: string; width: number; height: number; size: number; mimeType: string }> { throw new Error('Image editing is available in the Android and iOS apps.'); },
  nativeDeviceSaveVersion: undefined as number | undefined,
  async saveToDevice(_sourceUri: string, _name: string, _mimeType: string, _replaceUri: string): Promise<{ uri: string; name: string; location: string; size: number; mimeType: string }> { throw new Error('Saving to the device is available in the Android and iOS apps.'); },
  async getFileAccessAsync() { return unavailable; },
  async requestFileAccessAsync() { return unavailable; },
  async listDeviceRecents() { return [] as DeviceRecentFile[]; },
  async importDeviceFile(): Promise<ImportedDeviceFile> { throw new Error('File access is unavailable on web.'); },
};

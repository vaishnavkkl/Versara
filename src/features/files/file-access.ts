import { FileEngine, type FileAccessResult } from '../../../modules/file-engine';

const ASKED_KEY = 'versara.fileAccess.asked.v2';
export type FileAccessStatus = 'granted' | 'denied' | 'unavailable' | 'undetermined';

export function wasFileAccessAsked(): boolean {
  try { return localStorage.getItem(ASKED_KEY) === '1'; } catch { return false; }
}

export function markFileAccessAsked() {
  try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* Optional preference. */ }
}

function normalize(result: FileAccessResult | null | undefined): FileAccessStatus {
  if (!result) return 'unavailable';
  if (result.granted || result.status === 'granted') return 'granted';
  if (result.status === 'undetermined') return 'undetermined';
  return 'denied';
}

/** Native Expo Permissions / Photos authorization — not JS PermissionsAndroid. */
export async function requestFileAccess(): Promise<FileAccessStatus> {
  markFileAccessAsked();
  if (!FileEngine?.requestFileAccessAsync) return 'unavailable';
  try {
    return normalize(await FileEngine.requestFileAccessAsync());
  } catch {
    return 'denied';
  }
}

export async function getFileAccessStatus(): Promise<FileAccessStatus> {
  if (!FileEngine?.getFileAccessAsync) return 'unavailable';
  try {
    return normalize(await FileEngine.getFileAccessAsync());
  } catch {
    return 'denied';
  }
}

export function isFileEngineAvailable() {
  return !!FileEngine?.requestFileAccessAsync;
}

import { markExternalFileLaunch } from '@/features/files/external-launch';

/** Files opened from other apps arrive as content:// or file:// links; hand them to the import screen. */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (/^(content|file):\/\//i.test(path)) {
      // Cold starts skip the introduction splash so the file opens without waiting.
      if (initial) markExternalFileLaunch();
      return `/open-file?uri=${encodeURIComponent(path)}`;
    }
    return path;
  } catch {
    return '/';
  }
}

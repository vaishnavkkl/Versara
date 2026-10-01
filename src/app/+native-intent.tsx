/** Files opened from other apps arrive as content:// or file:// links; hand them to the import screen. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (/^(content|file):\/\//i.test(path)) return `/open-file?uri=${encodeURIComponent(path)}`;
    return path;
  } catch {
    return '/';
  }
}

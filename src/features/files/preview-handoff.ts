import type { RecentFile } from './recent-files';

// Transfer metadata already held by the library; never retain image pixels or file contents.
// Deep links and edited-file revisions still resolve through the persistent library.
const pending = new Map<string, { file: RecentFile; expires: number }>();

export function stagePreviewFile(file: RecentFile) {
  pending.delete(file.id);
  pending.set(file.id, { file, expires: Date.now() + 10_000 });
  while (pending.size > 4) pending.delete(pending.keys().next().value!);
}

export function takePreviewFile(id: string): RecentFile | null {
  const value = pending.get(id);
  pending.delete(id);
  return value && value.expires > Date.now() ? value.file : null;
}

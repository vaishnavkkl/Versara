import { useSyncExternalStore } from 'react';

let revision = 0;
const listeners = new Set<() => void>();
const fileRevisions = new Map<string, number>();
export function getLibraryRevision() { return revision; }
export function getFileRevision(uri: string) { return fileRevisions.get(uri) ?? 0; }
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyLibraryChanged(uris: string[] = []) {
  revision++;
  for (const uri of uris) {
    fileRevisions.delete(uri);
    fileRevisions.set(uri, revision);
  }
  // Saved files outside the bounded lists do not need a permanent in-memory entry.
  while (fileRevisions.size > 256) fileRevisions.delete(fileRevisions.keys().next().value!);
  for (const listener of listeners) listener();
}
export function useLibraryRevision() {
  return useSyncExternalStore(subscribe, getLibraryRevision, getLibraryRevision);
}

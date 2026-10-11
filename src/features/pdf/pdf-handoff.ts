import { useEffect, useRef, useSyncExternalStore } from 'react';
import { File } from 'expo-file-system';
import { savedPdfDirectory } from '../files/file-storage';

/** What the open PDF tool hands to the next tool when the user switches tools. */
export type PdfHandoff = {
  /** Unsaved edits or an unsaved result would carry into the next tool. */
  changed: boolean;
  /** The newest saved version, which becomes the next tool's original. */
  saved?: { uri: string; name: string };
  /** Why the current state cannot continue in one PDF (for example, several outputs). */
  blocked?: string;
  /** Work that only Save applies and the next tool will not include. */
  pending?: string;
  /** A different PDF the user opened inside this tool, with the original it saves over when known. */
  switched?: { file: { uri: string; name: string; mimeType: string; size: number }; origin?: { uri: string; name: string } };
  /** Writes the PDF exactly as the user sees it now, edits included. */
  write: (outputUri: string) => Promise<void>;
};
export type PdfHandoffState = { changed: boolean; saved: boolean };

let slot: PdfHandoff | null = null;
let state: PdfHandoffState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read when the user picks the next tool; the slot always holds the latest closures. */
export function currentPdfHandoff() { return slot; }

/** Whether the open tool has unsaved or saved changes, for the screen's Save and Discard prompts. */
export function usePdfHandoffState() { return useSyncExternalStore(subscribe, () => state, () => null); }

/** The open tool publishes how to continue with its current PDF in another tool. */
export function usePublishPdfHandoff(active: boolean, handoff: PdfHandoff) {
  const latest = useRef(handoff);
  useEffect(() => { latest.current = handoff; });
  useEffect(() => {
    if (!active) return;
    const published: PdfHandoff = {
      get changed() { return latest.current.changed; },
      get saved() { return latest.current.saved; },
      get blocked() { return latest.current.blocked; },
      get pending() { return latest.current.pending; },
      get switched() { return latest.current.switched; },
      write: outputUri => latest.current.write(outputUri),
    };
    slot = published;
    return () => { if (slot === published) { slot = null; state = null; emit(); } };
  }, [active]);
  const changed = handoff.changed, saved = !!handoff.saved;
  useEffect(() => {
    if (!active) return;
    state = { changed, saved };
    emit();
  }, [active, changed, saved]);
}

/** Hidden name prefix of hand-off renders staged in the saved PDF folder; startup cleanup removes leftovers. */
export const HANDOFF_STAGING_PREFIX = '.handoff-';

/**
 * Renders an edited PDF for the next tool. The native editor only writes inside the saved PDF folder, so it renders
 * there under a hidden name and copies the verified output to `outputUri`; nothing is left in the user's folder.
 */
export async function renderPdf(outputUri: string, render: (stagedUri: string) => Promise<unknown>) {
  const library = savedPdfDirectory();
  library.create({ intermediates: true, idempotent: true });
  const stagedUri = new File(library, `${HANDOFF_STAGING_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`).uri;
  try {
    await render(stagedUri);
    const staged = new File(stagedUri);
    if (!staged.exists || !staged.size) throw new Error('The PDF could not be prepared for the next tool.');
    const target = new File(outputUri);
    target.parentDirectory.create({ intermediates: true, idempotent: true });
    if (target.exists) target.delete();
    await staged.copy(target);
    if (!target.exists || target.size !== staged.size) throw new Error('The PDF could not be prepared for the next tool. Your edits are still open.');
  } finally {
    for (const uri of [stagedUri, `${stagedUri}.partial`]) { try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Startup cleanup retries. */ } }
  }
}

/** Copies an existing PDF as the hand-off; the working copy never aliases a saved or original file. */
export async function copyPdf(uri: string, outputUri: string) {
  const source = new File(uri);
  if (!source.exists) throw new Error('This PDF is no longer available. Open it again from your files.');
  const target = new File(outputUri);
  target.parentDirectory.create({ intermediates: true, idempotent: true });
  if (target.exists) target.delete();
  await source.copy(target);
}

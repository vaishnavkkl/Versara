import { router } from 'expo-router';
import { File } from 'expo-file-system';
import { showDialog } from '@/components/app-dialog';
import type { PdfReturnRoute } from './pdf-tool-session';

function readerParams(document: { uri: string; name: string }, page: number) {
  if (!new File(document.uri).exists) {
    showDialog('PDF unavailable', 'This PDF could not be found on your device. Open it again from your files or save the result again.');
    return null;
  }
  // SDK 57 useLocalSearchParams decodes query values after URL parsing has
  // already decoded them. Protect the URI's own escapes (e.g. %23 and %25).
  return { uri: encodeURIComponent(document.uri), name: encodeURIComponent(document.name), page: String(page) };
}

/** PDFs always open on their own screen, never inside a tool or sheet. */
export function openPdfScreen(document: { uri: string; name: string }, page = 0) {
  const params = readerParams(document, page);
  if (params) router.push({ pathname: '/pdf-viewer', params });
}

/**
 * Replaces the originating reader so Back cannot reveal an older PDF beneath the result.
 * Updating the existing reader's params is not enough: the screen can keep showing the PDF it
 * opened with, so the result always gets a fresh reader route.
 */
export function openPdfResult(document: { uri: string; name: string }, returnRoute?: PdfReturnRoute) {
  const params = readerParams(document, 0);
  if (!params) return;
  if (!returnRoute) { openPdfScreen(document); return; }
  const fresh = { ...params, revision: String(Date.now()) };
  router.dismissTo({ pathname: returnRoute, params: fresh });
  router.replace({ pathname: '/pdf-viewer', params: fresh });
}

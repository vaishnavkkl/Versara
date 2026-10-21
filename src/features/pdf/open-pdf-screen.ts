import { router } from 'expo-router';
import { File } from 'expo-file-system';
import { showDialog } from '@/components/app-dialog';
import type { PdfReturnRoute } from './pdf-tool-session';

function pdfReadable(uri: string) {
  try {
    const file = new File(uri);
    return file.exists && file.size > 0;
  } catch {
    return false;
  }
}

function readerParams(document: { uri: string; name: string }, page: number) {
  if (!pdfReadable(document.uri)) {
    showDialog('PDF unavailable', 'This PDF could not be found on your device. Open it again from your files or save the result again.');
    return null;
  }
  // SDK 57 useLocalSearchParams decodes query values after URL parsing has
  // already decoded them. Protect the URI's own escapes (e.g. %23 and %25).
  return { uri: encodeURIComponent(document.uri), name: encodeURIComponent(document.name), page: String(page) };
}

/** PDFs always open on their own screen, never inside a tool or sheet. Returns false when the file is missing. */
export function openPdfScreen(document: { uri: string; name: string }, page = 0) {
  const params = readerParams(document, page);
  if (!params) return false;
  router.push({ pathname: '/pdf-viewer', params });
  return true;
}
/**
 * Replaces the originating reader so Back cannot reveal an older PDF beneath the result.
 * Updating the existing reader's params is not enough: the screen can keep showing the PDF it
 * opened with, so the result always gets a fresh reader route.
 */
export function openPdfResult(document: { uri: string; name: string }, returnRoute?: PdfReturnRoute) {
  const params = readerParams(document, 0);
  if (!params) return false;
  if (!returnRoute) { router.push({ pathname: '/pdf-viewer', params }); return true; }
  const fresh = { ...params, revision: String(Date.now()) };
  router.dismissTo({ pathname: returnRoute, params: fresh });
  router.replace({ pathname: '/pdf-viewer', params: fresh });
  return true;
}

/**
 * After a save, the tool gives way to the saved PDF; Back then leads where the tool was opened from.
 * False when the PDF could not be opened, so the tool can show its result instead.
 */
export function showSavedPdf(document: { uri: string; name: string }, returnRoute?: PdfReturnRoute) {
  if (returnRoute) return openPdfResult(document, returnRoute);
  const params = readerParams(document, 0);
  if (params) router.replace({ pathname: '/pdf-viewer', params: { ...params, revision: String(Date.now()) } });
  return !!params;
}

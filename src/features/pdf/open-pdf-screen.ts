import { router } from 'expo-router';
import type { PdfReturnRoute } from './pdf-tool-session';

/** PDFs always open on their own screen, never inside a tool or sheet. */
export function openPdfScreen(document: { uri: string; name: string }, page = 0) {
  router.push({ pathname: '/pdf-viewer', params: { uri: document.uri, name: document.name, page: String(page) } });
}

/** Reuse the originating reader so Back cannot reveal an older PDF beneath the result. */
export function openPdfResult(document: { uri: string; name: string }, returnRoute?: PdfReturnRoute) {
  const params = { uri: document.uri, name: document.name, page: '0', revision: String(Date.now()) };
  if (returnRoute) router.dismissTo({ pathname: returnRoute, params });
  else openPdfScreen(document);
}

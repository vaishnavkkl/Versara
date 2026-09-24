import { router } from 'expo-router';

/** PDFs always open on their own screen, never inside a tool or sheet. */
export function openPdfScreen(document: { uri: string; name: string }, page = 0) {
  router.push({ pathname: '/pdf-viewer', params: { uri: document.uri, name: document.name, page: String(page) } });
}

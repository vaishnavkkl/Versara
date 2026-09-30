import { router } from 'expo-router';
import type { RecentFile } from '@/features/files/recent-files';
import { showDialog } from '@/components/app-dialog';

export function openDocument(file: { uri: string; name: string }, options?: { exportPdf?: boolean }) {
  if (file.name.toLowerCase().endsWith('.doc')) {
    showDialog('Word 97 file', 'Legacy .doc files cannot be displayed here. Save a copy as DOCX to open it in Versara.');
    return;
  }
  const text = file.name.toLowerCase().endsWith('.txt');
  if (text) router.push({ pathname: '/doc-editor', params: { uri: file.uri, name: file.name, format: 'txt', export: options?.exportPdf ? 'pdf' : '' } });
  else router.push({ pathname: '/doc-reader', params: { uri: file.uri, name: file.name } });
}

/** Opens the editor on a blank Word document or plain text file. */
export function startNewDocument(format: 'docx' | 'txt') {
  router.push({ pathname: '/doc-editor', params: { blank: '1', name: format === 'txt' ? 'Untitled.txt' : 'Untitled.docx', format } });
}

export function openRecentDocument(file: RecentFile) {
  openDocument(file);
  return true;
}

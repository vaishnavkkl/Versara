import { router } from 'expo-router';
import type { RecentFile } from '@/features/files/recent-files';

export function openDocument(file: { uri: string; name: string }, options?: { exportPdf?: boolean }) {
  const text = file.name.toLowerCase().endsWith('.txt');
  router.push({ pathname: '/doc-editor', params: { uri: file.uri, name: file.name, format: text ? 'txt' : 'docx', export: options?.exportPdf ? 'pdf' : '' } });
}

/** Opens the editor on a blank Word document or plain text file. */
export function startNewDocument(format: 'docx' | 'txt') {
  router.push({ pathname: '/doc-editor', params: { blank: '1', name: format === 'txt' ? 'Untitled.txt' : 'Untitled.docx', format } });
}

export function openRecentDocument(file: RecentFile) {
  openDocument(file);
  return true;
}

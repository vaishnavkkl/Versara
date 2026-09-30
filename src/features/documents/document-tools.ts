import type { MethodSection } from '@/constants/pdf-methods';

export const DOCUMENT_SECTIONS: readonly MethodSection[] = [
  { title: 'Write', tools: [
    { id: 'new', title: 'New document', subtitle: 'Start a blank Word document', ios: 'doc.badge.plus', android: 'note-add' },
    { id: 'text', title: 'Text file', subtitle: 'Start a blank plain text file', ios: 'doc.plaintext', android: 'text-snippet' },
  ] },
];

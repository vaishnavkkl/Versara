import type { Method, MethodSection } from '@/constants/pdf-methods';

export type PrivacyMode = 'scan' | 'pdf_scan' | 'redact' | 'metadata' | 'remove_text';
type PrivacyTool = Method & { id: PrivacyMode; keywords: string };

export const PRIVACY_TOOLS = [
  {
    id: 'scan', title: 'Privacy Review', subtitle: 'Review private text in PDFs and images.',
    keywords: 'pdf scan screenshot photo image private sensitive personal email phone address account OCR',
    ios: 'text.viewfinder', android: 'document-scanner',
  },
  {
    id: 'redact', title: 'Redact Image', subtitle: 'Cover details before sharing a copy.',
    keywords: 'hide black out screenshot photo manual cover redact text QR code face',
    ios: 'eye.slash', android: 'visibility-off',
  },
  {
    id: 'metadata', title: 'Remove Image Metadata', subtitle: 'Remove EXIF and GPS in the image tool.',
    keywords: 'remove EXIF GPS location camera date timestamp photo image metadata',
    ios: 'lock.shield', android: 'privacy-tip',
  },
  {
    id: 'pdf_scan', title: 'Redact PDF', subtitle: 'Review private text and cover selected areas.',
    keywords: 'pdf privacy scan sensitive redact hide confidential personal account',
    ios: 'doc.badge.ellipsis', android: 'find-in-page',
  },
  {
    id: 'remove_text', title: 'Remove PDF Text', subtitle: 'Delete selected text. Not secure redaction.',
    keywords: 'pdf remove delete text privacy',
    ios: 'eraser', android: 'format-clear',
  },
] as const satisfies readonly PrivacyTool[];

export const PRIVACY_SECTIONS = [{ title: 'Safer sharing', tools: PRIVACY_TOOLS }] as const satisfies readonly MethodSection[];

export function getPrivacyTool(id: string) {
  return PRIVACY_TOOLS.find(tool => tool.id === id);
}

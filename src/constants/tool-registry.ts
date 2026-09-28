import { PRIVACY_TOOLS } from '@/features/privacy/privacy-tools';

export const TOOLS = [
  { id: 'compress_pdf', keywords: 'reduce shrink pdf size', connectivity: 'Offline', title: 'Compress PDF', description: 'Make your PDFs easier to share.', category: 'documents', ios: 'doc.zipper', android: 'picture-as-pdf' },
  { id: 'merge_pdf', keywords: 'join pdf combine pages', connectivity: 'Offline', title: 'Merge PDF', description: 'Bring your pages together.', category: 'documents', ios: 'doc.on.doc', android: 'file-copy' },
  { id: 'compress_img', keywords: 'photo picture jpg png reduce size', connectivity: 'Offline', title: 'Compress Image', description: 'Make every pixel lighter.', category: 'image', ios: 'photo.badge.arrow.down', android: 'photo-size-select-large' },
  ...PRIVACY_TOOLS.map(tool => ({ ...tool, id: `privacy_${tool.id}` as const, connectivity: 'Offline' as const, description: tool.subtitle, category: 'privacy' as const })),
] as const;
export const CATEGORIES = [
  { id: 'documents', label: 'PDF', subtitle: 'PDF essentials', ios: 'doc.text', android: 'description' },
  { id: 'image', label: 'Image', subtitle: 'Edit & enhance', ios: 'photo.fill', android: 'image' },
  { id: 'privacy', label: 'Privacy', subtitle: 'Safer sharing', ios: 'lock.shield', android: 'security' },
] as const;
export type Tool = typeof TOOLS[number];
export type Category = typeof CATEGORIES[number]['id'];

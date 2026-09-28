export const TOOLS = [
  { id: 'compress_pdf', keywords: 'reduce shrink pdf size', connectivity: 'Offline', title: 'Compress PDF', description: 'Make your PDFs easier to share.', category: 'documents', ios: 'doc.zipper', android: 'picture-as-pdf' },
  { id: 'merge_pdf', keywords: 'join pdf combine pages', connectivity: 'Offline', title: 'Merge PDF', description: 'Bring your pages together.', category: 'documents', ios: 'doc.on.doc', android: 'file-copy' },
  { id: 'compress_img', keywords: 'photo picture jpg png reduce size', connectivity: 'Offline', title: 'Compress Image', description: 'Make every pixel lighter.', category: 'image', ios: 'photo.badge.arrow.down', android: 'photo-size-select-large' },
  { id: 'redact', keywords: 'hide private sensitive screenshot', connectivity: 'Offline', title: 'Redact Screenshot', description: 'Keep sensitive details hidden.', category: 'privacy', ios: 'eye.slash', android: 'visibility-off' },
  { id: 'metadata', keywords: 'exif gps location remove photo data', connectivity: 'Offline', title: 'Remove Metadata', description: 'Share only what you intend.', category: 'privacy', ios: 'lock.shield', android: 'security' },
] as const;
export const CATEGORIES = [
  { id: 'documents', label: 'PDF', subtitle: 'PDF essentials', ios: 'doc.text', android: 'description' },
  { id: 'image', label: 'Image', subtitle: 'Edit & enhance', ios: 'photo.fill', android: 'image' },
  { id: 'privacy', label: 'Privacy', subtitle: 'Safer sharing', ios: 'lock.shield', android: 'security' },
] as const;
export type Tool = typeof TOOLS[number];
export type Category = typeof CATEGORIES[number]['id'];

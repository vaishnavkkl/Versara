export const TOOLS = [
  { id: 'compress_pdf', keywords: 'reduce shrink pdf size', connectivity: 'Offline', title: 'Compress PDF', description: 'Make your PDFs easier to share.', category: 'documents', ios: 'doc.zipper', android: 'picture-as-pdf' },
  { id: 'merge_pdf', keywords: 'join pdf combine pages', connectivity: 'Offline', title: 'Merge PDF', description: 'Bring your pages together.', category: 'documents', ios: 'doc.on.doc', android: 'file-copy' },
  { id: 'compress_img', keywords: 'photo picture jpg png reduce size', connectivity: 'Offline', title: 'Compress Image', description: 'Make every pixel lighter.', category: 'image', ios: 'photo.badge.arrow.down', android: 'photo-size-select-large' },
  { id: 'compress_vid', keywords: 'movie mp4 shrink reduce size', connectivity: 'Offline', title: 'Compress Video', description: 'Less size. More room.', category: 'video', ios: 'video', android: 'video-settings' },
  { id: 'redact', keywords: 'hide private sensitive screenshot', connectivity: 'Offline', title: 'Redact Screenshot', description: 'Keep sensitive details hidden.', category: 'privacy', ios: 'eye.slash', android: 'visibility-off' },
  { id: 'metadata', keywords: 'exif gps location remove photo data', connectivity: 'Offline', title: 'Remove Metadata', description: 'Share only what you intend.', category: 'privacy', ios: 'lock.shield', android: 'security' },
  { id: 'wifi', keywords: 'wifi slow internet speed network connection', connectivity: 'Needs Internet', title: 'Wi-Fi Test', description: 'Understand your connection.', category: 'device', ios: 'wifi', android: 'wifi' },
  { id: 'battery', keywords: 'charging drain power battery health', connectivity: 'Offline', title: 'Battery Test', description: 'Get to know your battery.', category: 'device', ios: 'battery.75percent', android: 'battery-full' },
] as const;
export const CATEGORIES = [
  { id: 'documents', label: 'PDF', subtitle: 'PDF essentials', ios: 'doc.text', android: 'description' },
  { id: 'image', label: 'Image', subtitle: 'Edit & enhance', ios: 'photo.fill', android: 'image' },
  { id: 'video', label: 'Video', subtitle: 'Trim & compress', ios: 'play.rectangle.fill', android: 'smart-display' },
  { id: 'audio', label: 'Audio', subtitle: 'Edit & convert', ios: 'waveform', android: 'graphic-eq' },
  { id: 'privacy', label: 'Privacy', subtitle: 'Safer sharing', ios: 'lock.shield', android: 'security' },
  { id: 'device', label: 'Device', subtitle: 'Everyday diagnostics', ios: 'iphone', android: 'smartphone' },
] as const;
export type Tool = typeof TOOLS[number];
export type Category = typeof CATEGORIES[number]['id'];

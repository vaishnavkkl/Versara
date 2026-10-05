import type { ComponentProps } from 'react';
import type { UniversalIcon } from '@/components/universal-icon';

export type Method = {
  id: string;
  title: string;
  subtitle: string;
  ios: ComponentProps<typeof UniversalIcon>['ios'];
  android: ComponentProps<typeof UniversalIcon>['android'];
};
export type MethodSection = { title: string; tools: readonly Method[] };
const SECTIONS = [
  { title: 'Read & explore', tools: [
    { id: 'viewer', title: 'PDF Viewer', subtitle: 'Read, scroll & zoom', ios: 'doc.text.magnifyingglass', android: 'find-in-page' },
    { id: 'info', title: 'PDF Info', subtitle: 'File details & metadata', ios: 'info.circle', android: 'info-outline' },
  ] },
  { title: 'Organize pages', tools: [
    { id: 'merge', title: 'Merge PDF', subtitle: 'Join documents into one', ios: 'doc.on.doc', android: 'file-copy' },
    { id: 'split', title: 'Split PDF', subtitle: 'Separate a document', ios: 'scissors', android: 'content-cut' },
    { id: 'extract', title: 'Extract Pages', subtitle: 'Keep selected pages', ios: 'doc.badge.arrow.up', android: 'file-open' },
    { id: 'delete', title: 'Delete Pages', subtitle: 'Remove unwanted pages', ios: 'trash', android: 'delete-outline' },
    { id: 'reorder', title: 'Reorder Pages', subtitle: 'Arrange your document', ios: 'arrow.up.arrow.down', android: 'swap-vert' },
    { id: 'rotate', title: 'Rotate Pages', subtitle: 'Correct page orientation', ios: 'rotate.right', android: 'rotate-right' },
    { id: 'duplicate', title: 'Duplicate Pages', subtitle: 'Make copies of pages', ios: 'plus.square.on.square', android: 'copy-all' },
    { id: 'insert', title: 'Insert Pages', subtitle: 'Add pages to a document', ios: 'doc.badge.plus', android: 'post-add' },
  ] },
  { title: 'Convert & optimize', tools: [
    { id: 'compress', title: 'Compress PDF', subtitle: 'Reduce document size', ios: 'arrow.down.right.and.arrow.up.left', android: 'compress' },
    { id: 'to_image', title: 'PDF to Image', subtitle: 'Export pages as JPG or PNG', ios: 'photo', android: 'image' },
    { id: 'from_image', title: 'Image to PDF', subtitle: 'Combine JPG, PNG or HEIC', ios: 'photo.on.rectangle', android: 'add-photo-alternate' },
  ] },
  { title: 'Edit & annotate', tools: [
    { id: 'edit_text', title: 'Edit PDF', subtitle: 'Change existing PDF text', ios: 'pencil', android: 'edit' },
    { id: 'remove_text', title: 'Remove Text', subtitle: 'Delete selected PDF text', ios: 'eraser', android: 'format-clear' },
    { id: 'text', title: 'Add Text', subtitle: 'Place text on a page', ios: 'textformat', android: 'text-fields' },
    { id: 'add_image', title: 'Add Image', subtitle: 'Place a photo or logo on a page', ios: 'photo.badge.plus', android: 'add-photo-alternate' },
    { id: 'replace_text', title: 'Find & Replace', subtitle: 'Replace text on every page', ios: 'text.magnifyingglass', android: 'find-replace' },
    { id: 'highlight', title: 'Highlight', subtitle: 'Mark important passages', ios: 'highlighter', android: 'highlight' },
    { id: 'draw', title: 'Draw', subtitle: 'Add freehand notes', ios: 'pencil.tip', android: 'draw' },
    { id: 'shapes', title: 'Add Shapes', subtitle: 'Place shapes on a page', ios: 'square.on.circle', android: 'category' },
    { id: 'sign', title: 'Signature', subtitle: 'Add your signature', ios: 'signature', android: 'gesture' },
    { id: 'watermark', title: 'Watermark', subtitle: 'Label your documents', ios: 'drop', android: 'branding-watermark' },
    { id: 'numbers', title: 'Page Numbers', subtitle: 'Number document pages', ios: 'number', android: 'format-list-numbered' },
  ] },
  { title: 'Protect & inspect', tools: [
    { id: 'protect', title: 'Protect PDF', subtitle: 'Set a document password', ios: 'lock', android: 'lock-outline' },
    { id: 'metadata', title: 'Remove Metadata', subtitle: 'Clear document properties', ios: 'shield.lefthalf.filled', android: 'privacy-tip' },
    { id: 'flatten', title: 'Flatten PDF', subtitle: 'Flatten page annotations', ios: 'square.3.layers.3d', android: 'layers' },
    { id: 'ocr', title: 'Scan Text (OCR)', subtitle: 'Recognize scanned text', ios: 'text.viewfinder', android: 'document-scanner' },
    { id: 'extract_text', title: 'Extract Text', subtitle: 'Export document text', ios: 'text.alignleft', android: 'subject' },
    { id: 'repair', title: 'Repair PDF', subtitle: 'Inspect damaged documents', ios: 'wrench.and.screwdriver', android: 'build' },
  ] },
] as const satisfies readonly MethodSection[];

export const PDF_QUICK_IDS = ['edit_text', 'ocr', 'remove_text', 'text'];
export const PDF_SECTIONS: readonly MethodSection[] = [
  { title: 'Quick tools', tools: PDF_QUICK_IDS.map(id => SECTIONS.flatMap(section => [...section.tools]).find(tool => tool.id === id)!) },
  ...SECTIONS.map(section => ({ ...section, tools: section.tools.filter(tool => !PDF_QUICK_IDS.includes(tool.id)) })),
];

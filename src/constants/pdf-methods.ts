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
    { id: 'viewer', title: 'PDF Viewer', subtitle: 'Read, scroll & zoom', ios: 'doc.text.magnifyingglass', android: 'mdi:file-eye-outline' },
    { id: 'info', title: 'PDF Info', subtitle: 'File details & metadata', ios: 'info.circle', android: 'mdi:information-outline' },
  ] },
  { title: 'Organize pages', tools: [
    { id: 'merge', title: 'Merge PDF', subtitle: 'Join documents into one', ios: 'arrow.triangle.merge', android: 'mdi:call-merge' },
    { id: 'split', title: 'Split PDF', subtitle: 'Separate a document', ios: 'arrow.triangle.branch', android: 'mdi:call-split' },
    { id: 'extract', title: 'Extract Pages', subtitle: 'Keep selected pages', ios: 'doc.badge.arrow.up', android: 'mdi:file-export-outline' },
    { id: 'delete', title: 'Delete Pages', subtitle: 'Remove unwanted pages', ios: 'trash', android: 'mdi:file-remove-outline' },
    { id: 'reorder', title: 'Reorder Pages', subtitle: 'Arrange your document', ios: 'arrow.up.arrow.down.square', android: 'mdi:swap-vertical-variant' },
    { id: 'rotate', title: 'Rotate Pages', subtitle: 'Correct page orientation', ios: 'rotate.right', android: 'mdi:file-rotate-right-outline' },
    { id: 'duplicate', title: 'Duplicate Pages', subtitle: 'Make copies of pages', ios: 'plus.square.on.square', android: 'mdi:content-duplicate' },
    { id: 'insert', title: 'Insert Pages', subtitle: 'Add pages to a document', ios: 'doc.badge.plus', android: 'mdi:file-plus-outline' },
  ] },
  { title: 'Convert & optimize', tools: [
    { id: 'compress', title: 'Compress PDF', subtitle: 'Reduce document size', ios: 'arrow.down.right.and.arrow.up.left', android: 'mdi:arrow-collapse' },
    { id: 'to_image', title: 'PDF to Image', subtitle: 'Export pages as JPG or PNG', ios: 'photo', android: 'mdi:file-image-outline' },
    { id: 'from_image', title: 'Image to PDF', subtitle: 'Combine JPG, PNG or HEIC', ios: 'photo.stack', android: 'mdi:image-multiple-outline' },
  ] },
  { title: 'Edit & annotate', tools: [
    { id: 'edit_text', title: 'Edit PDF', subtitle: 'Change existing PDF text', ios: 'pencil.line', android: 'mdi:file-edit-outline' },
    { id: 'remove_text', title: 'Remove Text', subtitle: 'Delete selected PDF text', ios: 'eraser', android: 'mdi:eraser' },
    { id: 'text', title: 'Add Text', subtitle: 'Place text on a page', ios: 'textformat', android: 'mdi:format-text' },
    { id: 'add_image', title: 'Add Image', subtitle: 'Place a photo or logo on a page', ios: 'photo.badge.plus', android: 'mdi:image-plus-outline' },
    { id: 'replace_text', title: 'Find & Replace', subtitle: 'Replace text on every page', ios: 'text.magnifyingglass', android: 'mdi:find-replace' },
    { id: 'highlight', title: 'Highlight', subtitle: 'Mark important passages', ios: 'highlighter', android: 'mdi:marker' },
    { id: 'draw', title: 'Draw', subtitle: 'Add freehand notes', ios: 'scribble.variable', android: 'mdi:draw-pen' },
    { id: 'shapes', title: 'Add Shapes', subtitle: 'Place shapes on a page', ios: 'square.on.circle', android: 'mdi:shape-outline' },
    { id: 'sign', title: 'Signature', subtitle: 'Add your signature', ios: 'signature', android: 'mdi:signature-freehand' },
    { id: 'watermark', title: 'Watermark', subtitle: 'Label your documents', ios: 'drop', android: 'mdi:water-outline' },
    { id: 'numbers', title: 'Page Numbers', subtitle: 'Number document pages', ios: 'number.square', android: 'mdi:format-list-numbered' },
  ] },
  { title: 'Protect & inspect', tools: [
    { id: 'protect', title: 'Protect PDF', subtitle: 'Set a document password', ios: 'lock.doc', android: 'mdi:file-lock-outline' },
    { id: 'metadata', title: 'Remove Metadata', subtitle: 'Clear document properties', ios: 'shield.lefthalf.filled', android: 'mdi:shield-off-outline' },
    { id: 'flatten', title: 'Flatten PDF', subtitle: 'Flatten page annotations', ios: 'square.3.layers.3d', android: 'mdi:layers-outline' },
    { id: 'ocr', title: 'Scan Text (OCR)', subtitle: 'Recognize scanned text', ios: 'text.viewfinder', android: 'mdi:text-recognition' },
    { id: 'extract_text', title: 'Extract Text', subtitle: 'Export document text', ios: 'doc.plaintext', android: 'mdi:text-box-outline' },
    { id: 'repair', title: 'Repair PDF', subtitle: 'Inspect damaged documents', ios: 'wrench.adjustable', android: 'mdi:wrench-outline' },
  ] },
] as const satisfies readonly MethodSection[];

export const PDF_QUICK_IDS = ['edit_text', 'ocr', 'remove_text', 'text'];
export const PDF_SECTIONS: readonly MethodSection[] = [
  { title: 'Quick tools', tools: PDF_QUICK_IDS.map(id => SECTIONS.flatMap(section => [...section.tools]).find(tool => tool.id === id)!) },
  ...SECTIONS.map(section => ({ ...section, tools: section.tools.filter(tool => !PDF_QUICK_IDS.includes(tool.id)) })),
];

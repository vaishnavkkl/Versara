import type { Palette } from './colors';

export function optionColorKey(label: string) {
  const value = label.toLowerCase();
  if (/area|pencil|size|percent|fit|fill|stretch/.test(value)) return 'resize';
  if (/select|pen|solid|rotate|undo|redo/.test(value)) return 'rotate';
  if (/dotted|style|colour|color|heic|png|tiff|jpeg|webp|export|save|share/.test(value)) return 'export';
  if (/dashed|highlight|compress|balance/.test(value)) return 'compress';
  if (/draw|brush|marker|bold/.test(value)) return 'draw';
  if (/delete|remove|discard/.test(value)) return 'redact';
  return 'adjust';
}

// Stable tool identities shared by the quick rail, toolbox and editor controls.
const families = [
  { ids: ['edit_text', 'text', 'replace_text', 'rename', 'extract_text', 'ocr'], light: '#7050AF', dark: '#C4A4F3' },
  { ids: ['crop', 'resize', 'social', 'extract', 'split', 'to_image'], light: '#247A58', dark: '#7FD4B1' },
  { ids: ['rotate', 'flip_h', 'flip_v', 'perspective', 'reorder', 'orientation'], light: '#286EAD', dark: '#94C4F3' },
  { ids: ['adjust', 'brightness', 'exposure', 'temperature', 'highlight', 'numbers'], light: '#3968B8', dark: '#A6C5FA' },
  { ids: ['contrast', 'saturation', 'filters', 'sharpen', 'blur', 'draw', 'shapes'], light: '#B45071', dark: '#F4A5C0' },
  { ids: ['compress', 'batch_compress', 'batch', 'merge', 'duplicate', 'insert', 'canvas'], light: '#247E8D', dark: '#89D5DE' },
  { ids: ['redact', 'remove_text', 'delete', 'remove', 'protect', 'metadata'], light: '#AE503F', dark: '#F3AB98' },
  { ids: ['export', 'watermark', 'sign', 'convert', 'pdf', 'save', 'share'], light: '#6260AC', dark: '#BDBBF3' },
];
export function toolColors(id: string, colors: Palette) {
  const dark = colors.systemBackground === '#000000';
  const family = families.find(item => item.ids.includes(id));
  const ink = family ? family[dark ? 'dark' : 'light'] : colors.secondaryLabel;
  return { ink, surface: `${ink}${dark ? '22' : '12'}` };
}

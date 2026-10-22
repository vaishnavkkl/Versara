import type { ViewStyle } from 'react-native';
import type { Palette } from './colors';
import { gradient } from './dashboard';

/** Stable colour id from an Android/MDI icon name (same key used by header glyphs). */
export function iconColorKey(android: string) {
  return android.replace(/^mdi:/, '').replace(/-(outline|outlined|border|variant)+$/g, '');
}

/**
 * Colour family for an option label. Prefer `iconColorKey(android)` when an icon is known —
 * never default everything to amber "adjust", which made docks look repeatedly yellow.
 */
export function optionColorKey(label: string, android?: string) {
  if (android) return iconColorKey(android);
  const value = label.toLowerCase();
  if (/area|pencil|size|percent|fit|fill|stretch|crop|blank page|another pdf|jpg|png|jpeg|webp|heic|tiff/.test(value)) return 'resize';
  if (/select all|clear|deselect|select|pen|solid|rotate|undo|redo|flip|earlier|later|at the start|at the end/.test(value)) return 'rotate';
  if (/page numbers|ranges|options|tune|settings|levels|curves|quality|estimate/.test(value)) return 'adjust';
  if (/dotted|style|colour|color|export|save|share|searchable|text file|all pages|this page/.test(value)) return 'export';
  if (/dashed|highlight|compress|balance|subtle|bold watermark/.test(value)) return 'compress';
  if (/draw|brush|marker|bold|shape|sign|stamp|watermark/.test(value)) return 'draw';
  if (/delete|remove|discard|eraser|redact|protect/.test(value)) return 'redact';
  if (/line|paragraph|text list|add text|font|ocr|scan/.test(value)) return 'edit_text';
  if (/merge|split|insert|duplicate|layers/.test(value)) return 'merge';
  if (/search|fit|grid|thumbnails|preview|info|help|view/.test(value)) return 'view';
  // Slug the label so unknown options still hash into varied families instead of amber.
  return value.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'view';
}

// One hue per kind of job, so a tool reads by colour before its label. `light`/`dark` are glyph and text inks
// for each theme; tiles are a soft wash of the same ink so a screen full of tools stays easy on the eyes.
const families = [
  { name: 'text', vivid: ['#7B4DF2', '#A98BFF'], light: '#6B4FC4', dark: '#C3B2F5',
    ids: ['edit_text', 'text', 'replace_text', 'rename', 'extract_text', 'ocr', 'edit', 'notes', 'subject', 'description', 'comment', 'speech', 'text-fields', 'short-text', 'format-align-left', 'find-replace', 'find-in-page'] },
  { name: 'organize', vivid: ['#16A463', '#3FD08C'], light: '#1E8A63', dark: '#86D9B5',
    ids: ['crop', 'resize', 'social', 'extract', 'split', 'to_image', 'trim', 'straighten', 'frame', 'splitscreen', 'crop-din', 'photo-size-select-large'] },
  { name: 'turn', vivid: ['#1E88E5', '#5AB2FF'], light: '#1F7AB8', dark: '#8CC7EE',
    ids: ['rotate', 'flip', 'flip_h', 'flip_v', 'perspective', 'reorder', 'orientation', 'transform', 'sort', 'undo', 'redo', 'restart-alt', 'rotate-left', 'rotate-right', 'swap-horiz', 'swap-vert'] },
  { name: 'adjust', vivid: ['#F29D00', '#FFC042'], light: '#A9650F', dark: '#F2C477',
    ids: ['adjust', 'brightness', 'exposure', 'temperature', 'numbers', 'number', 'tune', 'levels', 'curves', 'gamma', 'warmth', 'light-mode', 'dark-mode', 'contrast-mode', 'palette'] },
  { name: 'creative', vivid: ['#E8457C', '#FF7EA8'], light: '#C2457A', dark: '#F2A6C6',
    ids: ['contrast', 'saturation', 'filters', 'sharpen', 'blur', 'draw', 'shapes', 'hue', 'hsl', 'vivid', 'brush', 'marker', 'pen', 'pencil', 'eraser', 'gesture', 'category', 'auto-fix-normal'] },
  { name: 'shrink', vivid: ['#00A2B8', '#35CDE0'], light: '#1A8396', dark: '#86D5E2',
    ids: ['compress', 'compress_img', 'compress_pdf', 'batch_compress', 'batch', 'merge', 'merge_pdf', 'duplicate', 'insert', 'canvas', 'layers', 'collections', 'storage', 'folder', 'archive', 'content-copy', 'note-add', 'file-copy', 'library-books'] },
  { name: 'protect', vivid: ['#E53935', '#FF6B6B'], light: '#C8434F', dark: '#F4A3AA',
    ids: ['redact', 'remove_text', 'delete', 'remove', 'protect', 'metadata', 'lock', 'security', 'privacy', 'flatten', 'warning', 'history', 'delete-sweep', 'delete-outline'] },
  { name: 'sign', vivid: ['#F26B1D', '#FF9A55'], light: '#C25E22', dark: '#F5B48A',
    ids: ['watermark', 'sign', 'add_image', 'highlight', 'highlighter', 'stamp', 'draw-signature', 'repair', 'branding-watermark'] },
  { name: 'convert', vivid: ['#2F6BFF', '#6F9CFF'], light: '#3462C8', dark: '#9DB8F5',
    ids: ['export', 'convert', 'pdf', 'save', 'share', 'from_image', 'scan', 'pdf_scan', 'image', 'open', 'download', 'ios-share', 'picture-as-pdf', 'add-photo-alternate'] },
  { name: 'view', vivid: ['#5A5FE6', '#9196FF'], light: '#5150C2', dark: '#AEB0F5',
    ids: ['search', 'fit', 'focus', 'thumbnails', 'scroll', 'layout', 'direction', 'view', 'viewer', 'visibility', 'fullscreen', 'info', 'help', 'settings', 'grid-view', 'handyman', 'fit-screen', 'bookmark', 'reading', 'more-vert', 'close', 'keyboard-arrow-up', 'keyboard-arrow-down'] },
];

function familyOf(id: string) {
  const known = families.find(item => item.ids.includes(id));
  if (known) return known;
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return families[Math.abs(hash) % families.length];
}

const fills = new Map<string, ViewStyle>();
/** A soft diagonal wash of `ink`, cached per colour. */
export function softFill(ink: string, dark: boolean) {
  const key = `${ink}:${dark}`;
  let fill = fills.get(key);
  if (!fill) {
    fill = gradient(dark ? `linear-gradient(135deg, ${ink}33 0%, ${ink}1A 100%)` : `linear-gradient(135deg, ${ink}14 0%, ${ink}29 100%)`);
    fills.set(key, fill);
  }
  return fill;
}

/**
 * Colours for a tool or option id. `fill` + `glyph` make the icon tile; `ink` + `surface` tint text, outlines and
 * selected states. `vivid` is the saturated glyph colour for white app-style tiles.
 * Unknown ids get a stable family, so no tool falls back to grey.
 */
export function toolColors(id: string, colors: Palette) {
  const dark = colors.systemBackground === '#000000';
  const ink = familyOf(id)[dark ? 'dark' : 'light'];
  const family = familyOf(id);
  return { ink, surface: `${ink}${dark ? '24' : '14'}`, fill: softFill(ink, dark), glyph: ink, vivid: family.vivid[dark ? 1 : 0] };
}

/** The "All tools" tile: a gentle sweep through the tool hues. */
export function allToolsColors(colors: Palette) {
  const dark = colors.systemBackground === '#000000';
  const [violet, pink, amber] = dark ? ['#C3B2F5', '#F2A6C6', '#F2C477'] : ['#6B4FC4', '#C2457A', '#A9650F'];
  const alpha = dark ? '33' : '24';
  return { fill: gradient(`linear-gradient(135deg, ${violet}${alpha} 0%, ${pink}${alpha} 55%, ${amber}${alpha} 100%)`), glyph: violet };
}

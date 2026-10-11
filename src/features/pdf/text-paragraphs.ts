import type { PdfTextObject } from './pdf-edit-canvas';

type Bounds = { x: number; y: number; width: number; height: number };
/**
 * Text pieces that read as one paragraph. Geometry is in page points unless noted:
 * `wrap` is the width later lines fill (0 keeps a single line unwrapped), `hang` how far later lines start
 * right of the first, and `lineHeight` the baseline distance.
 */
export type TextParagraph = {
  id: number;
  members: number[];
  /** Source text of each member, for stale-text checks. */
  sources: Record<number, string>;
  /** Members in reading order with the separator written before each. */
  parts: { id: number; before: string }[];
  text: string;
  /**
   * Normalised outline and the normalised frame (left, top, width) the on-page editor wraps in. `baseline` is the first
   * line's baseline and `sample` the widest line with its width on the page, so typed text can match the PDF's metrics.
   */
  bounds: Bounds;
  box: { x: number; y: number; width: number; baseline?: number; sample?: { text: string; width: number; size: number } };
  size: number; font?: string; color?: number;
  lineHeight: number; wrap: number; hang: number;
};

/** `x` and `base` are the baseline origin in points, when the native build reports it. */
type Item = { object: PdfTextObject; l: number; r: number; t: number; b: number; size: number; x?: number; base?: number };
type Line = { items: Item[]; l: number; r: number; t: number; b: number; size: number; center: number; base?: number };

const BULLET = /^\s*([•●▪◦‣∙·*\-–—]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s/;
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const separator = (before: string, after: string, gap: number, size: number) =>
  /\s$/.test(before) || /^\s/.test(after) || gap <= size * 0.12 ? '' : ' ';

function lineOf(items: Item[]): Line {
  const l = Math.min(...items.map(item => item.l)), r = Math.max(...items.map(item => item.r));
  const t = Math.min(...items.map(item => item.t)), b = Math.max(...items.map(item => item.b));
  const bases = items.flatMap(item => item.base === undefined ? [] : [item.base]);
  return { items, l, r, t, b, size: median(items.map(item => item.size)), center: (t + b) / 2, base: bases.length === items.length ? median(bases) : undefined };
}

/** The line's pieces joined the way the paragraph text joins them. */
function lineText(line: Line) {
  return line.items.map((item, index) => (index ? separator(line.items[index - 1].object.text, item.object.text, item.l - line.items[index - 1].r, item.size) : '') + item.object.text).join('');
}

/** Rows of pieces that share a baseline, split where a wide gap separates columns. */
function linesOf(items: Item[]) {
  const rows: Item[][] = [];
  for (const item of [...items].sort((a, b) => a.t - b.t || a.l - b.l)) {
    const height = item.b - item.t;
    const row = rows.slice(-6).reverse().find(candidate => {
      const line = lineOf(candidate);
      const overlap = Math.min(line.b, item.b) - Math.max(line.t, item.t);
      const ratio = item.size / line.size;
      return overlap >= 0.5 * Math.min(height, line.b - line.t) && ratio > 0.7 && ratio < 1.43;
    });
    if (row) row.push(item); else rows.push([item]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.l - b.l);
    let current: Item[] = [];
    for (const item of row) {
      const previous = current.at(-1);
      if (previous && item.l - previous.r > 2.5 * Math.max(previous.size, item.size)) { lines.push(lineOf(current)); current = []; }
      current.push(item);
    }
    if (current.length) lines.push(lineOf(current));
  }
  return lines.sort((a, b) => a.t - b.t || a.l - b.l);
}

/** Whether `line` continues `paragraph`: same style, regular spacing, aligned edges, and no list marker or short line in between. */
function continues(paragraph: Line[], line: Line) {
  const first = paragraph[0], last = paragraph.at(-1)!;
  const size = first.size;
  const ratio = line.size / size;
  if (ratio < 0.85 || ratio > 1.18) return false;
  const lead = first.items[0].object.font, next = line.items[0].object.font;
  if (lead && next && lead !== next) return false;
  if (BULLET.test(line.items[0].object.text)) return false;
  const gap = line.center - last.center;
  if (gap < 0.6 * size || gap > 1.8 * size) return false;
  const left = Math.min(...paragraph.map(item => item.l)), right = Math.max(...paragraph.map(item => item.r));
  if (Math.min(right, line.r) - Math.max(left, line.l) < 0.3 * Math.min(right - left, line.r - line.l)) return false;
  if (paragraph.length > 1) {
    const step = (last.center - first.center) / (paragraph.length - 1);
    if (Math.abs(gap - step) > 0.2 * step + 0.5) return false;
    const restLeft = Math.min(...paragraph.slice(1).map(item => item.l));
    if (Math.abs(line.l - restLeft) > 0.6 * size) return false;
    // A clearly short line ended the previous paragraph.
    if (last.r < right - 0.25 * (right - restLeft)) return false;
    return true;
  }
  const indent = first.l - line.l;
  return Math.abs(indent) <= 0.6 * size || (indent > 0 && indent <= 6 * size) || (BULLET.test(first.items[0].object.text) && indent < 0 && indent >= -4 * size);
}

/**
 * Groups editable text pieces into paragraphs, like desktop PDF editors build text blocks.
 * Rotated or vertical pieces are left out so they keep line-by-line editing.
 */
export function groupParagraphs(objects: PdfTextObject[], pointWidth: number, pointHeight: number): TextParagraph[] {
  const items: Item[] = [];
  for (const object of objects) {
    const box = object.bounds;
    if (!box || !object.editable || !object.text.trim()) continue;
    const origin = object.origin;
    const item: Item = { object, l: box.x * pointWidth, r: (box.x + box.width) * pointWidth, t: box.y * pointHeight, b: (box.y + box.height) * pointHeight, size: object.size || box.height * pointHeight };
    // A baseline outside the glyph box means a transform this layout cannot follow.
    if (origin && origin.y * pointHeight >= item.t - item.size && origin.y * pointHeight <= item.b + item.size) { item.x = origin.x * pointWidth; item.base = origin.y * pointHeight; }
    if (item.b - item.t > 2.2 * item.size && item.r - item.l < item.b - item.t) continue;
    items.push(item);
  }
  const groups: Line[][] = [];
  for (const line of linesOf(items)) {
    const candidates = groups.slice(-30).filter(group => continues(group, line));
    const best = candidates.sort((a, b) => (line.center - a.at(-1)!.center) - (line.center - b.at(-1)!.center))[0];
    if (best) best.push(line); else groups.push([line]);
  }
  return groups.map(lines => {
    const first = lines[0];
    const lead = first.items[0];
    const size = lead.size;
    const firstLeft = first.l;
    const restLeft = lines.length > 1 ? Math.min(...lines.slice(1).map(line => line.l)) : firstLeft;
    const left = Math.min(firstLeft, restLeft), right = Math.max(...lines.map(line => line.r));
    const top = Math.min(...lines.map(line => line.t)), bottom = Math.max(...lines.map(line => line.b));
    const parts: TextParagraph['parts'] = [];
    let previous = '';
    // Lines join with a space; a word hyphenated at the line end keeps its hyphen and joins directly.
    for (const line of lines) line.items.forEach((item, position) => {
      const text = item.object.text;
      const before = !parts.length ? ''
        : position > 0 ? separator(previous, text, item.l - line.items[position - 1].r, size)
        : /\S-$/.test(previous) || /\s$/.test(previous) ? '' : ' ';
      parts.push({ id: item.object.id, before });
      previous = text;
    });
    const sources = Object.fromEntries(lines.flatMap(line => line.items.map(item => [item.object.id, item.object.text])));
    const multiline = lines.length > 1;
    const based = lines.every(line => line.base !== undefined);
    // Glyph boxes start after the side bearing; the pen starts at the baseline origin.
    const start = (line: Line) => Math.min(line.l, line.items[0].x ?? line.l);
    const x = based ? Math.min(...lines.map(start)) : left;
    // Single lines keep growing to the right like before; paragraphs wrap at their own width.
    const width = multiline ? right - x + 0.25 * size : Math.max(right - x, pointWidth * 0.96 - x);
    const widest = lines.reduce((best, line) => line.r - start(line) > best.r - start(best) ? line : best);
    const sample = based ? { text: lineText(widest), width: (widest.r - start(widest)) / pointWidth, size: widest.size } : undefined;
    const bases = lines.map(line => line.base ?? line.center);
    return {
      id: lead.object.id,
      members: parts.map(part => part.id),
      sources, parts,
      text: parts.map(part => part.before + sources[part.id]).join('').trim(),
      bounds: { x: left / pointWidth, y: top / pointHeight, width: (right - left) / pointWidth, height: (bottom - top) / pointHeight },
      box: { x: x / pointWidth, y: top / pointHeight, width: Math.max(1, width) / pointWidth, ...(based ? { baseline: first.base! / pointHeight, sample } : {}) },
      size, font: lead.object.font, color: lead.object.color,
      lineHeight: multiline ? median(bases.slice(1).map((base, index) => base - bases[index])) : 1.2 * size,
      wrap: multiline ? right - restLeft + 0.25 * size : 0,
      hang: multiline ? restLeft - firstLeft : 0,
    };
  });
}

/** The paragraph's text with earlier line-by-line edits applied; removed pieces drop out with their separator. */
export function paragraphText(paragraph: TextParagraph, current: (id: number) => string | null) {
  return paragraph.parts.map(part => { const text = current(part.id); return text ? part.before + text : ''; }).join('').replace(/^\s+/, '');
}

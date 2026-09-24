import type { PdfRange } from '../../../modules/pdf-engine';

export type SplitMode = 'each' | 'groups' | 'ranges';
export function splitRanges(pageCount: number, mode: SplitMode, groupSize: string, custom: string): PdfRange[] {
  let ranges: PdfRange[];
  if (mode === 'ranges') {
    const parts = custom.trim().split(',');
    if (!custom.trim() || parts.length > 100) throw new Error('Enter up to 100 comma-separated ranges, for example 1-3, 4-8.');
    ranges = parts.map(part => {
      const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim());
      if (!match) throw new Error('Use page numbers or ranges separated by commas, for example 1-3, 4, 5-8.');
      return { start: Number(match[1]), end: Number(match[2] ?? match[1]) };
    });
  } else {
    const size = mode === 'each' ? 1 : /^\d+$/.test(groupSize.trim()) ? Number(groupSize) : 0;
    if (!Number.isSafeInteger(size) || size < 1 || size > pageCount) throw new Error(`Enter a group size from 1 to ${pageCount}.`);
    if (Math.ceil(pageCount / size) > 100) throw new Error('Use larger groups to create no more than 100 PDFs at once.');
    ranges = Array.from({ length: Math.ceil(pageCount / size) }, (_, index) => ({ start: index * size + 1, end: Math.min(pageCount, (index + 1) * size) }));
  }
  if (ranges.some(range => !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 1 || range.end < range.start || range.end > pageCount)) throw new Error(`Each range must run forwards between pages 1 and ${pageCount}.`);
  if (ranges.reduce((total, range) => total + range.end - range.start + 1, 0) > 2000) throw new Error('Choose no more than 2,000 output pages per operation.');
  return ranges;
}

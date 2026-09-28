import { useRef, useState } from 'react';
import type { PdfMark, PdfMarkChange } from '../../../modules/pdf-engine/src/PdfMarkupView';

type Change = { before?: PdfMark; after?: PdfMark; index: number; label: string };
export type MarkHistorySnapshot = { marks: PdfMark[]; past: Change[]; future: Change[] };
const empty = (): MarkHistorySnapshot => ({ marks: [], past: [], future: [] });
const identifier = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const sameMark = (a: PdfMark | undefined, b: PdfMark | undefined) => a === b || (!!a && !!b
  && a.id === b.id && a.page === b.page && a.kind === b.kind && a.color === b.color && a.fillColor === b.fillColor
  && a.imageUri === b.imageUri && a.pixelPath === b.pixelPath && a.backgroundRemoved === b.backgroundRemoved
  && a.width === b.width && a.opacity === b.opacity && a.pattern === b.pattern && a.brush === b.brush
  && (a.points === b.points || (a.points.length === b.points.length && a.points.every((point, index) => point[0] === b.points[index][0] && point[1] === b.points[index][1]))));
const replace = (marks: PdfMark[], id: string, mark: PdfMark | undefined, at: number): PdfMark[] => {
  const index = marks.findIndex(item => item.id === id);
  if (!mark) return marks.filter(item => item.id !== id);
  if (index >= 0) return marks.map((item, i) => i === index ? mark : item);
  const next = [...marks]; next.splice(Math.max(0, Math.min(at, next.length)), 0, mark); return next;
};
function validMark(value: unknown): value is PdfMark {
  if (!value || typeof value !== 'object') return false;
  const mark = value as PdfMark;
  return Number.isInteger(mark.page) && mark.page > 0 && Number.isFinite(mark.width) && mark.width > 0 && mark.width <= .1
    && ['draw', 'sign', 'line', 'polygon', 'highlight', 'highlight-brush', 'redact', 'image'].includes(mark.kind)
    && (mark.kind !== 'image' || ([mark.imageUri, mark.pixelPath, mark.originalImageUri, mark.originalPixelPath, mark.cleanImageUri, mark.cleanPixelPath].every(path => typeof path === 'string' && path.length > 0 && path.length < 4096) && mark.points?.length === 2))
    && typeof mark.color === 'string' && /^#[\da-f]{6}$/i.test(mark.color)
    && (mark.fillColor === undefined || mark.fillColor === '' || (typeof mark.fillColor === 'string' && /^#[\da-f]{6}$/i.test(mark.fillColor)))
    && (mark.id === undefined || (typeof mark.id === 'string' && mark.id.length > 0 && mark.id.length <= 128))
    && (mark.opacity === undefined || (Number.isFinite(mark.opacity) && mark.opacity >= .01 && mark.opacity <= 1))
    && (mark.pattern === undefined || ['solid', 'dashed', 'dotted'].includes(mark.pattern))
    && (mark.brush === undefined || ['pen', 'pencil', 'marker', 'highlighter'].includes(mark.brush))
    && Array.isArray(mark.points) && mark.points.length >= 2 && mark.points.length <= 4096
    && mark.points.every(point => Array.isArray(point) && point.length === 2 && point.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1));
}
const boundedMarks = (marks: PdfMark[]) => marks.length <= 300 && marks.reduce((sum, mark) => sum + mark.points.length, 0) <= 20000;
/** Validate both the payload bounds and that every stored delta can actually be replayed. */
export function isMarkHistorySnapshot(value: unknown): value is MarkHistorySnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as MarkHistorySnapshot;
  if (!Array.isArray(candidate.marks) || !Array.isArray(candidate.past) || !Array.isArray(candidate.future) || candidate.past.length > 40 || candidate.future.length > 40) return false;
  if (!candidate.marks.every(mark => validMark(mark) && !!mark.id) || !boundedMarks(candidate.marks) || new Set(candidate.marks.map(mark => mark.id)).size !== candidate.marks.length) return false;
  let points = candidate.marks.reduce((sum, mark) => sum + mark.points.length, 0);
  for (const change of [...candidate.past, ...candidate.future]) {
    if (!change || !Number.isInteger(change.index) || change.index < 0 || change.index > 300 || typeof change.label !== 'string' || change.label.length > 100 || (!change.before && !change.after)) return false;
    if ((change.before && (!validMark(change.before) || !change.before.id)) || (change.after && (!validMark(change.after) || !change.after.id))) return false;
    if (change.before && change.after && change.before.id !== change.after.id) return false;
    points += (change.before?.points.length ?? 0) + (change.after?.points.length ?? 0);
    if (points > 150000) return false;
  }
  function replay(changes: Change[], undo: boolean) {
    let marks = candidate.marks;
    for (const change of [...changes].reverse()) {
      const expected = undo ? change.after : change.before, replacement = undo ? change.before : change.after;
      const id = (change.before?.id ?? change.after?.id)!;
      if (!sameMark(marks.find(mark => mark.id === id), expected)) return false;
      marks = replace(marks, id, replacement, change.index);
      if (!boundedMarks(marks)) return false;
    }
    return true;
  }
  return replay(candidate.past, true) && replay(candidate.future, false);
}

/** A mark delta per action; no bitmap copies. Deletion undo retains the original layer order. */
export function useMarkHistory() {
  const [state, setState] = useState<MarkHistorySnapshot>(empty);
  const latest = useRef(state);
  const lastStyle = useRef<{ id: string; keys: string; time: number } | null>(null);
  function publish(next: MarkHistorySnapshot) { lastStyle.current = null; latest.current = next; setState(next); }
  function record(before: PdfMark | undefined, after: PdfMark | undefined, index: number, label: string) {
    const current = latest.current;
    if (sameMark(before, after)) return;
    const id = after?.id ?? before?.id;
    if (!id) return;
    publish({ marks: replace(current.marks, id, after, index), past: [...current.past.slice(-39), { before, after, index, label }], future: [] });
  }
  function commit(mark: PdfMarkChange) {
    if ('deleted' in mark) { remove(mark.id); return; }
    const after = { ...mark, id: mark.id ?? identifier() };
    const index = latest.current.marks.findIndex(item => item.id === after.id);
    record(index >= 0 ? latest.current.marks[index] : undefined, after, index >= 0 ? index : latest.current.marks.length, index >= 0 ? 'Change mark' : 'Add mark');
  }
  function remove(id: string) {
    const index = latest.current.marks.findIndex(item => item.id === id);
    if (index >= 0) record(latest.current.marks[index], undefined, index, 'Delete mark');
  }
  function update(id: string, patch: Partial<PdfMark>) {
    const current = latest.current, index = current.marks.findIndex(item => item.id === id);
    if (index < 0) return;
    const before = current.marks[index], after = { ...before, ...patch, id };
    if (sameMark(before, after)) return;
    const time = Date.now(), keys = Object.keys(patch).sort().join(','), previous = lastStyle.current, change = current.past.at(-1);
    if (previous?.id === id && previous.keys === keys && time - previous.time <= 450 && !current.future.length && change?.after?.id === id && change.label === 'Change mark style') {
      const past = sameMark(change.before, after) ? current.past.slice(0, -1) : [...current.past.slice(0, -1), { ...change, after }];
      publish({ marks: replace(current.marks, id, after, index), past, future: [] });
    } else record(before, after, index, 'Change mark style');
    lastStyle.current = { id, keys, time };
  }
  function duplicate(id: string) {
    const source = latest.current.marks.find(item => item.id === id);
    if (!source || latest.current.marks.length >= 300 || latest.current.marks.reduce((sum, mark) => sum + mark.points.length, 0) + source.points.length > 20000) return undefined;
    const xs = source.points.map(point => point[0]), ys = source.points.map(point => point[1]);
    const offset = (values: number[]) => Math.max(...values) <= .98 ? .02 : Math.min(...values) >= .02 ? -.02 : 0;
    const dx = offset(xs), dy = offset(ys);
    const copy: PdfMark = { ...source, id: identifier(), points: source.points.map(([x, y]) => [x + dx, y + dy]) };
    record(undefined, copy, latest.current.marks.length, 'Duplicate mark'); return copy.id;
  }
  function undo() {
    const current = latest.current, change = current.past.at(-1); if (!change) return;
    const id = change.before?.id ?? change.after?.id; if (!id) return;
    publish({ marks: replace(current.marks, id, change.before, change.index), past: current.past.slice(0, -1), future: [...current.future, change] });
    return change.before?.page ?? change.after?.page;
  }
  function redo() {
    const current = latest.current, change = current.future.at(-1); if (!change) return;
    const id = change.after?.id ?? change.before?.id; if (!id) return;
    publish({ marks: replace(current.marks, id, change.after, change.index), past: [...current.past.slice(-39), change], future: current.future.slice(0, -1) });
    return change.after?.page ?? change.before?.page;
  }
  function restore(marks: PdfMark[]) {
    // A persisted draft is input, not a trusted native canvas payload.
    let points = 0;
    const ids = new Set<string>();
    const restored = marks.slice(0, 300).filter(mark => {
      if (!validMark(mark)) return false;
      if (points + mark.points.length > 20000) return false;
      points += mark.points.length; return true;
    }).map(mark => {
      const id = typeof mark.id === 'string' && !ids.has(mark.id) ? mark.id : identifier(); ids.add(id);
      return { ...mark, id, width: Math.min(.1, mark.width), ...(mark.opacity !== undefined ? { opacity: Number.isFinite(mark.opacity) ? Math.max(.01, Math.min(1, mark.opacity)) : undefined } : {}) };
    });
    publish({ marks: restored, past: [], future: [] });
  }
  function restoreSnapshot(snapshot: unknown) {
    if (!isMarkHistorySnapshot(snapshot)) {
      const marks = snapshot && typeof snapshot === 'object' && 'marks' in snapshot ? snapshot.marks : [];
      restore(Array.isArray(marks) ? marks : []); return false;
    }
    publish({ marks: snapshot.marks, past: snapshot.past, future: snapshot.future }); return true;
  }
  return { marks: state.marks, snapshot: state, canUndo: !!state.past.length, canRedo: !!state.future.length, commit, remove, update, duplicate, undo, redo, restore, restoreSnapshot, clear: () => publish(empty()) };
}

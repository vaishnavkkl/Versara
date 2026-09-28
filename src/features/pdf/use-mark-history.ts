import { useState } from 'react';
import type { PdfMark } from '../../../modules/pdf-engine/src/PdfMarkupView';
type Change = { before?: PdfMark; after: PdfMark };
/** Store changed marks only, not a full copy of the drawing for every gesture. */
export function useMarkHistory() {
  const [state, setState] = useState<{ marks: PdfMark[]; past: Change[]; future: Change[] }>({ marks: [], past: [], future: [] });
  const replace = (marks: PdfMark[], mark: PdfMark) => {
    const index = marks.findIndex(item => item.id === mark.id);
    return index < 0 ? [...marks, mark] : marks.map((item, i) => i === index ? mark : item);
  };
  function commit(mark: PdfMark) {
    const after = { ...mark, id: mark.id ?? `${Date.now()}-${Math.random()}` };
    setState(current => {
      const before = current.marks.find(item => item.id === after.id);
      if (before && JSON.stringify(before) === JSON.stringify(after)) return current;
      return { marks: replace(current.marks, after), past: [...current.past.slice(-39), { before, after }], future: [] };
    });
  }
  function undo() {
    const change = state.past.at(-1); if (!change) return;
    setState(current => ({ marks: change.before ? replace(current.marks, change.before) : current.marks.filter(item => item.id !== change.after.id), past: current.past.slice(0, -1), future: [...current.future, change] }));
    return change.after.page;
  }
  function redo() {
    const change = state.future.at(-1); if (!change) return;
    setState(current => ({ marks: replace(current.marks, change.after), past: [...current.past, change], future: current.future.slice(0, -1) }));
    return change.after.page;
  }
  return { marks: state.marks, canUndo: !!state.past.length, canRedo: !!state.future.length, commit, undo, redo, clear: () => setState({ marks: [], past: [], future: [] }) };
}

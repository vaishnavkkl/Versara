import { useRef, useState, type SetStateAction } from 'react';

/** Coalesces rapid slider samples into one undo step; never stores native images. */
export function useEditHistory<T>(initial: T) {
  const [state, setState] = useState({ present: initial, past: [] as T[], future: [] as T[], revision: 0 });
  const latest = useRef(state);
  function publish(next: typeof state) { latest.current = next; setState(next); }
  const last = useRef({ group: '', time: 0 });
  function update(next: SetStateAction<T>, group = '') {
    const current = latest.current;
    const present = typeof next === 'function' ? (next as (value: T) => T)(current.present) : next;
    if (JSON.stringify(present) === JSON.stringify(current.present)) return;
    const time = Date.now();
    const merge = !!group && last.current.group === group && time - last.current.time < 450;
    last.current = { group, time };
    publish({ revision: current.revision, present, past: merge ? current.past : [...current.past.slice(-29), current.present], future: [] });
  }
  function undo() { last.current.group = ''; const current = latest.current; if (current.past.length) publish({ revision: current.revision + 1, present: current.past.at(-1)!, past: current.past.slice(0, -1), future: [...current.future, current.present] }); return latest.current.present; }
  function redo() { last.current.group = ''; const current = latest.current; if (current.future.length) publish({ revision: current.revision + 1, present: current.future.at(-1)!, past: [...current.past, current.present], future: current.future.slice(0, -1) }); return latest.current.present; }
  function restore(present: T) { last.current.group = ''; publish({ present, past: [], future: [], revision: latest.current.revision + 1 }); }
  // Event handlers can save immediately after a native slider update, before React commits.
  function getCurrent() { return latest.current.present; }
  return { value: state.present, revision: state.revision, getCurrent, update, undo, redo, restore, canUndo: !!state.past.length, canRedo: !!state.future.length };
}

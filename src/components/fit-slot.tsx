import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ToolRowButton } from './tool-action-row';

type FitAction = { onFit: () => void };

let slot: FitAction | null = null;
let buttons = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A preview publishes its Fit page action here; the tool's action row shows it as its first left button.
 * Returns whether a row button is mounted, so the preview keeps its floating button only when there is none.
 */
export function usePublishFit(onFit: (() => void) | undefined) {
  const latest = useRef(onFit);
  useEffect(() => { latest.current = onFit; });
  const enabled = !!onFit;
  useEffect(() => {
    if (!enabled) return;
    const action: FitAction = { onFit: () => latest.current?.() };
    slot = action;
    emit();
    return () => { if (slot === action) { slot = null; emit(); } };
  }, [enabled]);
  return useSyncExternalStore(subscribe, () => buttons > 0, () => false);
}

/** Fit page button for an action row; renders nothing until a preview publishes its action. */
export function FitSlotButton() {
  useEffect(() => {
    buttons += 1; emit();
    return () => { buttons -= 1; emit(); };
  }, []);
  const action = useSyncExternalStore(subscribe, () => slot, () => null);
  if (!action) return null;
  return <ToolRowButton label="Fit page" icon={{ ios: 'arrow.down.right.and.arrow.up.left', android: 'fit-screen' }} onPress={action.onFit} />;
}

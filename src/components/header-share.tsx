import { useEffect, useRef, useSyncExternalStore } from 'react';

export type HeaderShareAction = { onPress: () => unknown; disabled?: boolean; label?: string };
export type HeaderActions = HeaderShareAction & { save?: HeaderShareAction };
type SaveOptions = { onSave: () => unknown; disabled?: boolean; label?: string };

let slot: HeaderActions | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The share and save actions published by the open tool, shown on the right of the screen header. */
export function useHeaderShare() {
  return useSyncExternalStore(subscribe, () => slot, () => null);
}

/** Registers what the header share button sends, and optionally what the header save button runs. */
export function usePublishHeaderShare({ active = true, disabled = false, label = 'Share PDF', onShare, save }: {
  active?: boolean; disabled?: boolean; label?: string; onShare: () => unknown; save?: SaveOptions;
}) {
  const share = useRef(onShare);
  const saveAction = useRef(save?.onSave);
  useEffect(() => { share.current = onShare; saveAction.current = save?.onSave; });
  const hasSave = !!save, saveDisabled = !!save?.disabled, saveLabel = save?.label ?? 'Save';
  useEffect(() => {
    if (!active) { slot = null; emit(); return; }
    slot = { disabled, label, onPress: () => share.current(),
      save: hasSave ? { disabled: saveDisabled, label: saveLabel, onPress: () => saveAction.current?.() } : undefined };
    emit();
    return () => { slot = null; emit(); };
  }, [active, disabled, label, hasSave, saveDisabled, saveLabel]);
}

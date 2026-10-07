import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { draftSource, readEditorDraft, removeEditorDraft, writeEditorDraft, discardEditorDraft } from './editor-drafts';

/** Small edit commands only. Native views/bitmaps/passwords never enter this store. */
export function useEditorDraft<T>({ id, uri, value, dirty, restore, validate }: {
  id: string | null; uri?: string; value: T; dirty: boolean; restore: (value: T) => void; validate: (value: unknown) => value is T;
}) {
  const source = useMemo(() => uri ? draftSource(uri) : '', [uri]);
  const token = id && source ? `${id}|${source}` : '';
  const [ready, setReady] = useState('');
  const [error, setError] = useState('');
  const latest = useRef({ value, dirty, restore, validate });
  useLayoutEffect(() => { latest.current = { value, dirty, restore, validate }; });
  const skipped = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef('');
  const hasDraft = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    let current = true;
    hydrated.current = ''; skipped.current = null; hasDraft.current = false;
    if (!id || !token) return;
    const finish = () => { if (current) { hydrated.current = token; setReady(token); } };
    void readEditorDraft<unknown>(id, source).then(saved => {
      if (!current) return;
      if (!saved || !latest.current.validate(saved)) { finish(); return; }
      // Back or a full dialog queue keeps the draft; only Start over deletes it.
      showDialog('Continue your draft?', 'This file has unsaved changes from last time.', [
        { text: 'Start over', style: 'destructive', onPress: () => { void removeEditorDraft(id).catch(() => undefined).finally(finish); } },
        { text: 'Continue', style: 'cancel', onPress: () => { if (!current) return; hasDraft.current = true; latest.current.restore(saved); toast('Restored your draft'); finish(); } },
      ], { ios: 'clock.arrow.circlepath', android: 'history' });
    }).catch(() => { if (current) { hydrated.current = token; setReady(token); setError('Draft recovery is unavailable. You can still save your file.'); } });
    return () => { current = false; };
  }, [id, source, token]);

  const persist = useRef(() => {});
  useLayoutEffect(() => { persist.current = () => {
    if (!id || !token || hydrated.current !== token) return;
    if (!latest.current.dirty) {
      if (hasDraft.current) { hasDraft.current = false; void removeEditorDraft(id).catch(() => { hasDraft.current = true; }); }
      return;
    }
    const current = latest.current.value;
    if (skipped.current === JSON.stringify(current)) return;
    hasDraft.current = true;
    void writeEditorDraft(id, source, current).catch(() => { if (mounted.current) setError('Could not autosave this draft. Use Save to keep your changes.'); });
  }; });
  useEffect(() => {
    if (ready !== token || !token) return;
    timer.current = setTimeout(() => { timer.current = null; persist.current(); }, 600);
    return () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  }, [value, dirty, ready, token]);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') persist.current(); });
    return () => { persist.current(); mounted.current = false; listener.remove(); };
  }, []);

  function clear(discard = false) {
    hasDraft.current = false;
    skipped.current = JSON.stringify(latest.current.value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return id ? (discard ? discardEditorDraft(id) : removeEditorDraft(id)) : Promise.resolve();
  }
  return { ready: !token || ready === token, error, clear, discard: () => clear(true) };
}

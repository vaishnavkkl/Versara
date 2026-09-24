import { useEffect, useEffectEvent, useRef } from 'react';
import type { LocalFile } from '../files/file-storage';
import type { InitialSelection } from './pdf-tool-session';

export function useInitialFiles(selection: InitialSelection | undefined, ready: boolean, open: (files: LocalFile[]) => Promise<void>) {
  const started = useRef(false);
  const openInitial = useEffectEvent(() => { if (selection) void open(selection.files); });
  useEffect(() => {
    if (!selection || !ready || started.current) return;
    started.current = true;
    openInitial();
  }, [selection, ready]);
}

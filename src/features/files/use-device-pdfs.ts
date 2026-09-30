import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { FileEngine } from '../../../modules/file-engine';
import { RECENT_LIMIT, type DeviceItem } from './recent-files';

export const hasNativePdfLibrary = !!(FileEngine?.nativeRecentPdfsVersion || FileEngine?.nativePdfLibraryVersion);
export const hasNativeDocumentLibrary = !!FileEngine?.nativeRecentDocumentsVersion;
export type DeviceListKind = 'pdf' | 'document';

type Cached = { access: boolean; items: DeviceItem[]; signature: string; loaded: number };
const cache = new Map<string, Cached>();
const REFRESH_AFTER_MS = 4000;

/**
 * Most recently modified device PDFs or documents from the native media index (Android) or the
 * chosen folders (iOS); nothing is scanned or indexed.
 */
export function useDevicePdfs(enabled: boolean, search: string, kind: DeviceListKind = 'pdf') {
  const supported = kind === 'pdf' ? hasNativePdfLibrary : hasNativeDocumentLibrary;
  const [access, setAccess] = useState(() => cache.get(`${kind}|`)?.access ?? false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DeviceItem[]>(() => cache.get(`${kind}|`)?.items ?? []);
  const forcedRevision = useRef(0);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    // Access may change in system Settings while the app is in the background.
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') setRevision(value => value + 1); });
    return () => subscription.remove();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !supported || !FileEngine) return;
    const engine = FileEngine;
    const key = `${kind}|${search.trim()}`;
    const cached = cache.get(key);
    const forced = forcedRevision.current !== revision;
    forcedRevision.current = revision;
    // Returning to the tab shows the last list at once; the media index is asked again only when stale.
    const fresh = !!cached && !forced && Date.now() - cached.loaded < REFRESH_AFTER_MS;
    let current = true;
    const timer = setTimeout(() => {
      if (cached) { setAccess(cached.access); setItems(value => value === cached.items ? value : cached.items); }
      if (fresh) return;
      setLoading(true);
      void engine.getPdfAccessAsync().then(async result => {
        if (!current) return;
        setAccess(result.granted);
        if (!result.granted) { cache.set(key, { access: false, items: [], signature: '', loaded: Date.now() }); setItems([]); return; }
        // Builds from before the recent-PDF query read the existing index instead.
        const recent = kind === 'document' ? await engine.listRecentDocuments(RECENT_LIMIT, search)
          : engine.nativeRecentPdfsVersion ? await engine.listRecentPdfs(RECENT_LIMIT, search) : (await engine.listPdfPage(0, RECENT_LIMIT, search)).items;
        if (!current) return;
        setError('');
        const mapped: DeviceItem[] = recent.map(item => ({ ...item, kind, opened: item.modified }));
        const signature = mapped.map(item => `${item.uri}:${item.opened}:${item.size}`).join('|');
        const previous = cache.get(key);
        const next = previous?.signature === signature ? previous.items : mapped;
        cache.delete(key); cache.set(key, { access: true, items: next, signature, loaded: Date.now() });
        if (cache.size > 8) cache.delete(cache.keys().next().value!);
        setItems(next);
      }).catch(cause => { if (current) setError((cause as Error).message || `Could not load recent device ${kind === 'pdf' ? 'PDFs' : 'documents'}.`); })
        .finally(() => { if (current) setLoading(false); });
    }, search ? 180 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [enabled, supported, search, revision, kind]);

  return { access, loading, items, error, refresh: () => setRevision(value => value + 1) };
}

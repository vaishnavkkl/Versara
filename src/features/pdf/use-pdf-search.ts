import { useCallback, useEffect, useRef, useState } from 'react';
import { PdfEngine } from '../../../modules/pdf-engine';

export type PdfSearchMatch = { page: number; rects: number[][]; pdfRects: number[][] };
type Result = { matches: PdfSearchMatch[]; truncated: boolean; busy: boolean; error: string; query: string };
type Request = { uri: string; query: string; password: string; version: number };
const EMPTY: Result = { matches: [], truncated: false, busy: false, error: '', query: '' };
const requestKey = (uri: string, query: string) => `${uri}\u0000${query}`;

/** One native search plus one replaceable pending request; no document text enters JS. */
/** `password` opens a protected PDF; it is passed to the native engine only. */
export function usePdfSearch(uri: string | undefined, query: string, active: boolean, password = '') {
  const [result, setResult] = useState<Result & { key: string }>({ ...EMPTY, key: '' });
  const version = useRef(0);
  const pending = useRef<Request | null>(null);
  const running = useRef(false);
  const job = useRef<string | null>(null);
  const pump = useCallback(async () => {
    if (running.current || !PdfEngine) return;
    running.current = true;
    try {
      while (pending.current) {
        const request = pending.current;
        pending.current = null;
        if (request.version !== version.current) continue;
        const id = `search-${Date.now()}-${request.version}`;
        job.current = id;
        try {
          const response = JSON.parse(await PdfEngine.editPdfText(id, JSON.stringify({ action: 'search', uri: request.uri, query: request.query, ...(request.password ? { inputPassword: request.password } : {}) }))) as { matches: PdfSearchMatch[]; truncated: boolean };
          if (request.version === version.current) setResult({ ...response, busy: false, error: '', query: request.query, key: requestKey(request.uri, request.query) });
        } catch (error) {
          if (request.version === version.current) setResult({ ...EMPTY, key: requestKey(request.uri, request.query), query: request.query, error: (error as Error).message || 'This PDF could not be searched.' });
        } finally { if (job.current === id) job.current = null; }
      }
    } finally { running.current = false; }
  }, []);
  useEffect(() => {
    const current = ++version.current;
    pending.current = null;
    if (job.current) PdfEngine?.cancelTextEdit(job.current);
    const text = query.trim();
    if (!active || !uri || !text || !PdfEngine?.nativeReaderSearchVersion) return;
    const timer = setTimeout(() => {
      setResult({ ...EMPTY, key: requestKey(uri, text), query: text, busy: true });
      pending.current = { uri, query: text, password, version: current };
      void pump();
    }, 300);
    return () => {
      clearTimeout(timer);
      version.current = current + 1;
      pending.current = null;
      if (job.current) PdfEngine?.cancelTextEdit(job.current);
    };
  }, [uri, query, active, password, pump]);
  const text = query.trim();
  if (!active || !uri || !text || !PdfEngine?.nativeReaderSearchVersion) return EMPTY;
  return result.key === requestKey(uri, text) ? result : { ...EMPTY, busy: true };
}

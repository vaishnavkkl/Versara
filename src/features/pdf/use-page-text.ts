import { useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { PdfEngine } from '../../../modules/pdf-engine';

export type PageTextTool = 'extract_text' | 'ocr';
type Result = { key: string; text: string; error: string };

const MAX_CACHED = 24;
const cache = new Map<string, string>();
function remember(key: string, text: string) {
  cache.delete(key);
  cache.set(key, text);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

/**
 * Text of one page (1-based), read natively: the stored text for Extract Text, recognized text for OCR.
 * Runs only while `active`; a page change cancels the previous native job.
 */
export function usePageText(uri: string, page: number, tool: PageTextTool, active: boolean, password: () => string) {
  const key = `${tool}\u0000${uri}\u0000${page}`;
  const [result, setResult] = useState<Result>({ key: '', text: '', error: '' });
  const cached = cache.get(key);
  useEffect(() => {
    if (!active || cache.has(key) || !PdfEngine?.nativeAdvancedToolsVersion) return;
    let cancelled = false;
    const id = `page-text-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const output = new File(Paths.cache, `${id}.txt`);
    const timer = setTimeout(() => {
      void PdfEngine!.processPdf(id, JSON.stringify({ operation: tool, uri, inputPassword: password(), pages: [page], outputUris: [output.uri], ocrFormat: 'text', textPreview: true }))
        .then(() => output.text())
        .then(raw => {
          const text = raw.replace(/^--- Page \d+ ---\r?\n?/, '').trim();
          remember(key, text);
          if (!cancelled) setResult({ key, text, error: '' });
        })
        .catch((cause: Error) => { if (!cancelled) setResult({ key, text: '', error: cause.message || 'Could not read this page.' }); })
        .finally(() => { try { if (output.exists) output.delete(); } catch { /* The cache folder is cleared by the system. */ } });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); PdfEngine?.cancelPdfTool(id); };
    // `password` is read when the job starts; changing it alone should not re-run recognition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);
  if (cached !== undefined) return { text: cached, error: '', loading: false };
  if (result.key === key) return { text: result.text, error: result.error, loading: false };
  return { text: '', error: '', loading: active };
}

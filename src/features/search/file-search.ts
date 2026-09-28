import { FileEngine, type ExplorerEntry } from '../../../modules/file-engine';

type Request = { term: string; limit: number; cancelled: boolean; resolve: (files: ExplorerEntry[]) => void; reject: (cause: unknown) => void };
let running = false;
let waiting: Request | null = null;

/** Native search cannot be interrupted: keep only one scan and the newest waiting request. */
async function drain() {
  if (running) return;
  running = true;
  try {
    while (waiting) {
      const request = waiting;
      waiting = null;
      if (request.cancelled) continue;
      try {
        if (!FileEngine?.searchFiles) throw new Error('File search is unavailable in this app build.');
        const files = await FileEngine.searchFiles(request.term, request.limit);
        if (!request.cancelled) request.resolve(files);
      } catch (cause) { if (!request.cancelled) request.reject(cause); }
    }
  } finally { running = false; }
}

export function requestFileSearch(term: string, limit: number) {
  let request!: Request;
  const promise = new Promise<ExplorerEntry[]>((resolve, reject) => { request = { term, limit, cancelled: false, resolve, reject }; });
  if (waiting) { waiting.cancelled = true; waiting.resolve([]); }
  waiting = request;
  void drain();
  return { promise, release() {
    request.cancelled = true;
    if (waiting === request) waiting = null;
    request.resolve([]);
  } };
}

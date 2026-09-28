import { create } from 'zustand';

const KEY = 'versara.search.history.v1';
type History = { tools: string[]; queries: string[]; enabled: boolean };
const empty: History = { tools: [], queries: [], enabled: true };
const strings = (value: unknown, limit: number) => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item.trim() && item.length <= 100))].slice(0, limit) : [];

export const useSearchHistory = create<History & { hydrated: boolean }>(() => ({ ...empty, hydrated: false }));

export function hydrateSearchHistory() {
  if (useSearchHistory.getState().hydrated) return;
  let history = empty;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') history = { enabled: saved.enabled !== false, tools: strings(saved.tools, 8), queries: strings(saved.queries, 6) };
  } catch { /* History is optional; unavailable storage must not block a tool. */ }
  useSearchHistory.setState({ ...history, ...(!history.enabled ? { tools: [], queries: [] } : {}), hydrated: true });
}

function update(value: Partial<History>) {
  hydrateSearchHistory();
  useSearchHistory.setState(value);
  const { tools, queries, enabled } = useSearchHistory.getState();
  try { localStorage.setItem(KEY, JSON.stringify({ tools, queries, enabled })); } catch { /* Keep this session usable. */ }
}
export function recordToolUse(key: string) {
  hydrateSearchHistory();
  const state = useSearchHistory.getState();
  if (state.enabled && state.tools[0] !== key) update({ tools: [key, ...state.tools.filter(item => item !== key)].slice(0, 8) });
}
export function recordSearch(value: string) {
  hydrateSearchHistory();
  const query = value.trim().slice(0, 100);
  const state = useSearchHistory.getState();
  if (query && state.enabled) update({ queries: [query, ...state.queries.filter(item => item.toLowerCase() !== query.toLowerCase())].slice(0, 6) });
}
export function removeSearch(query: string) { update({ queries: useSearchHistory.getState().queries.filter(item => item !== query) }); }
export function clearSearchHistory() { update({ tools: [], queries: [] }); }
export function setSearchHistoryEnabled(enabled: boolean) { update({ enabled, ...(!enabled ? { tools: [], queries: [] } : {}) }); }

import { create } from 'zustand';
import { EditorMenu } from '@/components/editor-menu';
import type { OptionIcon } from '@/theme/editor-icons';

export type FileSortField = 'name' | 'modified' | 'size' | 'type';
export type FileSort = { field: FileSortField; ascending: boolean };
type Scope = 'recent' | 'folders';
const labels: Record<FileSortField, string> = { name: 'Name', modified: 'Date', size: 'Size', type: 'Type' };
const icons: Record<FileSortField, OptionIcon> = {
  name: { ios: 'textformat', android: 'sort-by-alpha' }, modified: { ios: 'calendar', android: 'calendar-today' },
  size: { ios: 'internaldrive', android: 'storage' }, type: { ios: 'square.grid.2x2', android: 'category' },
};
const orders: Record<FileSortField, readonly [string, string]> = {
  name: ['A to Z', 'Z to A'], modified: ['Oldest first', 'Newest first'],
  size: ['Smallest first', 'Largest first'], type: ['A to Z', 'Z to A'],
};
const storageKey = 'versara.files.sort';
function initialSort(scope: Scope): FileSort {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}')[scope] as FileSort | undefined;
    if (saved && Object.hasOwn(labels, saved.field) && typeof saved.ascending === 'boolean') return saved;
  } catch { /* Preferences are optional. */ }
  return scope === 'recent' ? { field: 'modified', ascending: false } : { field: 'name', ascending: true };
}
const useSortStore = create<{ recent: FileSort; folders: FileSort; change: (scope: Scope, sort: FileSort) => void }>((set, get) => ({
  recent: initialSort('recent'), folders: initialSort('folders'),
  change: (scope, sort) => {
    set({ [scope]: sort });
    try { const state = get(); localStorage.setItem(storageKey, JSON.stringify({ recent: state.recent, folders: state.folders })); } catch { /* Optional preference. */ }
  },
}));
export function useFileSort(scope: Scope) {
  const sort = useSortStore(state => state[scope]);
  const change = useSortStore(state => state.change);
  return [sort, (next: FileSort) => change(scope, next)] as const;
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function compareFiles(a: { name: string; modified?: number; opened?: number; size: number; kind: string; directory?: boolean }, b: typeof a, sort: FileSort) {
  if (!!a.directory !== !!b.directory) return a.directory ? -1 : 1;
  const comparison = sort.field === 'modified' ? (a.modified ?? a.opened ?? 0) - (b.modified ?? b.opened ?? 0) : sort.field === 'size' ? a.size - b.size
    : sort.field === 'type' ? collator.compare(a.kind, b.kind) || collator.compare(a.name, b.name) : collator.compare(a.name, b.name);
  return (sort.ascending ? comparison : -comparison) || collator.compare(a.name, b.name);
}
export function FileSortMenu({ sort, onChange }: { sort: FileSort; onChange: (sort: FileSort) => void }) {
  return <EditorMenu iconOnly icon={{ ios: 'arrow.up.arrow.down', android: 'sort' }} label={`Sort: ${labels[sort.field]}, ${orders[sort.field][sort.ascending ? 0 : 1]}`} items={[
    ...(Object.keys(labels) as FileSortField[]).map(field => ({ id: field, label: labels[field], icon: icons[field], selected: sort.field === field, onPress: () => onChange({ field, ascending: field === 'name' || field === 'type' }) })),
    { id: 'ascending', label: orders[sort.field][0], icon: { ios: 'arrow.up', android: 'arrow-upward' }, selected: sort.ascending, onPress: () => onChange({ ...sort, ascending: true }) },
    { id: 'descending', label: orders[sort.field][1], icon: { ios: 'arrow.down', android: 'arrow-downward' }, selected: !sort.ascending, onPress: () => onChange({ ...sort, ascending: false }) },
  ]} />;
}

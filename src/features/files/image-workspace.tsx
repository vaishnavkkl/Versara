import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { ToolboxSheet } from '@/components/toolbox-sheet';
import { UniversalIcon } from '@/components/universal-icon';
import { ThemedText } from '@/components/themed-text';
import { IMAGE_SECTIONS } from '@/constants/image-methods';
import { usePalette } from '@/theme/colors';
import { getRecentFile, type RecentFile } from './recent-files';
import { ADVANCED_IMAGE_TOOLS } from './image-tools';

const tabs: Record<string, string> = { crop: 'crop', rotate: 'rotate', flip_h: 'rotate', flip_v: 'rotate', brightness: 'adjust', contrast: 'adjust', saturation: 'adjust', temperature: 'adjust', filters: 'filters', export: 'export' };
type Draft = { uri: string; size: number; mimeType: string };
class ImageWorkspace {
  readonly directory = new Directory(Paths.cache, `image-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  private draft?: RecentFile;
  origin?: RecentFile;
  private files: string[] = [];
  private users = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Set<Promise<unknown>>();
  constructor(readonly id: string) {}
  retain() { clearTimeout(this.timer); this.users++; }
  release() {
    this.users--;
    this.timer = setTimeout(() => {
      void Promise.allSettled([...this.pending]).then(() => {
        if (this.users) return;
        workspaces.delete(this.id);
        try { if (this.directory.exists) this.directory.delete(); } catch { /* OS cache cleanup can retry. */ }
      });
    }, 2500);
  }
  async resolve() { if (this.draft) return this.draft; const file = await getRecentFile(this.id); if (file) this.origin = file; return file; }
  get changed() { return !!this.draft; }
  async render<T>(operation: (uri: string) => Promise<T>, format = 'png'): Promise<T> {
    this.directory.create({ intermediates: true, idempotent: true });
    const output = new File(this.directory, `${Date.now()}-${Math.random().toString(36).slice(2)}.${format === 'jpeg' ? 'jpg' : format}`);
    const job = operation(output.uri); this.pending.add(job);
    try { return await job; }
    catch (cause) { try { if (output.exists) output.delete(); } catch { /* Session cleanup retries. */ } throw cause; }
    finally { this.pending.delete(job); }
  }
  accept(result: Draft, file: RecentFile) {
    this.draft = { ...file, ...result, id: this.id, name: this.origin?.name ?? file.name };
    this.files.push(result.uri);
    // Keep one preceding frame while the outgoing native view releases it.
    while (this.files.length > 2) { const uri = this.files.shift()!; try { new File(uri).delete(); } catch { /* Workspace cleanup retries. */ } }
  }
}
const workspaces = new Map<string, ImageWorkspace>();
function acquire(id: string) { let workspace = workspaces.get(id); if (!workspace) { workspace = new ImageWorkspace(id); workspaces.set(id, workspace); } return workspace; }
/** Routes are keyed by the library ID; tool replacement keeps the temporary working copy. */
export function useImageWorkspace(id: string) {
  const [workspace] = useState(() => acquire(id));
  useEffect(() => { workspace.retain(); return () => workspace.release(); }, [workspace]);
  return workspace;
}

export function ImageWorkspaceTools({ id, current, disabled, onApply }: { id: string; current: string; disabled: boolean; onApply: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const colors = usePalette();
  const sections = IMAGE_SECTIONS.map(section => ({ title: section.title, data: section.tools.filter(tool => tool.id !== current && (tool.id in tabs || ADVANCED_IMAGE_TOOLS.has(tool.id) || ['text', 'edit_text'].includes(tool.id))).map(tool => ({ ...tool, available: true })) })).filter(section => section.data.length);
  async function choose(tool: string) {
    if (switching || disabled) return;
    Keyboard.dismiss(); setSwitching(true); setError('');
    try {
      await onApply();
      if (!mounted.current) return;
      if (tool in tabs) router.replace({ pathname: '/image-editor', params: { id, tab: tabs[tool] } });
      else if (tool === 'text' || tool === 'edit_text') router.replace({ pathname: '/image-text', params: { id, mode: tool === 'text' ? 'add' : 'edit' } });
      else router.replace({ pathname: '/image-tool', params: { id, tool } });
    } catch (cause) { setError((cause as Error).message || 'Could not apply changes.'); setOpen(true); }
    finally { setSwitching(false); }
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={switching ? 'Applying changes' : 'Switch image tool'} disabled={disabled || switching} onPress={() => setOpen(true)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled || switching ? .4 : 1 }}><UniversalIcon ios="square.grid.3x3" android="apps" size={24} color={colors.systemBlue} /></Pressable>
    <ToolboxSheet visible={open} title="Image tools" subtitle="Changes carry into the next tool. Export when you are ready." sections={sections} footer={<ThemedText accessibilityRole={error ? 'alert' : undefined}>{error || 'Your original image stays unchanged.'}</ThemedText>} onClose={() => setOpen(false)} onAction={tool => void choose(tool)} />
  </>;
}

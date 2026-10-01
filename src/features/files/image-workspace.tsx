import { AppLoader, withLoading } from '@/components/app-loader';
import { FileEngine } from '../../../modules/file-engine';
import { askSaveOptions, newFileName, saveEditedOutput } from './save-file';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { ToolboxSheet } from '@/components/toolbox-sheet';
import { UniversalIcon } from '@/components/universal-icon';
import { ThemedText } from '@/components/themed-text';
import { IMAGE_SECTIONS } from '@/constants/image-methods';
import { usePalette } from '@/theme/colors';
import { draftSource, readEditorDraft, removeEditorDraft, writeEditorDraft } from '../editor/editor-drafts';
import { getRecentFile, documentRoot, storedUri, type RecentFile } from './recent-files';
import { ADVANCED_IMAGE_TOOLS } from './image-tools';

const tabs: Record<string, string> = { crop: 'crop', rotate: 'rotate', flip_h: 'rotate', flip_v: 'rotate', brightness: 'adjust', contrast: 'adjust', saturation: 'adjust', temperature: 'adjust', filters: 'filters', export: 'export' };
type Draft = { uri: string; size: number; mimeType: string };
type WorkspaceDraft = { version: 1; draft: RecentFile; files: string[] };
export class ImageWorkspace {
  readonly directory: Directory;
  private draft?: RecentFile;
  origin?: RecentFile;
  private files: string[] = [];
  private users = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Set<Promise<unknown>>();
  private opening?: Promise<RecentFile | null>;
  private source = '';
  private applying = false;
  constructor(readonly id: string) { this.directory = new Directory(Paths.document, '.editor-workspaces', encodeURIComponent(id)); }
  retain() { clearTimeout(this.timer); this.users++; }
  release() {
    this.users--;
    this.timer = setTimeout(() => {
      void Promise.allSettled([...this.pending]).then(() => {
        if (this.users) return;
        workspaces.delete(this.id);
        if (!this.draft) try { if (this.directory.exists) this.directory.delete(); } catch { /* A later release can retry. */ }
      });
    }, 2500);
  }
  async resolve(): Promise<RecentFile | null> {
    if (this.draft) return this.draft;
    if (this.opening) return this.opening;
    const opening = (async () => {
      const file = await getRecentFile(this.id);
      if (!file) return null;
      this.origin = file; this.source = draftSource(file.uri);
      const restored = (uri: string) => uri.startsWith('document://') ? documentRoot() + uri.slice('document://'.length) : uri;
      const saved = await readEditorDraft<WorkspaceDraft>(`workspace:${this.id}`, this.source);
      if (saved?.version === 1 && saved.draft && typeof saved.draft.uri === 'string' && Array.isArray(saved.files)) {
        const uri = restored(saved.draft.uri);
        if (uri.startsWith(this.directory.uri.replace(/\/+$/, '') + '/') && new File(uri).exists) {
          this.draft = { ...saved.draft, uri, id: this.id };
          this.files = saved.files.filter(item => typeof item === 'string').map(restored).filter(item => item.startsWith(this.directory.uri.replace(/\/+$/, '') + '/')).slice(-2);
          return this.draft;
        }
      }
      return file;
    })();
    this.opening = opening;
    this.pending.add(opening);
    void opening.then(() => this.pending.delete(opening), () => { this.pending.delete(opening); this.opening = undefined; });
    return opening;
  }
  get changed() { return !!this.draft; }
  async apply<T extends Draft>(operation: (uri: string) => Promise<T>, file: RecentFile, format = 'png'): Promise<T> {
    if (this.applying) throw new Error('Wait for the current image change to finish.');
    this.applying = true;
    const work = (async () => { const result = await this.render(operation, format); await this.accept(result, file); return result; })();
    this.pending.add(work);
    try { return await work; } finally { this.pending.delete(work); this.applying = false; }
  }
  private async render<T>(operation: (uri: string) => Promise<T>, format = 'png'): Promise<T> {
    this.directory.create({ intermediates: true, idempotent: true });
    const output = new File(this.directory, `${Date.now()}-${Math.random().toString(36).slice(2)}.${format === 'jpeg' ? 'jpg' : format}`);
    const job = operation(output.uri); this.pending.add(job);
    try { return await job; }
    catch (cause) { try { if (output.exists) output.delete(); } catch { /* Session cleanup retries. */ } throw cause; }
    finally { this.pending.delete(job); }
  }
  private async accept(result: Draft, file: RecentFile) {
    const draft = { ...file, ...result, id: this.id, name: this.origin?.name ?? file.name };
    const files = [...this.files, result.uri];
    const job = writeEditorDraft(`workspace:${this.id}`, this.source, { version: 1, draft: { ...draft, uri: storedUri(draft.uri) }, files: files.slice(-2).map(storedUri) } satisfies WorkspaceDraft);
    this.pending.add(job);
    try { await job; this.draft = draft; this.files = files; }
    catch (cause) { try { new File(result.uri).delete(); } catch { /* Never delete an accepted frame. */ } throw cause; }
    finally { this.pending.delete(job); }
    // Keep one preceding frame while the outgoing native view releases it.
    while (this.files.length > 2) { const uri = this.files.shift()!; try { new File(uri).delete(); } catch { /* Workspace cleanup retries. */ } }
  }
  async discard() {
    await removeEditorDraft(`workspace:${this.id}`);
    this.draft = undefined; this.opening = undefined;
    // Active views still own the current file. The final release removes it.
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

const NEUTRAL_EDITS = { rotation: 0, flipH: false, flipV: false, brightness: 0, contrast: 1, saturation: 1, warmth: 0, filter: 'none' };
const ENCODINGS: Record<string, { format: 'jpeg' | 'png' | 'webp'; extension: string; mimeType: string }> = {
  png: { format: 'png', extension: '.png', mimeType: 'image/png' },
  webp: { format: 'webp', extension: '.webp', mimeType: 'image/webp' },
  jpeg: { format: 'jpeg', extension: '.jpg', mimeType: 'image/jpeg' },
};

/**
 * Saves every change applied in image tools as one file, in the original's format where the device can encode it.
 * Returns null when there is nothing to save or the user cancelled.
 */
export async function saveImageWorkspace(workspace: ImageWorkspace) {
  const draft = await workspace.resolve();
  const origin = workspace.origin;
  if (!draft || !origin || !workspace.changed) return null;
  if (!FileEngine) throw new Error('Install a new development build to save edited images.');
  const engine = FileEngine;
  const encoding = ENCODINGS[origin.mimeType.replace('image/', '')] ?? ENCODINGS.jpeg;
  const base = origin.name.replace(/\.[a-zA-Z0-9]{1,8}$/, '');
  const options = await askSaveOptions(origin.name, encoding.mimeType, newFileName(base + encoding.extension));
  if (!options) return null;
  return withLoading('Saving your image…', async () => {
    const folder = new Directory(Paths.document, 'Versara Images');
    folder.create({ intermediates: true, idempotent: true });
    const safe = base.replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 60) || 'Image';
    const output = new File(folder, `${safe}-edited-${new Date().toISOString().replace(/[T:.]/g, '-').replace(/Z$/, '')}${encoding.extension}`);
    let mimeType = encoding.mimeType;
    if (draft.uri.toLowerCase().endsWith(encoding.extension)) new File(draft.uri).copy(output);
    else mimeType = (await engine.editImage(JSON.stringify({ uri: draft.uri, outputUri: output.uri, edits: NEUTRAL_EDITS, crop: null, format: encoding.format, quality: 92 }))).mimeType;
    const saved = await saveEditedOutput({ output: output.uri, mimeType, kind: 'image', mode: options.mode, origin, name: options.name });
    await workspace.discard();
    return saved;
  });
}

export function ImageWorkspaceTools({ id, current, disabled, onApply }: { id: string; current: string; disabled: boolean; onApply: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const colors = usePalette();
  const sections = useMemo(() => IMAGE_SECTIONS.map(section => ({ title: section.title, data: section.tools.filter(tool => tool.id !== current && (tool.id in tabs || ADVANCED_IMAGE_TOOLS.has(tool.id) || ['text', 'edit_text'].includes(tool.id))).map(tool => ({ ...tool, available: true })) })).filter(section => section.data.length), [current]);
  async function choose(tool: string) {
    if (switching || disabled) return;
    Keyboard.dismiss(); setSwitching(true); setError('');
    try {
      await onApply();
      if (!mounted.current) return;
      if (tool in tabs) router.replace({ pathname: '/image-editor', params: { id, tab: tabs[tool], tool } });
      else if (tool === 'text' || tool === 'edit_text') router.replace({ pathname: '/image-text', params: { id, mode: tool === 'text' ? 'add' : 'edit' } });
      else router.replace({ pathname: '/image-tool', params: { id, tool } });
    } catch (cause) { if (mounted.current) { setError((cause as Error).message || 'Could not apply changes.'); setOpen(true); } }
    finally { if (mounted.current) setSwitching(false); }
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={switching ? 'Applying changes' : 'Switch image tool'} disabled={disabled || switching} onPress={() => setOpen(true)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled || switching ? .4 : 1 }}>{switching ? <AppLoader accessibilityLabel="Applying changes" /> : <UniversalIcon ios="square.grid.3x3" android="apps" size={24} color={colors.systemBlue} />}</Pressable>
    <ToolboxSheet visible={open} title="Image tools" subtitle="Changes carry into the next tool. Save once from the image preview." sections={sections} footer={<ThemedText accessibilityRole={error ? 'alert' : undefined}>{error || 'Your original image stays unchanged.'}</ThemedText>} onClose={() => setOpen(false)} onAction={tool => void choose(tool)} />
  </>;
}

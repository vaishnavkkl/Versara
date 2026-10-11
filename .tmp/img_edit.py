p='src/features/files/image-workspace.tsx'; s=open(p,encoding='utf8').read()
rep=[
("""import { UniversalIcon } from '@/components/universal-icon';
""", """import { BrandGlyph } from '@/components/app-glyph';
"""),
("""import { usePalette } from '@/theme/colors';
""", ""),
("""import { draftSource, readEditorDraft, removeEditorDraft, writeEditorDraft } from '../editor/editor-drafts';""",
"""import { draftSource, editorDraftPayloads, readEditorDraft, removeEditorDraft, writeEditorDraft } from '../editor/editor-drafts';"""),
("""  const colors = usePalette();
  const sections = useMemo(""", """  const sections = useMemo("""),
("""{switching ? <AppLoader accessibilityLabel="Applying changes" /> : <UniversalIcon ios="square.grid.3x3" android="apps" size={24} color={colors.systemBlue} />}</Pressable>""",
"""<BrandGlyph art="tools" size={36} loading={switching} /></Pressable>"""),
("""const NEUTRAL_EDITS =""",
"""/**
 * Removes working copies left by a closed or crashed session: folders without a saved draft,
 * and frames the draft no longer refers to. Open workspaces and files newer than `before` are kept.
 */
export async function pruneImageWorkspaces(before: number) {
  const root = new Directory(Paths.document, '.editor-workspaces');
  if (!root.exists) return;
  const drafts = await editorDraftPayloads('workspace:');
  for (const folder of root.list()) {
    if (!(folder instanceof Directory)) continue;
    const id = decodeURIComponent(folder.name);
    if (workspaces.has(id)) continue;
    const kept = new Set<string>();
    try {
      const saved = JSON.parse(drafts.get(`workspace:${id}`) ?? 'null') as WorkspaceDraft | null;
      for (const uri of saved ? [saved.draft?.uri, ...(saved.files ?? [])] : []) if (typeof uri === 'string') kept.add(decodeURIComponent(uri.split('/').at(-1) ?? ''));
    } catch { /* An unreadable draft keeps nothing. */ }
    try {
      const files = folder.list();
      for (const file of files) if (file instanceof File && !kept.has(file.name) && (file.modificationTime ?? 0) < before) file.delete();
      if (!kept.size && !folder.list().length) folder.delete();
    } catch { /* The next launch retries. */ }
  }
}

const NEUTRAL_EDITS ="""),
]
for a,b in rep:
    assert a in s,a[:70]; s=s.replace(a,b,1)
open(p,'w',encoding='utf8').write(s)
print('ok')

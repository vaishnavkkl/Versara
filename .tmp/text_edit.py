p='src/features/pdf/pdf-text-editor.tsx'; s=open(p,encoding='utf8').read()
rep=[
("""import { usePublishHeaderShare } from '@/components/header-share';""",
"""import { usePublishHeaderShare } from '@/components/header-share';
import { copyPdf, usePublishPdfHandoff } from './pdf-handoff';"""),
("""  const recoveryOrigin = sourceOrigin?.uri;""",
"""  // A working copy carried from another tool cannot be rebuilt from the original, so it keeps no draft.
  const recoveryOrigin = initialSelection?.carried ? undefined : sourceOrigin?.uri;"""),
("""    save: { disabled: busy || !edits.length || !recovery.ready, label: `Save PDF (${edits.length} edits)`, onSave: requestSave } });""",
"""    save: { disabled: busy || !edits.length || !recovery.ready, label: `Save PDF (${edits.length} edits)`, onSave: requestSave } });
  usePublishPdfHandoff(!!source, {
    changed: !result && shareChanges.length > 0,
    saved: result ? { uri: result.uri, name: result.name } : undefined,
    blocked: busy ? 'Wait for the current task to finish, then choose another tool.' : !result && draftIssue && (selected || placement) ? 'Apply or cancel this text box before choosing another tool.' : undefined,
    write: writeCurrent,
  });"""),
("""  /** Shares the saved result, otherwise a fresh copy with every current change, otherwise the original. */""",
"""  /** Writes what the next tool continues with: the saved result, or the source with every current change. */
  async function writeCurrent(outputUri: string) {
    if (result) { await copyPdf(result.uri, outputUri); return; }
    if (!source) throw new Error('Choose a PDF first.');
    const changes = shareChanges;
    if (!changes.length) { await copyPdf(source.uri, outputUri); return; }
    if (!PdfEngine || locked.current) throw new Error('Wait for the current task to finish, then choose another tool.');
    begin('Preparing the edited PDF...'); setProgress(0);
    const id = newId(); job.current = id;
    try {
      await previewQueue.settle();
      await PdfEngine.editPdfText(id, JSON.stringify({ action: 'save', uri: source.uri, outputUri, edits: withFontFiles(changes) }));
    } finally { finish(); }
  }
  /** Shares the saved result, otherwise a fresh copy with every current change, otherwise the original. */"""),
]
for a,b in rep:
    assert a in s,a[:70]; s=s.replace(a,b)
open(p,'w',encoding='utf8').write(s)

p='src/app/pdf-tool.tsx'; s=open(p,encoding='utf8').read()
rep=[
("""      if (!origin && !carried && editingPdfTools.has(next as PdfTool)) origin = await retainPdfEditingSource(session.files[0]);""",
"""      // Before any carried change the session file is still the original, so later tools can save over it and keep drafts.
      if (!origin && !session.carried) origin = await retainPdfEditingSource(session.files[0]);"""),
("createPdfToolForWorkingCopy, editingPdfTools, forgetPdfToolSession", "createPdfToolForWorkingCopy, forgetPdfToolSession"),
]
for a,b in rep:
    assert a in s,a[:70]; s=s.replace(a,b)
open(p,'w',encoding='utf8').write(s)

p='src/features/pdf/pdf-tool-session.ts'; s=open(p,encoding='utf8').read()
a="""
/** Tools whose drafts and Save need an original kept outside the session cache. */
export const editingPdfTools = new Set<PdfTool>(['edit_text', 'text', 'remove_text', 'replace_text', 'highlight', 'draw', 'shapes', 'add_image', 'sign']);
"""
assert a in s; s=s.replace(a,'')
open(p,'w',encoding='utf8').write(s)
print('ok')

p='src/features/pdf/advanced-pdf-tool.tsx'; s=open(p,encoding='utf8').read()
rep=[
("""import { usePublishHeaderShare } from '@/components/header-share';""",
"""import { usePublishHeaderShare } from '@/components/header-share';
import { copyPdf, usePublishPdfHandoff } from './pdf-handoff';"""),
("""  const recovery = useEditorDraft({ id: markup && session.origin && info ? pdfDraftId(session.origin.uri, tool) : null,""",
"""  const recovery = useEditorDraft({ id: markup && session.origin && !session.carried && info ? pdfDraftId(session.origin.uri, tool) : null,"""),
("""  // Without a selection, the size buttons act on the newest shape so a tiny one can grow straight after drawing.""",
"""  const pdfResult = results.length === 1 && results[0].name.toLowerCase().endsWith('.pdf') ? results[0] : undefined;
  const markupChanged = markup && !results.length && marks.length + annotationEditCount > 0;
  usePublishPdfHandoff(true, {
    changed: pdfResult ? !savedOutputs.has(pdfResult.uri) : markupChanged,
    saved: pdfResult && savedOutputs.has(pdfResult.uri) ? { uri: pdfResult.uri, name: pdfResult.name } : undefined,
    blocked: busy ? 'Wait for the current task to finish, then choose another tool.' : undefined,
    write: async outputUri => {
      if (pdfResult) { await copyPdf(pdfResult.uri, outputUri); return; }
      if (!markupChanged) { await copyPdf(source.uri, outputUri); return; }
      const response = await process({ nativeEditor: true, action: 'save', outputUri, edits: markupEdits() }, 'Preparing the edited PDF...');
      if (!response?.outputs) throw new Error('Your marks could not be added to the PDF. Try again.');
    },
  });
  // Without a selection, the size buttons act on the newest shape so a tiny one can grow straight after drawing."""),
]
for a,b in rep:
    assert a in s,a[:70]; s=s.replace(a,b)
open(p,'w',encoding='utf8').write(s)
print('ok')

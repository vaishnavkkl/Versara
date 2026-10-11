import re
def apply(p, rep):
    s=open(p,encoding='utf8').read()
    for a,b in rep:
        assert a in s,(p,a[:70]); s=s.replace(a,b,1)
    open(p,'w',encoding='utf8').write(s)

# hand-off type: a different PDF opened inside the tool
apply('src/features/pdf/pdf-handoff.ts', [
("""  /** Writes the PDF exactly as the user sees it now, edits included. */""",
"""  /** A different PDF the user opened inside this tool, with the original it saves over when known. */
  switched?: { file: { uri: string; name: string; mimeType: string; size: number }; origin?: { uri: string; name: string } };
  /** Writes the PDF exactly as the user sees it now, edits included. */"""),
("""      get pending() { return latest.current.pending; },""",
"""      get pending() { return latest.current.pending; },
      get switched() { return latest.current.switched; },"""),
])

apply('src/app/pdf-tool.tsx', [
("""      const changed = current.changed;
      const saved = current.saved ?? workingSaved;
      const carried = saved ? changed : (!!session.carried || changed);
      let origin = saved ?? session.origin;
      // Before any carried change the session file is still the original, so later tools can save over it and keep drafts.
      if (!origin && !session.carried) origin = await retainPdfEditingSource(session.files[0]);""",
"""      const changed = current.changed;
      const switched = current.switched;
      const saved = current.saved ?? (switched ? undefined : workingSaved ?? undefined);
      const inherited = !switched && !!session.carried;
      const carried = saved ? changed : inherited || changed;
      let origin = saved ?? (switched ? switched.origin : session.origin);
      // Before any carried change this file is still the original, so later tools can save over it and keep drafts.
      if (!origin && !inherited && session.tool !== 'from_image') origin = await retainPdfEditingSource(switched?.file ?? session.files[0]);"""),
])

apply('src/features/pdf/pdf-text-editor.tsx', [
("""    write: writeCurrent,
  });""",
"""    switched: source && source.uri !== initialSelection?.files[0]?.uri ? { file: source, origin: sourceOrigin } : undefined,
    write: writeCurrent,
  });"""),
])

for f, pending in [('edit-pdf-pages', """!result && selected.size > 0 ? (extracting ? 'The pages you selected are not extracted yet. Save PDF creates the new PDF.' : 'The pages you selected are not deleted yet. Save PDF removes them.') : undefined"""),
                   ('arrange-pdf-pages', """!result && changed > 0 ? (reorder ? 'The new page order is not applied yet. Save PDF applies it.' : 'The page rotations are not applied yet. Save PDF applies them.') : undefined""")]:
    p=f'src/features/pdf/{f}.tsx'
    s=open(p,encoding='utf8').read()
    m=re.search(r"  usePublishHeaderShare\(\{ active: !!shareTarget.*?onSave: \(\) => result \? saveResult\(\) : save\(\) \} \}\);\n", s, re.S)
    assert m, p
    block = m.group(0) + f"""  usePublishPdfHandoff(!!shareTarget, {{
    changed: !!result && !result.location,
    saved: result?.location ? {{ uri: result.uri, name: result.name }} : undefined,
    blocked: busy ? 'Wait for the current task to finish, then choose another tool.' : undefined,
    pending: {pending},
    switched: !result && source && source.uri !== initialSelection?.files[0]?.uri ? {{ file: source }} : undefined,
    write: outputUri => shareTarget ? copyPdf(shareTarget.uri, outputUri) : Promise.reject(new Error('Choose a PDF first.')),
  }});
"""
    s = s.replace(m.group(0), block)
    s = s.replace("import { usePublishHeaderShare } from '@/components/header-share';", "import { usePublishHeaderShare } from '@/components/header-share';\nimport { copyPdf, usePublishPdfHandoff } from './pdf-handoff';",1)
    open(p,'w',encoding='utf8').write(s)

apply('src/features/pdf/organize-pdf.tsx', [
("import { usePublishHeaderShare } from '@/components/header-share';", "import { usePublishHeaderShare } from '@/components/header-share';\nimport { copyPdf, usePublishPdfHandoff } from './pdf-handoff';"),
("""      onSave: () => results.length === 1 ? saveResult(results[0]) : results.length ? undefined : process() } });
""",
"""      onSave: () => results.length === 1 ? saveResult(results[0]) : results.length ? undefined : process() } });
  usePublishPdfHandoff(!!(results.length || sources.length), {
    changed: results.length === 1 && !results[0].location,
    saved: results.length === 1 && results[0].location ? { uri: results[0].uri, name: results[0].name } : undefined,
    blocked: busy ? 'Wait for the current task to finish, then choose another tool.'
      : results.length > 1 ? 'This created several PDFs. Open one of them to continue with another tool.'
      : !results.length && sources.length > 1 ? 'Merge these PDFs first, then choose another tool.' : undefined,
    switched: !results.length && sources.length === 1 && sources[0].uri !== initialSelection?.files[0]?.uri ? { file: sources[0] } : undefined,
    write: outputUri => shareTarget ? copyPdf(shareTarget.uri, outputUri) : Promise.reject(new Error('Choose a PDF first.')),
  });
"""),
])

apply('src/features/pdf/image-to-pdf.tsx', [
("import { usePublishHeaderShare } from '@/components/header-share';", "import { usePublishHeaderShare } from '@/components/header-share';\nimport { copyPdf, usePublishPdfHandoff } from './pdf-handoff';"),
("""      onSave: () => result ? saveResult() : convert() } });
""",
"""      onSave: () => result ? saveResult() : convert() } });
  usePublishPdfHandoff(true, {
    changed: !!result && !result.location,
    saved: result?.location ? { uri: result.uri, name: result.name } : undefined,
    blocked: busy ? 'Wait for the current task to finish, then choose another tool.' : !result ? 'Create the PDF first, then choose another tool.' : undefined,
    write: outputUri => result ? copyPdf(result.uri, outputUri) : Promise.reject(new Error('Create the PDF first.')),
  });
"""),
])
print('ok')

import { useState, type ReactNode } from 'react';
import { PdfDocumentPreview } from './pdf-document-preview';

/** Preview the insertion by resolving only the visible output page to its original document. */
export function InsertPdfPreview({ uri, count, inputPassword, position, inserted, disabled, toolbarActions }: {
  uri: string; count: number; inputPassword: string; position: number;
  inserted?: { uri: string; name: string; count: number }; disabled: boolean; toolbarActions?: ReactNode;
}) {
  const after = Math.max(0, Math.min(count, position));
  const added = inserted?.count ?? 1;
  const total = count + added;
  const key = `${uri}:${inserted?.uri ?? 'blank'}:${after}`;
  const [selection, setSelection] = useState({ key, page: after + 1 });
  if (selection.key !== key) setSelection({ key, page: after + 1 });
  const page = Math.max(1, Math.min(total, selection.key === key ? selection.page : after + 1));
  const isInserted = page > after && page <= after + added;
  const blank = isInserted && !inserted;
  const sourcePage = isInserted ? inserted ? page - after : Math.max(1, after) : page <= after ? page : page - added;
  return <PdfDocumentPreview uri={isInserted && inserted ? inserted.uri : uri} count={total} page={page} sourcePage={sourcePage}
    inputPassword={isInserted && inserted ? '' : inputPassword} embedded hideThumbnails blank={blank} disabled={disabled}
    toolbarActions={toolbarActions} onClose={() => {}} onPageChange={next => setSelection({ key, page: next })}
    previewHint={isInserted ? inserted ? `Inserted PDF: ${inserted.name} - page ${sourcePage} of ${added}` : 'Inserted blank page' : `Original page ${sourcePage} - insertion preview`} />;
}

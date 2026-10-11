p='src/features/pdf/pdf-text-editor.tsx'; s=open(p,encoding='utf8').read()
rep=[
("""type Edit = { page: number; kind: 'replace' | 'delete' | 'add'; objectId?: number; original?: string; text?: string; font?: string; size?: number; x?: number; y?: number; color?: number; underline?: boolean; indent?: number };""",
"""/** Paragraph edits carry their `members` on the first piece, plus the reflow `wrap`, `lineHeight` and `hang` in page points. */
type Edit = { page: number; kind: 'replace' | 'delete' | 'add'; objectId?: number; original?: string; text?: string; font?: string; size?: number; x?: number; y?: number; color?: number; underline?: boolean; indent?: number; members?: number[]; wrap?: number; lineHeight?: number; hang?: number };"""),
("""function makeDraft(edits: Edit[], page: number, selected: TextObject | null, placement: { x: number; y: number } | null, addition: number | null, draft: Draft, pendingOnPage = false): { changes: Edit[]; error?: string } {""",
"""const round2 = (value: number) => Math.round(value * 100) / 100;
/** A paragraph edit rewrites its first piece with the whole paragraph and removes the other pieces. */
function paragraphEdits(paragraph: TextParagraph, page: number, command: Edit): Edit[] {
  const others: Edit[] = paragraph.members.filter(id => id !== paragraph.id).map(id => ({ kind: 'delete', page, objectId: id, original: paragraph.sources[id] }));
  const original = paragraph.sources[paragraph.id];
  if (command.kind === 'delete') return [{ kind: 'delete', page, objectId: paragraph.id, original, members: paragraph.members }, ...others];
  // Larger text keeps the paragraph's width and proportional line spacing.
  const scale = (command.size ?? paragraph.size) / paragraph.size;
  return [{ ...command, original, members: paragraph.members, lineHeight: round2(paragraph.lineHeight * scale), ...(paragraph.wrap ? { wrap: round2(paragraph.wrap), hang: round2(paragraph.hang) } : {}) }, ...others];
}
const withoutParagraph = (edits: Edit[], page: number, paragraph: TextParagraph) => {
  const members = new Set(paragraph.members);
  return edits.filter(edit => !(edit.page === page && edit.objectId !== undefined && members.has(edit.objectId)));
};

/**
 * `paragraph` edits the selected paragraph as a whole. With `overlay`, the on-page editor draws the typed text,
 * so the page renders once without the paragraph instead of on every key.
 */
function makeDraft(edits: Edit[], page: number, selected: TextObject | null, placement: { x: number; y: number } | null, addition: number | null, draft: Draft, pendingOnPage = false, paragraph?: TextParagraph, overlay = false): { changes: Edit[]; error?: string } {"""),
("""  if (selected) {
    const existing = edits.find(edit => edit.page === page && edit.objectId === selected.id);
    const unchanged = existing ? sameEdit(existing, command) : command.kind === 'replace' && command.text === selected.text && command.font === 'original' && command.size === undefined && command.color === undefined && !command.underline && !command.indent;
    if (unchanged) return { changes: edits };
  } else if (pendingOnPage) {""",
"""  if (selected) {
    const existing = edits.find(edit => edit.page === page && edit.objectId === selected.id);
    const pristine = command.kind === 'replace' && command.text === selected.text && command.font === 'original' && command.size === undefined && command.color === undefined && !command.underline && !command.indent;
    if (paragraph) {
      const base = withoutParagraph(edits, page, paragraph);
      if (overlay) return { changes: [...base, ...paragraph.members.map((id): Edit => ({ kind: 'delete', page, objectId: id, original: paragraph.sources[id] }))] };
      const next = paragraphEdits(paragraph, page, command);
      if (existing?.members ? sameEdit(existing, next[0]) : pristine) return { changes: edits };
      const changes = [...base, ...next];
      return changes.length > 500 ? { changes: edits, error: 'Save these changes before editing more text.' } : { changes };
    }
    const unchanged = existing ? sameEdit(existing, command) : pristine;
    if (unchanged) return { changes: edits };
  } else if (pendingOnPage) {"""),
# grouping, draft, unsaved
("""  const nativeTextBox = !!NativeEditCanvas && adding && !!placement && !selected;
  const draft = makeDraft(edits, page, selected, placement, editingAddition, { text, style: textStyle, size, indent, color: ink }, nativeTextBox);
  const draftJson = JSON.stringify(draft.changes.filter(edit => edit.page === page));
  const draftIssue = draft.error;
  const unsaved = (edits.length > 0 && edits !== savedEdits) || draft.changes !== edits || (!!placement && !!text.trim());
  useEffect(() => { onUnsavedChange?.(unsaved); }, [unsaved, onUnsavedChange]);""",
"""  const nativeTextBox = !!NativeEditCanvas && adding && !!placement && !selected;
  // Paragraph editing needs the native reflow; older builds and multi-select keep line-by-line pieces.
  const paragraphMode = !!PdfEngine?.nativeParagraphEditVersion && byParagraph && !multiDelete;
  const paragraphs = useMemo(() => {
    if (!paragraphMode || !preview) return [];
    const pointWidth = preview.pointWidth || 612;
    return groupParagraphs(preview.objects, pointWidth, pointWidth * preview.height / Math.max(1, preview.width));
  }, [paragraphMode, preview]);
  const paragraphOf = useMemo(() => new Map(paragraphs.flatMap(item => item.members.map(id => [id, item] as const))), [paragraphs]);
  const paragraph = selected && paragraphMode ? paragraphs.find(item => item.id === selected.id) : undefined;
  const nativeParagraph = !!NativeEditCanvas && !!paragraph;
  const draftValues = { text, style: textStyle, size, indent, color: ink };
  const draft = makeDraft(edits, page, selected, placement, editingAddition, draftValues, nativeTextBox, paragraph, nativeParagraph);
  const draftJson = JSON.stringify(draft.changes.filter(edit => edit.page === page));
  const draftIssue = draft.error;
  // Every change, including a valid open text box; used for recovery and the header share.
  const shareChanges = makeDraft(edits, page, selected, placement, editingAddition, draftValues, false, paragraph).changes;
  const unsaved = (edits.length > 0 && edits !== savedEdits) || shareChanges !== edits || (!!placement && !!text.trim());
  useEffect(() => { onUnsavedChange?.(unsaved); }, [unsaved, onUnsavedChange]);"""),
("""  // Every change, including a valid open text box; used for recovery and the header share.
  const shareChanges = makeDraft(edits, page, selected, placement, editingAddition, { text, style: textStyle, size, indent, color: ink }).changes;
""", ""),
("""  const publishLivePreview = useEffectEvent((next: PagePreview, key: string) => {
    showPreview(next);
    setPreviewError('');
    setPreviewStatus(key === `${sourceUri}\\n${page}\\n${draftJson}` ? 'Live preview' : 'Updating preview...');
  });""",
"""  const publishLivePreview = useEffectEvent((next: PagePreview, key: string) => {
    showPreview(next);
    setPreviewError('');
    const current = key === `${sourceUri}\\n${page}\\n${draftJson}`;
    setPreviewStatus(current ? 'Live preview' : 'Updating preview...');
    // The on-page paragraph editor appears once the page is drawn without the paragraph, so text never shows twice.
    if (current && nativeParagraph && selected) setOverlayFor(selected.id);
  });"""),
("""  const previewObjects = preview?.objects;""",
"""  const previewObjects = preview?.objects;
  // In paragraph mode the page offers whole paragraphs, plus pieces that cannot join one (such as rotated text).
  const tapObjects = useMemo<TextObject[]>(() => paragraphMode
    ? [...paragraphs.map(item => ({ id: item.id, text: item.text, editable: true, size: item.size, font: item.font, color: item.color, bounds: item.bounds })), ...(previewObjects ?? []).filter(object => !paragraphOf.has(object.id))]
    : previewObjects ?? [], [paragraphMode, paragraphs, paragraphOf, previewObjects]);"""),
("""  const objectsJson = useMemo(() => JSON.stringify((previewObjects ?? [])
    .filter(object => object.bounds && (object.id === selected?.id || !removedIds.includes(object.id)))
    .map(object => ({ id: object.id, ...object.bounds }))), [previewObjects, removedIds, selected?.id]);""",
"""  const objectsJson = useMemo(() => JSON.stringify(tapObjects
    .filter(object => object.bounds && (object.id === selected?.id || !removedIds.includes(object.id)))
    .map(object => ({ id: object.id, ...object.bounds }))), [tapObjects, removedIds, selected?.id]);"""),
# openText
("""    invalidateDraft();
    const existing = edits.find(edit => edit.page === onPage && edit.objectId === object.id);
    setShowFormatting(false); setShowTextList(false); setShowOptions(false); setShowSearch(false); setAdding(false); setPlacement(null); setEditingAddition(null); setSelected(object); setText(existing?.text ?? object.text);""",
"""    invalidateDraft();
    const group = onPage === page ? paragraphOf.get(object.id) : undefined;
    const target = group ? paragraphObject(group) : object;
    const existing = edits.find(edit => edit.page === onPage && edit.objectId === target.id);
    // A paragraph opens with its current text; a line edit made earlier only counts for its own piece.
    const opened = group ? existing?.members ? existing.text ?? '' : target.text : existing?.text ?? object.text;
    setOverlayFor(null);
    setShowFormatting(false); setShowTextList(false); setShowOptions(false); setShowSearch(false); setAdding(false); setPlacement(null); setEditingAddition(null); setSelected(target); setText(opened);"""),
("""  function select(object: TextObject) {""",
"""  /** The paragraph as one selectable text, with earlier line edits applied. */
  function paragraphObject(group: TextParagraph): TextObject {
    const current = (id: number) => {
      const edit = edits.find(item => item.page === page && item.objectId === id);
      return edit?.kind === 'delete' ? null : edit?.kind === 'replace' ? edit.text ?? '' : group.sources[id];
    };
    return { id: group.id, text: paragraphText(group, current), editable: true, size: group.size, font: group.font, color: group.color, bounds: group.bounds };
  }
  function select(object: TextObject) {"""),
# apply
("""    if (kind === 'delete') command = { kind, page, objectId: selected!.id, original: selected!.text };
    else {
      const built = commandFor(page, kind === 'add' ? null : selected, placement, { text: value, style: textStyle, size, indent, color: ink });
      if (typeof built === 'string') { setError(built); return; }
      command = built;
    }
    const next = kind === 'add'
      ? editingAddition === null ? [...edits, command] : edits.map((edit, index) => index === editingAddition ? command : edit)
      : [...edits.filter(edit => !(edit.page === page && edit.objectId === selected?.id)), command];""",
"""    if (kind === 'delete') command = { kind, page, objectId: selected!.id, original: selected!.text };
    else {
      const built = commandFor(page, kind === 'add' ? null : selected, placement, { text: value, style: textStyle, size, indent, color: ink });
      if (typeof built === 'string') { setError(built); return; }
      command = built;
    }
    const next = kind === 'add'
      ? editingAddition === null ? [...edits, command] : edits.map((edit, index) => index === editingAddition ? command : edit)
      : paragraph ? [...withoutParagraph(edits, page, paragraph), ...paragraphEdits(paragraph, page, command)]
      : [...edits.filter(edit => !(edit.page === page && edit.objectId === selected?.id)), command];"""),
# native canvas text box
("""        textBox={JSON.stringify({ visible: nativeTextBox && !controlHelp?.active, submitOnReturn: true, text, font: textStyle.family === 'original' ? 'Helvetica' : fontName(textStyle), fontFile: fontFile(fontName(textStyle)), size: Number(size) || 16, color: ink ?? DEFAULT_INK, underline: textStyle.underline })}""",
"""        textBox={JSON.stringify(paragraph && nativeParagraph
          ? { visible: overlayFor === paragraph.id && !controlHelp?.active, submitOnReturn: false, text, font: textStyle.family === 'original' ? paragraph.font ?? 'Helvetica' : fontName(textStyle), fontFile: fontFile(fontName(textStyle)), size: Number(size) || paragraph.size, color: ink ?? paragraph.color ?? DEFAULT_INK, underline: textStyle.underline, box: paragraph.box, lineHeight: round2(paragraph.lineHeight * (Number(size) || paragraph.size) / paragraph.size) }
          : { visible: nativeTextBox && !controlHelp?.active, submitOnReturn: true, text, font: textStyle.family === 'original' ? 'Helvetica' : fontName(textStyle), fontFile: fontFile(fontName(textStyle)), size: Number(size) || 16, color: ink ?? DEFAULT_INK, underline: textStyle.underline })}"""),
("""      : screenActive ? <PdfEditCanvas key={source.uri + ':' + page} uri={preview.imageUri} width={preview.width} height={preview.height} objects={preview.objects}""",
"""      : screenActive ? <PdfEditCanvas key={source.uri + ':' + page} uri={preview.imageUri} width={preview.width} height={preview.height} objects={tapObjects}"""),
("""        {!nativeTextBox && <View style={styles.editorInput}>""", """        {!nativeTextBox && !nativeParagraph && <View style={styles.editorInput}>"""),
("""{nativeTextBox ? 'Editing on the page' : selected ? 'Live on the page' : 'New text'}""", """{nativeTextBox || nativeParagraph ? 'Editing on the page' : selected ? 'Live on the page' : 'New text'}"""),
# options toggle
("""        {layout && <OptionCard title="View" icon={{ ios: 'rectangle.landscape.rotate', android: 'screen-rotation' }}>""",
"""        {!!PdfEngine?.nativeParagraphEditVersion && !multiDelete && <OptionCard title="Editing" icon={{ ios: 'text.alignleft', android: 'notes' }}>
          <EditorOption label="Edit whole paragraphs" icon={{ ios: 'text.justify.left', android: 'format-align-left' }} selected={byParagraph} disabled={busy} onPress={() => { invalidateDraft(); setSelected(null); setPlacement(null); setEditingAddition(null); setByParagraph(value => !value); }} />
          <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>{byParagraph ? 'Tap a paragraph to rewrite it; lines rewrap to fit. Turn off to change one line at a time.' : 'Tap a line to change only that line.'}</ThemedText>
        </OptionCard>}
        {layout && <OptionCard title="View" icon={{ ios: 'rectangle.landscape.rotate', android: 'screen-rotation' }}>"""),
# state
("""  const [result, setResult] = useState<(PdfResult & { name: string; location: string }) | null>(null);
""",
"""  const [result, setResult] = useState<(PdfResult & { name: string; location: string }) | null>(null);
  const [byParagraph, setByParagraph] = useState(true);
  const [overlayFor, setOverlayFor] = useState<number | null>(null);
"""),
]
for a,b in rep:
    assert s.count(a)==1,(a[:90], s.count(a)); s=s.replace(a,b)
# import
a="import { copyPdf, usePublishPdfHandoff } from './pdf-handoff';"
assert a in s
s=s.replace(a, a+"\nimport { groupParagraphs, paragraphText, type TextParagraph } from './text-paragraphs';",1)
open(p,'w',encoding='utf8').write(s)
print('ok')

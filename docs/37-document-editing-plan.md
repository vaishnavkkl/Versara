# Plan: PDF editor extensions and native DOCX editor

Status: Track A1/A2 and Track B are implemented. Both tracks stay fully offline, native on Android and iOS, and use only free/open-source code. [PDF tools](03-pdf-tools.md) records that DOCX editing lives in Documents, with simplified PDF export rather than a full conversion suite.

The current DOCX layout is still a simplified editor and fails on multi-section Word files with anchored graphics. DOCX stays in the product; [LibreOfficeKit integration research](38-libreofficekit-docx-research.md) records the replacement path for faithful layout and editing. Do not treat image sizing or visual page gaps as a substitute for a layout engine.

## What already exists

Text edit/add/remove (PDFium), highlight, freehand, shapes, visual signatures, watermark, page numbers, OCR with searchable text layer, protection, metadata removal, flatten, repair and page organization. See [native PDF suite](20-native-pdf-suite.md) and [editor implementation](31-editor-functionality-implementation.md). Marks are exported as page vectors, not editable PDF annotations. Form filling, content redaction and object/image editing are listed there as missing.

## Track A — PDF editor extensions

Engine choice: extend the shared C++ PDFium engine (`modules/pdf-engine/cpp`). One implementation serves both platforms, avoids PDFBox/PDFKit behavior drift, and PDFium is already bundled. PDFBox Android and PDFKit stay for their existing tools.

| Step | Feature | PDFium API family | Notes |
|---|---|---|---|
| A1 | Real annotations: highlight/underline/strikeout, ink, square/circle, free text, sticky notes, signature stamps | `fpdf_annot` (`FPDFPage_CreateAnnot`, `FPDFAnnot_AddInkStroke`, `FPDFAnnot_SetAP`, attachment points, colors) | Written as `/Annot` objects with generated appearance streams, so other readers can edit or delete them. Keep existing vector export as a "burn in" option. |
| A2 | Edit existing annotations | `FPDFPage_GetAnnotCount`, `FPDFPage_GetAnnot`, subtype/rect/color getters, `FPDFPage_RemoveAnnot` | Select, move, restyle, delete annotations from any source. Reuse the native drawing canvas for selection. |
| A3 | Form filling | `fpdf_formfill` (`FPDFDOC_InitFormFillEnvironment`, `FORM_OnLButtonDown`, `FORM_ReplaceSelection`, field type/value getters) | Text, checkbox, radio, combo/list fields as native overlays. Save a copy; existing Flatten turns values static. No form authoring in this step. |
| A4 | Image and object editing | `FPDFPageObj_Transform`, `FPDFPageObj_GetBounds`, `FPDFImageObj_SetBitmap`, `FPDFPage_RemoveObject` | Move, resize, delete, replace images. Text-object editing already exists. |
| A5 | Reader outline and password entry | `FPDFBookmark_*`, `FPDF_LoadDocument` with password | Outline navigation and in-memory password prompt. |
| A6 | Content redaction | Object removal plus pixel rewrite for covered image areas | Removes intersecting text and pixel data, paints the box, and strips annotations and metadata in the region. Hardest step; the result must be verified by text extraction before saving. Until then, keep calling marks "cover", not "redaction". |

The vendored Android PDFium builds already ship `fpdf_annot.h` and `fpdf_formfill.h` (`modules/pdf-engine/vendor/android-*/include`). Confirm the iOS XCFramework exports the same symbols on the first macOS build.

### Status

- **A1 (first pass, implemented):** with "Keep new marks editable in other PDF apps" on (the default), Highlight, Draw, Shapes and Sign save as `/Annot` objects: area highlights become Highlight annotations with QuadPoints; strokes, lines and polygons become Ink; signature images become Stamp annotations. Each gets a generated appearance stream, `/CA` opacity, `T = Versara` and `NM = versara-<mark id>`. Turning the option off keeps the old page-content burn-in. Free text and sticky notes are not built yet.
- **A2 (first pass, implemented):** Tools → "Edit page annotations" lists annotations from any source on the current page (popups, links, form widgets and hidden annotations are excluded). Any unlocked annotation can be deleted; its popup goes with it. Highlight, underline, strikeout, squiggly, ink, square and circle can also be recoloured, have their opacity changed, and be nudged in 1% steps. The appearance is redrawn from the annotation's own geometry. Other types can be deleted but not restyled. Edits are staged as `kind: "annotation"` commands (`index`, expected `subtype`, `remove` / `color` / `opacity` / `dx` / `dy`), shown in the page preview with an outline on the selected item, and applied before new marks so indices stay valid. Drag-to-move on the canvas is not built yet.
- Capability flag: `PdfEngine.nativeAnnotationsVersion >= 1`. Staged annotation edits are not included in draft autosave yet.

Every step follows existing rules: bounded native queues, cancellation, staged output with validation, signature-bearing inputs rejected for destructive edits, original unchanged, draft autosave through the existing SQLite drafts.

## Track B — native DOCX editor

Goal: an honest "simple Word editor". It edits common formatting and preserves what it does not understand, instead of silently dropping it.

### Architecture

- New local Expo module `modules/doc-engine` with a shared C++ core, the same pattern as `pdf-engine`.
  - **miniz** (MIT): read/write the DOCX zip package.
  - **pugixml** (MIT): parse/write `word/document.xml`, `styles.xml`, `numbering.xml` and relationships.
  - Combined size is under 1 MB.
- **Round-trip safety:** the original package is kept. Paragraphs, runs, lists and simple images become an editable model. Anything unsupported (text boxes, fields/TOC, equations, tracked changes, comments, complex tables) becomes a locked block holding its original XML and is written back unchanged. Headers, footers, styles and section settings are copied through untouched.
- **Bridge:** C++ returns a bounded JSON model (size cap) to native code, never to JavaScript for large documents. Save sends the edited model back; C++ rebuilds only the body and re-zips all other parts byte-for-byte.

### Native editing surface

| | Android | iOS |
|---|---|---|
| View | `EditText` with spans | `UITextView` (TextKit 2, iOS 17 target) with `NSAttributedString` |
| Character styles | `StyleSpan`, `UnderlineSpan`, `StrikethroughSpan`, typeface/size/color/background spans | Font, underline, strikethrough, color, background attributes |
| Paragraphs | `AlignmentSpan`, `LeadingMarginSpan`, line-height spans | `NSParagraphStyle` alignment, indents, spacing |
| Lists | Custom bullet/number span | `NSTextList` (custom marker drawing if needed) |
| Images | `ImageSpan` from cached files | `NSTextAttachment` |
| Locked blocks | Non-editable placeholder span | Non-editable attachment |
| Undo/redo | Bounded command history | `UndoManager` |

The React toolbar reuses `TextStyleControls` and `ColorSwatches` and sends commands to the native view; typing never round-trips through JavaScript. Very long documents (roughly 200k+ characters) open section by section to keep native text layout responsive.

### Formats

- **DOCX:** open, edit, save, save as new.
- **New blank document:** built from a bundled minimal DOCX template.
- **TXT:** open and save.
- **PDF export:** Android `StaticLayout` onto `PdfDocument` pages; iOS TextKit pagination into `UIGraphicsPDFRenderer`. A4/Letter and margins. The result is a simplified layout, not Word-identical.
- **Legacy `.doc` (Word 97):** not supported. There is no free native engine for both platforms. The UI says so and suggests saving as DOCX.
- **ODT/RTF:** later, if requested.

### Integration

Files and Search open `.docx` in a new `/doc-editor` route. It adds a Home "Documents" card, Recents, Edited files, the existing recoverable save/replace flow, drafts and the leave-without-saving dialog.

### Steps

| Step | Scope |
|---|---|
| B1 | C++ core: read model, locked-block preservation, write back. Validate by reopening output and comparing untouched parts. |
| B2 | Native editor views on both platforms with character/paragraph styles, lists and undo. |
| B3 | Toolbar, route, Files/Search/Recents integration, drafts, save flows, new document. |
| B4 | PDF export and TXT. |
| B5 | Images: insert, resize, delete. Simple tables (no merged cells) move from locked to editable. |

### Status

- **B1–B5 (first pass, implemented):** `modules/doc-engine` reads and writes DOCX with miniz and pugixml. Paragraphs, character styles, alignment, bullet and numbered lists, simple tables and images are editable. Text boxes, fields, equations, tracked changes, comments, links and complex tables stay locked and are written back unchanged. Headers, footers, styles and other package parts are copied byte-for-byte. Documents longer than about 80,000 characters open one section at a time, up to 2,000,000 characters. The Home Documents card, Files, Search, Recents and Edited files open `.docx` and `.txt`. Legacy `.doc` explains that it is unsupported.
- Capability flag: `DocEngine.nativeDocEditorVersion >= 1`. Typing stays in the native editor. A local draft is restored when you reopen the same file.
- **Editor layout and headers (version 2):** The editor screen follows the Google Docs mobile layout. The page shows as a white card on a grey canvas. The top bar holds back, undo, redo, Format, Insert and More. A scrollable format bar sits above the keyboard, and it switches to image actions when an image is selected. Format has Text and Paragraph tabs with styles (Normal, Title, Subtitle, Heading 1–3), size, colours, alignment and lists. Insert adds images, tables, a header, a footer and page numbers. Header and footer text has its own alignment. Page numbers go in the header or footer as `1`, `Page 1` or `Page 1 of N`. These are written to `word/versara-header.xml` and `word/versara-footer.xml` with PAGE and NUMPAGES fields, and the default section references are updated. Headers or footers that hold content the editor can't show stay locked and unchanged. PDF export draws headers, footers and page numbers on every page.
- **Page setup, spacing, ruler and pages (version 3):** Options › Page setup changes the paper size (A4 or Letter) and the margins. It offers the presets Normal, Narrow, Moderate and Wide, and steppers for each side in inches or centimetres, following the device locale. Changes are written to `w:pgSz` and `w:pgMar` in the body section. The page card keeps its margins in proportion to its width, and PDF export uses the document's own page size and margins. Paragraph spacing lives on the Paragraph tab. It covers indent in 0.5 in steps up to 5 in, line spacing (1, 1.15, 1.5 or 2), and space before and after in 6 pt steps. These are stored in `w:ind` and `w:spacing`. The format bar also has indent buttons. The View toggles show a ruler with margin and indent markers, and a page strip under the editor. The strip has lazily drawn thumbnails and previous and next controls. Page breaks are measured at print width and shown as dashed "Page N" lines in the editor. Only the thumbnails near the visible page are kept in memory, and there is a limit of 300 pages.
- **Print layout and style fidelity (version 4):** The editor lays documents out as printed pages, the way Word or Google Docs do. It follows the document's page size and margins at a true point scale, and pinch zooms from 1× to 4×. Each sheet is drawn separately, with the header and footer on every page. Lines flow onto the next page at the page boundary, and forced page breaks, "page break before" and keep-with-next are honoured. The C++ core resolves `styles.xml` (document defaults, `basedOn` chains, paragraph and character styles, table styles), the theme fonts and `numbering.xml`. Every paragraph therefore carries its real alignment, left and first-line or hanging indents, space before and after, line spacing (auto, exact or at-least), tab stops, paragraph borders and shading. Every run carries its resolved font, size and colour. List markers use the numbering definition's format (decimal, letters, Roman numerals, bullets with their level text) and the marker indent. Line spacing follows Word's "single" metric, which uses the font's ascent, descent and line gap. Tables that can't be edited, including merged cells, cell shading, row heights, vertical alignment and borders, are drawn as real grids instead of placeholders. Content controls show their inner paragraphs, tables and images. Metric-compatible OFL fonts are bundled so documents keep their original line breaks: Carlito for Calibri and Caladea for Cambria on both platforms, plus Liberation Sans and Serif for Arial and Times New Roman on Android (iOS already has those fonts). They add about 6 MB, and their licence files ship with them. Pages stay white with black text in dark mode; only the surrounding app chrome goes dark. Thumbnails and PDF export draw the same layout, so exported pages match the screen.
- **Headers, footers and responsiveness:** Headers and footers sit at the document's own header and footer distance (`w:pgMar w:header` and `w:footer`) and wrap within the margins. When one is taller than the margin, the body moves away from it the way Word does. Pictures decode off the main thread and show a placeholder of the same size until they are ready; PDF export waits for any that are still decoding. After an edit, the page reflow runs as one pass once typing pauses, and never right after opening. Documents open whole up to about 400,000 characters, the way a print layout view shows every page, and longer ones open in parts of that size. Bold, italic, underline, strikethrough, size and colour also work with no selection: they apply to the next text you type, and tapping again turns them off.
- **Editing reliability, ruler and tabs (version 4.1):** Pressing Enter at the end of a paragraph adds a paragraph that keeps the previous one's paragraph formatting. Before this fix, the editor text and the document model fell out of step, and later typing was undone. Text typed at the start of a line takes that line's formatting. The caret and scroll-into-view use the glyph height at the baseline, so lines made tall by page breaks or spacing no longer produce a giant cursor. A document that ends with a table or picture gets an empty paragraph after it to type in. The ruler can be dragged: the top triangle sets the first-line indent, the bottom triangle sets the left indent, and the edges of the white band set the page margins. A guide line and the value show while dragging. Right, centre and decimal tab stops and their leaders (dots, hyphens, line) are drawn, so tables of contents line up with dotted page numbers. Section breaks start a new page. Pictures in VML (`w:pict`) and in `mc:AlternateContent` fallbacks are extracted. Inserted photos are turned upright from their EXIF orientation and limited to 2400 px, and the cursor moves to the line after the picture.
- **Documents home, Files recents and PDF text deletion (version 4.2):** The Documents module has two tiles, New document (blank DOCX) and Text file (blank TXT). Below them is the same recent list as the PDF module: library files plus DOCX and TXT files on the device. On Android the device files come from the MediaStore Files collection when All files access is granted (`FileEngine.listRecentDocuments`). On iOS they come from the folders chosen for PDFs. Export to PDF is in the editor's More sheet. On the Files tab, the Edited files shortcut is replaced by a Recent files section with All, PDF, Documents and Images filters, showing up to 15 rows. In Delete text, tapping text boxes marks them in red, and Select all, Clear and Delete (N) remove them in one undoable step (`markedIds` on `PdfEditCanvasView`, `nativeEditCanvasVersion` 3). When the canvas resizes (the editor bar, keyboard or busy footer appear), it keeps the zoom and the point in the middle of the view instead of returning to the whole page.
- **Known limits of the print layout:** Right indents are not applied on Android. On Android justification applies to the whole document, following whichever alignment covers most of the body text. On Android, tab alignment is measured on the paragraph's first line. Floating shapes, text boxes and wrapped images are shown inline. Fidelity depends on which fonts the document uses; fonts that aren't bundled fall back to the closest system font.

## Alternatives considered

- **Collabora Office mobile engine (MPL-2.0 and other open-source licenses):** chosen for offline DOCX fidelity. It is a large native build, with Linux required for Android and macOS for iOS; see [the integration status](38-libreofficekit-docx-research.md#integration-state).
- **MuPDF (AGPL), ONLYOFFICE mobile (AGPL / commercial SDK), PoDoFo (LGPL, App Store linking concerns), Pandoc (GPL):** excluded for licensing.
- **Apache POI / docx4j (Apache-2.0):** Android-only Java, large; the shared C++ core covers both platforms.
- **Commercial SDKs (Nutrient/PSPDFKit, Apryse, Foxit):** excluded by project rules.

## Verification per step

`npx expo lint`, `npx tsc --noEmit`, Android Kotlin and CMake compilation. No automated tests or web builds unless requested. iOS needs a macOS build. On devices, reopen outputs in other readers (Acrobat, Chrome, Word, Google Docs, Pages) to confirm annotations, form values and DOCX round trips. Profile memory and typing latency on long documents before making performance claims.

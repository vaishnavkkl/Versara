# PDF tool options layout

Repair, Compress, Duplicate, Insert, Export Images, Remove Metadata, and Flatten
previously opened a settings dock that could take 44% of the portrait height.
These tools now use the same Options bottom sheet as the PDF editor. Options
start closed, leaving the source preview the remaining screen space. Protect
still opens its required password sheet.

Compression quality presets and Estimate size are compact bottom controls.
The estimate summary appears above Compress PDF; a valid estimate for the
selected quality remains required. Compression guidance and detailed estimate
information live in the sheet. Export Images has JPG/PNG choices at the bottom,
with quality and page ranges in the sheet.

Existing page navigation, native preview gestures, fixed action placement, and
the landscape side actions remain. Options buttons use the editor's responsive
toolbar placement and are disabled while processing. Sheet fields use the
existing keyboard-aware input and form-sheet handling.

This is a JavaScript layout change and requires an app reload. Verification is
limited to lint, TypeScript, and source review. No automated tests, web/native
builds, or device interaction are run; the user will verify the layouts manually.


## Discoverability follow-up - October 12, 2026

Options are no longer discoverable only through a generic icon. A shared, labeled settings entry near the main action names available controls and displays current values where useful. It opens the existing sheet; it does not introduce a new settings flow.

- Edit PDF: Line / Paragraph selection is above the canvas, with mode-specific guidance. Mode changes are disabled while a text box is open so a draft cannot be silently discarded. Older native builds identify paragraph editing as unavailable. The paragraph toggle was removed from Options.
- PDF OCR: Text file / Searchable PDF output is directly visible. Pages and recognition settings have an explicit entry.
- PDF numbering/watermark: page scope and placement are visible; the entry names Position, pages and style.
- PDF insert/duplicate/extract/export: entries identify insertion location, page scope or image quality. Protection names the password requirement; repair, flatten and metadata entries explain their effects without advertising nonexistent controls.
- PDF markup and image drawing: Colour, thickness and style is visible near the main action. Image redaction no longer presents an inactive style shortcut.
- PDF/image text: Font, colour and spacing is accessible through a labeled entry when the keyboard is closed; existing toolbar controls remain available while typing.
- Image resize, compression, conversion, watermark, perspective and batch: the entry names the actual settings and current format/quality, size target, opacity or image count. Resize and Export tabs in the main image editor retain a visible way to reopen their sheets.
- Exposure, curves, levels, HSL, sharpen, blur and canvas were reviewed and already expose their controls below the preview; they receive no redundant settings entry. Image crop, rotate, filters and adjustment tabs keep their existing visible controls.

The surrounding tool menus, save/apply behavior, processing implementations and preview gestures are unchanged. Lint and TypeScript passed. Visual inspection covered the connected Android Highlight screen only; other screens and accessibility/landscape behavior remain manual checks. No automated tests or web builds were run.

### Highlight controls and editing cues

Highlight exposes Area highlight, Highlighter brush, and Eraser directly beside the preview, with colour, opacity, and brush thickness in Highlighter options. It does not expose the drawing brush collection, dashed/dotted strokes, or the general annotation panel. Erasing new marks works for both rectangles and freehand highlights; Undo restores them. Existing flattened marks remain part of the PDF page.

Original-font text uses a labelled, outlined input below the page. Paragraph input allows multiple lines. Native on-page inputs have stronger blue boundaries and a blue caret.

### Consistent actions and quieter headers

PDF, image, and privacy tools use the shared EditorActionBar for bottom actions. Cells in a bar have equal widths and share the tallest measured height; labels wrap, larger accessibility text reduces column count, and narrow landscape rails stack actions. Save/Apply has the same geometry as Options, selection, and mark controls. Processing callbacks and disabled conditions are preserved.

Tool headers use a three-dot More options menu for Share, Help, and orientation when supported. Reader menus also contain bookmarks and reading options. Active Help keeps a visible exit button. The duplicate header Save/Apply actions were removed; image editors now place their primary action below the working area. A carried PDF with no new edits retains Save in More options so changes from the previous tool can still be saved. Back, tool switching, page navigation, and undo/redo remain directly accessible.

Validation is limited to source review, TypeScript, lint and whitespace checks; no automated tests or web builds are requested. Device verification should include long labels, large text, landscape, all overflow actions, and one Save/Apply flow per tool family.

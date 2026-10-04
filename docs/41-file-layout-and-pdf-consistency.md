# File layouts and PDF operation consistency

## Custom Files and file selection

The Files root uses one FlatList: storage locations are its header and recent
files are virtualized rows. The list/grid toggle is the same persisted preference
used by the category libraries. Grid switches to list on narrow screens or at
large text sizes. Selection state stays in the picker route when layouts change.

Recents and device folders reuse one sorting menu: name, date, size, or type,
with ascending/descending labels appropriate to the field. Folder and recent
sort preferences persist separately. Recents defaults to newest first.

Recent queries retain existing native limits; the display contains at most 30
recent items, sorted within that recent set. Three metadata snapshots avoid
repeating fresh queries on navigation, expire after four seconds, and invalidate
on library changes. Pull-to-refresh forces another query. Off-screen loads
discard callbacks, and only visible rows mount thumbnails. Rows are memoized;
selection lookup uses a Set. There is no nested vertical ScrollView/FlatList.

These are bounded workloads, not measured frame-rate or memory guarantees.
Native thumbnail cache and queue bounds remain those of the existing engine.
Scrolling and memory performance still require device profiling.

## PDF tool audit and changes

| Tool family | Preview and controls |
| --- | --- |
| Edit, Add, Remove, Replace text | Existing shared page canvas, page controls, compact editing actions, Options/style sheets. |
| Highlight, Draw, Shapes, Sign | Existing shared canvas/page toolbar with style sheets and fixed actions. |
| Repair, Compress, Flatten, Metadata removal, Duplicate, Insert, OCR, Extract text, Export images, Numbering, Watermark, Protect | Shared preview and Options sheets from the previous layout fix. Protect opens its required password sheet. |
| Merge | Larger portrait PDF cards replace tiny row thumbnails. Tap a card to open the same full-page preview as Reorder/Delete. Order arrows and remove remain on each card; Add PDFs, Options, and Merge PDFs are fixed at the bottom. |
| Split | Opens the source in the shared full-height document preview. Simple split modes stay at the bottom; group size, ranges, and output name use Options. |
| Extract/Delete pages | Existing virtualized selection grid and shared page preview, with a shorter header. Select all and primary action stay at the bottom; range entry and file settings use Options. |
| Reorder | Existing drag grid and shared page preview, with a shorter header. Reverse/reset and Save PDF stay at the bottom; file settings use Options. |
| Rotate | Existing full-height live rotation preview. File settings now use Options instead of expanding a dock that shrinks the preview. |
| Images to PDF | Uses the same ordered source cards as Merge. Page-size presets and primary actions stay at the bottom; output name and guidance use Options. Image-source preview uses the shared toolbar/stage and handles Android Back. |
| Document information | Remains an informational metadata screen with Preview PDF; it has no edit/export operation to configure. |
| Reader | Retains its shared page controls and reading-specific layout. |

The shared PDF file-options sheet uses the existing keyboard-aware sheet input.
Operations retain their native processing, cancellation, limits, page selection,
and output validation. Source grids only request visible thumbnails and fall back
to a single column at larger text sizes. Previewing does not create a merged or
converted PDF as a background task; it shows the chosen source.

## Verification

Run lint and TypeScript checks only. No automated tests, web/native builds, device
interaction, or performance profiling are run at the user's request. Manual
checks should cover toggling layouts with a selection, all sort fields/directions,
refreshing after an edit, merge order and source preview, split ranges, extract/
delete selection, reorder/reset, rotate scope, image conversion, large text,
landscape, keyboard dismissal, cancellation, and result actions.

This change uses existing native methods and requires a JavaScript reload on a
compatible installed build.

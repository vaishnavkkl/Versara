# Shared native drawing controls

Updated 2026-09-29. The existing PDF/image markup canvas, tool controls and native exporters are extended; no cloud operations, paid SDK or alternate editor is added.

## Tool: Ink opacity

Purpose: control the transparency of newly drawn or selected marks. The existing brush settings contain an optional native slider from 1 to 100%, with a numeric percentage. Pen/pencil/marker/highlighter retain their existing initial opacity values. Brush selection supplies its width and opacity preset together.

Data: `PdfMark.opacity?: number` stores a normalized value from 0.01 to 1. `PdfMarkupView.inkOpacity` configures new marks; `-1` means use the existing brush default. Existing marks without opacity continue using their brush defaults; legacy non-highlight shape fills remain opaque. Explicit opacity applies to stroke and fill in native previews, Android/iOS image raster export and PDF vector export. Image redaction remains opaque regardless of a mark's opacity field.

Undo/redo: a selected mark style update records the old and new mark. Consecutive updates to the same mark and property keys within 450 ms are coalesced, preventing a normal slider drag from exhausting history. A pause longer than that begins another history action. New stroke settings do not rewrite existing marks automatically.

## Tool: Stroke eraser

Purpose: remove a complete editable ink stroke. Its labeled eraser option is in the existing brush controls. This is not a pixel eraser, painted mask, lasso or redaction tool.

Gestures: one finger touches or sweeps across pen, signature, highlight-brush or line marks. Native hit testing checks stroke segments in displayed page coordinates with a touch tolerance and stroke width allowance. A sweep checks the movement segment between sampled touch positions, so a fast drag can cross a stroke between input events. Shape polygons and area highlights use selection plus Delete instead.

Data: `mode="erase"` removes hit marks from the native gesture preview. At a successful gesture end, one `onMark` event per erased ID contains serialized `{id, deleted: true}`. Adding a second finger, cancelling the gesture or changing tools restores the pending erasure; it does not commit a deletion. This keeps two-finger pan/zoom separate from drawing/erasing.

Undo/redo: JS applies each deletion through the shared mark history. Deletion records the original mark and insertion index so undo restores both content and stacking order. No deletion record is saved as an actual drawing mark.

Persistence/export: only the remaining marks are passed to native PDF/image export. The stroke eraser edits this session's editable marks; it does not claim to erase arbitrary pre-existing PDF page content or pixels in the source image.

## Tool: Selected mark actions

Purpose: use the existing Select & resize mode to identify a mark, change supported style properties, duplicate it or delete it.

Data/events: `onSelection` sends `{mark: string}`. A non-empty string is serialized selected-mark data including its stable ID; an empty string means no selection. Selection is retained by ID when marks update, rather than by array position. Deleting or undoing another mark cannot silently retarget the selected index to a different object.

History: `update(id, patch)`, `remove(id)` and `duplicate(id)` all participate in undo/redo. Duplication creates a distinct ID, shifts the copy slightly while keeping points on the page and respects the existing 300-mark/20,000-point limits. Native move/resize still commits only completed gestures. A tool switch during an unfinished move/resize restores the uncommitted native geometry.

## Draft history contract

`useMarkHistory` exposes `snapshot: {marks, past, future}`, `restore(marks)` and `restoreSnapshot(unknown): boolean`. Each history change contains the before/after mark, stacking index and a human-readable action label. Bitmap copies are not stored. Past and future stacks are each bounded to 40 changes.

`isMarkHistorySnapshot` validates IDs, mark kinds, finite normalized points, colors, width, opacity, point/mark limits and change records. It also checks that reversing past actions and replaying future actions are coherent with the stored current marks. Persisted history is bounded to 150,000 point references across its payload. If history cannot be validated, `restoreSnapshot` recovers only valid bounded current marks and returns false; invalid history is not sent to the native canvas.

No runtime assertion of crash recovery is implied by this contract; callers own durable local storage and use the returned result when explaining a recovered draft.

## Compatibility and validation

The new features require `PdfEngine.nativeMarkupEditingVersion >= 1`. Image tools additionally require `FileEngine.nativeMarkupEditingVersion >= 1` so the native image export understands opacity. Existing dotted/dashed controls retain their separate stroke-pattern capability checks. Older binaries must not enable erase/opacity controls merely because the original drawing view exists.

The component contract exports `PdfMarkChange = PdfMark | {id: string; deleted: true}`; consumers must branch on deletion before reading points or page fields. Existing `onMark` and new `onSelection` event payloads both retain the existing JSON-string bridge format.

Source review covers alpha fallback parity, completed-gesture commits, eraser cancellation, stable selection, bounded history and native teardown. Lint/typecheck and consolidated Android compilation belong to the root task's validation. iOS compilation, actual visual opacity, touch behavior and frame-time profiling remain unverified. No connected-device automation, cloud run or automated test was performed by this subtask.

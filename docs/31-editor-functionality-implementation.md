# Native editor implementation — 2026-09-29

This implements the integrity/recovery foundation and a first set of editor features from the professional-editor audit. It extends the existing routes, controls and native engines. It does **not** represent completion of every feature in sections A–BC of the supplied specification.

## Implemented

- PDF reader search runs in the shared native PDFium engine. The existing reader exposes a search field, result highlights and previous/next controls. Work is cancellable and bounded; it does not OCR scanned pages automatically. See [PDF integrity and search](30-native-pdf-integrity-and-search.md).
- Drawing adds opacity, whole-stroke erasing, selected-mark style changes, delete and duplicate. Move/resize, dashed/dotted patterns and history use the same native preview/export data. These actions operate on the editor's marks; they do not reconstruct arbitrary pre-existing page graphics. See [drawing controls](editor-drawing-controls.md).
- Basic image crop, rotation, adjustments, filters and export settings have bounded undo/redo and an Original comparison. Crop restoration uses a native request on history changes, without replaying gesture callbacks into history.
- Advanced image settings have bounded undo/redo and Reset. Drawing retains its separate mark history. Tool handoffs preserve the current rendered image in a durable local workspace; no mandatory external save is needed to switch tools.
- Follow-up color tools add native tone curves, input Levels and eight-range HSL controls through the existing advanced image workflow. See [advanced color controls](32-native-tone-curves-hsl.md) for current controls and limits.
- Scan Text (OCR) also supports searchable PDF output by inserting a verified invisible text layer into original pages. The existing text-file output remains available. See [OCR and preview follow-up](33-ocr-and-image-preview-follow-up.md).
- Local SQLite drafts cover basic image settings, committed image text edits, single-image advanced settings, image drawing, PDF text commands and PDF drawing. PDF text includes a valid open text-box command. PDF/image mark drafts restore validated undo/redo deltas; image/PDF text drafts retain bounded snapshot history. Basic/advanced image setting drafts restore the current settings, not their earlier undo stacks.
- Single-PDF edit imports retain a durable library original so a draft can be reopened from Recents after a restart. Choosing another PDF changes the save origin as well as the preview, preventing replacement of the previous document.
- Save/Discard clears the applicable draft. Backgrounding and teardown flush command state; explicit Discard prevents an outgoing screen from recreating it. Autosave is debounced 600 ms, bounded to 100 entries and a conservative 2 MB per entry. The pending queue coalesces by draft ID, respects delete barriers, and caps eight queued payloads / 4 MB. Errors remain visible and do not silently evict unsaved work.
- Image workspaces retain at most two accepted working images per source. A lease spans native rendering and manifest persistence, including recovery reads, so cleanup cannot delete an in-flight handoff. Simultaneous handoffs are rejected. No image bytes or native bitmaps are retained in JavaScript history.
- Native image exports preserve source resolution unless explicitly resized or target-size compressed; memory limits fail with an actionable message rather than silently reducing resolution. PNG alpha and JPEG background handling are corrected. See [image integrity](28-native-image-integrity.md).
- PDF compression preserves document structure, metadata removal no longer redraws iOS pages, signature preflight rejects destructive edits, and supported native saves preserve encryption. Paths unable to preserve encryption reject the operation explicitly. Flatten remains an explicit separate operation.
- App/device replacements use recoverable staging and backups. Device publication precedes replacement of the app original; native device replacement is verified and recoverable. Startup resumes interrupted app saves. See [recoverable saving](30-recoverable-file-saving.md).
- Android image OCR now uses bundled free/open-source Tesseract with English data; native OCR can be cancelled. iOS Photos imports refuse cloud downloads. Unused notifications/Firebase autolinking and app backup paths were removed/disabled. See [offline storage and OCR](29-offline-native-storage-and-ocr.md).

## Deliberate limits and remaining specification work

- Cross-tool image handoffs still render a working raster. This is not a persistent editable layer graph, and Undo does not cross a baked handoff. Batch asset selections, logo-watermark assets and region selections are not fully recoverable project documents. An uncommitted image text box is not autosaved until applied.
- Source identity uses app-owned URI, size and modification time rather than a document-content hash. Recovery requires the original library file to remain available. An abrupt process kill may lose the last debounce interval.
- Drawing still exports PDF page vectors rather than a complete semantic PDF annotation editor. Pressure-aware fountain/calligraphy brushes, pixel/lasso erasers, annotation import/editing, measurement and collaboration remain outside this implementation.
- The audit's other missing capabilities remain outstanding, including PDF form authoring/filling, content redaction, scanner capture, full object/image editing, advanced reader outline/bookmarks/modes, multilingual OCR, image layers/masks/blending, healing/clone and subject segmentation. Existing basic tools must not be presented as substitutes for these features.
- OS document providers and user-invoked share destinations can use their own networks. Versara does not upload documents to a processing service. No paid SDK or cloud operation was introduced or used.

## Verification

- Project lint and TypeScript checks passed; repeated after final JavaScript lifecycle changes.
- Offline Android `:pdf-engine:compileDebugKotlin`, `:file-engine:compileDebugKotlin` and `:pdf-engine:buildCMakeDebug[arm64-v8a]` passed. Remaining native output includes deprecated library/API warnings.
- No device automation, device installation, emulator, automated test, web build or cloud build was run.
- iOS received source review only on this Windows host. Native changes require a rebuilt app. Export fidelity, recovery under power loss, OCR accuracy, gesture behavior and frame timing still need runtime verification; source/build checks cannot establish those results.

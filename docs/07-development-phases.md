# Development Phases & Priority

Current scope: PDF, Image and Privacy. Audio, Video and Device are separate modules; see [scope decision](23-standalone-module-scope.md).

## Phase 1: Foundation
Expo, TypeScript, Expo Router, local file access, accessible themes, history and bounded native jobs. File-first screens and searchable tool catalogs.

## Phase 2: Image utilities
Crop, rotate, flip, resize, compression, conversion, text edits, metadata removal, and image-to-PDF. Native previews and explicit Save/Save As with file naming.

The remaining image catalog now has native Android/iOS implementations, including batch processing, perspective, borders, blur, sharpening, drawing, watermark and redaction. See [current capabilities and validation limits](27-image-tools-and-file-actions.md). Device profiling and iOS build verification remain release work.

## Phase 3: PDF utilities
Reader with native selection/copy; edit/add/remove text; OCR; page organization; compression/export; highlight, brush, shapes, signatures and watermark; configurable page numbering with preview; protection, metadata, flatten and repair. Free open-source native processing on Android and iOS, offline.

## Phase 4: Screenshot privacy
On-device OCR, reviewable rule-based text suggestions, manual opaque covers and metadata-free PNG export are implemented. See [Privacy scope and limitations](05-privacy-network-device.md). Face/QR recognition and arbitrary semantic entity recognition remain outside the current detector; manual covers are available. Android/iOS runtime verification and device profiling remain release work.

## Release quality work
- Keep input and Done/Apply actions visible with the keyboard; preserve preview space.
- Fixed quick actions plus a searchable toolbox, with Edit PDF, Scan Text, Remove Text and Add Text first.
- Native drawing/zoom, bounded undo history, consistent saved output, clear failure/retry states.
- Tear down preview canvases and cancel queued work when leaving editors. Profile navigation, RAM and long-document behavior on Android and iOS devices.
- Lint, TypeScript and relevant native compilation are required. Do not run automated tests or web builds without an explicit request.

## Later in this app
Optional local assistance for documents/images only after deterministic tools are stable. Workflows: prepare a PDF (merge, reorder, edit, compress, sign); make an image shareable (resize, metadata removal, privacy review, export).

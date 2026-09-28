# Privacy module and editor toolbar placement

## Privacy entry and review

Home and Search expose Privacy Review, Redact Image and Remove Metadata. Tool-history identifiers use the Privacy category to avoid collisions with Image tools. The full-screen route has no bottom tab bar and follows the existing preview, footer, dialog and color system.

The privacy editor imports one image into a temporary session, reads common metadata, and creates a bounded, upright native preview. This avoids passing the original full-resolution or EXIF-rotated image into the markup canvas. OCR and final export use the original, with the same normalized upright coordinate system. Detected text and cover history are kept in memory only.

The final PNG uses the existing native image viewer's bounded viewport decode and zoom detail, inside the shared preview frame. Viewing an export does not load its full-resolution raster into the PDF editing canvas.

Suggestions start unchecked. Users can review each match, select all, deselect suggestions, or add manual covers. The shared native markup canvas provides selection and resizing; bounded command history supports Undo and Redo. Every rescan receives a separate finding namespace, so a changed OCR line order cannot mark an unrelated new finding as already covered. Existing covers survive rescanning.

Preview copy snapshots the current covers and produces the actual final PNG on a native worker. Export takes a synchronous UI lock, including on history controls. The result displays its snapshot's cover count. Save copy asks for a name, preserves the original and records only the generated image in Edited files. Device export and sharing use this saved output. A failed device save leaves the app copy available for retry.

## Native processing

The FileEngine.nativeImagePrivacyVersion capability gates the new APIs:

- scanImagePrivacy(id, uri) returns dimensions, normalized rectangles, categories, heuristic match scores and a truncation flag.
- cancelPrivacyScan(id) stops only that privacy job.
- processImage(id, request) with tool: "privacy", action: "preview" or "export" and rects creates an opaque PNG. An empty rectangle array performs metadata removal.

Android uses the existing bundled Tesseract OCR; iOS uses Apple Vision. Each privacy scan owns its recognition key so cancellation cannot terminate an unrelated image-text edit. Jobs, recognized lines, returned findings and cover counts are bounded. No new library or cloud service is required.

Privacy export is a separate path from existing image filters and drawing tools. It normalizes orientation, flattens transparency onto white, overwrites selected rectangles black with outward pixel rounding, encodes PNG, filters metadata chunks, reopens the result and verifies every covered pixel before atomic commit. Transparent source pixels, EXIF, text/XMP metadata, embedded thumbnails and trailing data are not copied into the published PNG. Export preserves dimensions within the device's memory budget; oversized requests fail with guidance.

The current detector is based on English text rules. Its confidence values are match scores, not calibrated probabilities or an assurance that every sensitive item has been found. Automatic QR/face recognition is not included. See the supported categories and limits in [Privacy tools](05-privacy-network-device.md).

## Toolbar placement

The shared responsive toolbar measures available footer width and inert equivalents of the current labels/icons, including accessibility font scaling. Style, Select, Brush/Area and Settings stay at the bottom when the existing Save/Undo/Redo actions leave enough room. The top is used only when this group cannot fit. The measurements are independent of placement, do not mount duplicate buttons and retain prior widths while changing labels are measured.

## Verification

Verification is limited to source review, lint, TypeScript and local native compilation. No connected device, emulator, automated test, web build or cloud build is used. Device checks for visual fit, gesture alignment, recognition accuracy and frame times are still needed before release; iOS compilation requires a Mac with Xcode.

Checks for this change: full Expo lint and TypeScript passed, git diff whitespace checks passed, and the offline Android file-engine compileDebugKotlin task passed. Native source review covered orientation, cancellation, opaque coverage, PNG metadata filtering and resource release on Android and iOS.

## PDF privacy and recent-file selection

Privacy and Search now open the shared recent Images/PDFs screen in selection mode. Native lists, cached recents, search and grid/list preference are reused. Choosing a file opens the selected privacy workflow directly; optional Open still uses the normal import picker. Remove PDF Text keeps its explicit non-redaction label.

Redact PDF reuses the image privacy detector on a bounded, upright rendering of the current PDF page. Suggestions start unchecked. Covers use normalized top-left coordinates and retain their page number across navigation; undo/redo follows the changed page. Users must visit and review every page: this is a per-page scan, not an automatic whole-document audit. The UI permits 300 covers per document and retains only the current page raster and bounded cover history.

`PdfEngine.nativePdfPrivacyVersion` gates `processPdf` operation `redact`. Both native implementations validate region coordinates and page numbers, overwrite selected raster pixels with opaque black using outward rounding, and write only the resulting images into a fresh PDF. No source text, attachments, cropped-out content, source metadata, forms, links or source object history are imported. Android uses lossless image embedding; iOS draws the overwritten CGImage into a new PDF context. Export renders sequentially at up to 160 dpi under the existing device-dependent pixel cap. Visible content outside covers remains, but all output pages are image-based; this tradeoff appears before preview and save. Encryption-restricted and signed documents retain the existing explicit rejection behavior.

A temporary PDF is validated for readability and page count before commit. The shared PDF preview displays the exported copy before named Save copy, which records it in Edited files and Recents. Native cancellation/progress uses the existing bounded PDF worker, backgrounding cancels preparation, and teardown waits for pending processing before clearing session files. No new SDK or network processing is added.

Android Kotlin compilation passed locally offline. iOS changes require Xcode compilation on a Mac; no device automation or runtime security/performance certification was performed.

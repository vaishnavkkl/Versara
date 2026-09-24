# Native PDF text editing

## Implemented flow

The PDF catalog now connects **Edit Text**, **Remove Text**, and **Add Text** to the same native editor. Choose a PDF, navigate to a page, select an outlined text object (or its text-list entry), and replace or delete it. Add Text lets the user tap a baseline position, choose size/color/font, and insert a line. Apply generates an accurate native preview. Undo keeps the last 30 edit states; save applies changes across pages to a new PDF. Open and export use the existing native viewer and system save/share flow.

### Full-screen editor and file selection

Implemented PDF tools and Image to PDF open the system file picker directly from their catalog cards. Cancelling stays on the catalog. After selection, `src/app/pdf-tool.tsx` opens a full-screen native stack route outside the bottom tabs; no editing or reading sheet is used. A temporary session passes ownership of cached files into the selected tool, without another copy or second picker. Merge and image conversion support multiple selection. Inactive, unimplemented tool previews retain their existing preview UI.

The editor gives the PDF a dedicated, bounded canvas, with compact page controls above and editing controls below. It supports focal-point pinch zoom (1–5x), one-finger pan, double-tap zoom, and Fit. Gesture calculations and image transforms run on the UI thread using Gesture Handler/Reanimated; no PDF processing moved into JavaScript. Tap coordinates are transformed back into page coordinates before selecting text or placing a new text box. Text selection also remains available through the text list. Keyboard and editing controls resize the canvas without nesting it inside a form scroll view.

The route's close button sits 2 points below the top safe area, immediately below the status bar, and stays visible in the PDF viewer's focus mode. Processing tools cancel and defer cache cleanup until native work finishes when the screen closes. Development-mode effect replay does not delete the new selection or cancel its opening job.

For manual checks: cancel each picker; select PDFs/images directly from each implemented card; pinch, pan and double tap in the editor; edit text while zoomed; place text on a rotated page; show/hide the keyboard; save and reopen; check viewer focus and close placement on notched iPhones and Android status bars. This update changes the UI/navigation only and uses the existing native PDF build.

PDFs describe positioned drawing objects rather than word-processor paragraphs. The UI identifies individual text fragments. Replacement does not reflow surrounding content. Original-font replacement preserves the object's matrix and graphics state; choosing another font creates new text at the original baseline. The original file remains unchanged.

## Native implementation

- Shared C++17 core: `modules/pdf-engine/cpp/TextEditor.cpp`.
- Android: Kotlin worker queue, JNI, PDFium shared library, CMake.
- iOS: Swift Expo API, Objective-C++ worker bridge, the same C++ core and PDFium framework.
- Bridge payloads carry file URIs and small JSON edit records. PDF parsing, text discovery, mutation, bitmap rendering, PNG encoding and PDF writing happen natively on worker queues. PDF bytes and bitmap buffers never cross JavaScript.
- PDFium is serialized behind one mutex; per-platform jobs have cancellation checks before/after native operations, between changes, and during PDF save callbacks. An individual native parse/render operation must finish before cancellation can take effect.
- Previews load one page, with a 1.6-million-pixel bound and 1440-pixel maximum dimension. Typing, font, size, color and placement changes schedule a native draft preview after 250 ms without further input. Apply commits that draft to the edit history; Cancel restores committed edits. Text validation parses a page once per batch.
- Text removal calls `FPDFPage_RemoveObject` and regenerates the content stream. It is not a rectangle covering the original text. Saving uses a full rewrite (`FPDF_NO_INCREMENTAL`), stages a `.partial` file, verifies page count, then renames it into app-owned storage.
- Deletion is **not secure redaction**. Metadata, annotations, other occurrences, accessibility structure or unreferenced resources can still contain information. The UI makes this distinction.
- Cached source paths and app-owned output roots are validated natively. Existing outputs, encrypted/restricted PDFs and signed PDFs are rejected.

## Supported scope and limits

- Direct page text objects support replacement and deletion. New text can be added to scanned pages too, but existing image pixels are not editable text.
- Text nested inside Form XObjects, clipping text, scanned text and outlined/vector lettering are not offered as editable objects. Native editing does not include OCR.
- Replacement uses the original font if requested. Subset fonts may lack new characters. Native readback rejects unsupported characters instead of silently saving missing glyphs; Helvetica, Times and Courier are fallback choices with limited character coverage. Complex-script shaping and automatic layout/reflow are not implemented.
- Up to 2,000 pages, 500 pending changes, 2,000 discoverable text objects per page and 4,000 UTF-16 code units per text line. The visual overlay is capped at 300 objects for responsiveness; the paginated text list exposes all discovered objects.
- Font changes can affect metrics and stacking order; preview the output before using it.

## Dependencies and builds

The commercial Nutrient package and plugin were removed. PDFium Chromium revision **8066** is pinned, including SHA-256 for each Android and iOS archive. `npm install` runs `scripts/prepare-pdfium.mjs`; `npm run native:pdfium` prepares dependencies explicitly. Downloads happen during development/build setup only. Runtime editing works offline.

On macOS, the preparation script wraps the iOS dynamic libraries into an XCFramework with a device slice and a universal simulator slice. CocoaPods invokes preparation if needed. The module podspec lives at `modules/pdf-engine/PdfEngine.podspec`, so both platform and shared C++ source are within the pod root.

The pinned iOS binaries require **iOS 17.0**; SDK 57's built-in `ios.deploymentTarget` sets the matching deployment target. Android arm64 binaries use 16 KB ELF load alignment, and the JNI library links with the same alignment. All four Android ABIs are configured. Dependency licenses are bundled on both platforms.

A new native development build is required; Expo Go and an existing binary without this module cannot run the editor. Windows can compile Android but cannot validate the iOS Xcode/CocoaPods build.

## Opening-performance changes

- Reuse the system picker's disposable cache copy by moving it into the tool's cache, avoiding a second full-file copy. Other input locations are copied, never moved.
- Remove the extra 600 ms JavaScript splash overlay; reveal the app once its saved theme and first layout are ready.
- Mount tabs on first visit and retain them afterward.
- Run PDF cache cleanup after loading, at most once per day in the process.
- Keep a bounded 12 MB native bitmap cache in the Android scrolling viewer to reuse recently viewed pages. Clear it when changing/closing documents. Displayed bitmaps are not forcibly recycled while Android's renderer might still reference them.

These remove identifiable work; no on-device timing or performance benchmark was run.

### Live editor preview scheduling

`pdf-preview-queue.ts` serializes native page rendering, cancels superseded work and rejects stale results. Only current-page changes cross the bridge for preview; Save still processes all committed changes. A one-result cache lets Apply reuse an identical completed preview. Draft previews leave the keyboard, zoom and pan available. Invalid text or unavailable font characters produce an inline preview error instead of committing an invalid edit.

The canvas is memoized with stable selection callbacks so typing does not reconcile its text outlines on every keystroke. Preview images retain their bounded native resolution when zoomed, and superseded images are removed periodically even during continuous editing. Closing waits for rendering to settle before removing session files. PDF reading, editing and rasterization remain in the existing Android/iOS native engine.

For manual verification, type quickly and pause, change fonts, add and move text, change its size/color, clear a text box, cancel a draft, apply, undo, navigate pages during a preview and close during rendering. Confirm that old drafts never replace newer previews and saved output matches applied changes. Preview latency still depends on the document and device; no runtime benchmark has been performed.

## Manual verification

No automated tests or web builds are run, per project preference. Typecheck, lint and Android Kotlin/C++ compilation are the available static validation.

Completed checks: `tsc --noEmit`, `expo lint`, Kotlin compilation, C++ compilation for all four Android ABIs, and the module's native-library/asset merge tasks. Both PDFium and the editor JNI library are present for every ABI, and the license assets are packaged. iOS compilation and runtime behavior on both platforms remain for device verification. Android compile output is in the ignored `android/build/native-editor-compile.log`.

On physical Android and iOS devices, open an ordinary text PDF and replace a word using the original font; try a missing subset-font character and a fallback font. Delete a fragment on a colored background, add text, undo, edit another page, save, reopen, and use text selection/search to inspect the result. Check rotated/cropped pages, scans, grouped text, signed/password-protected PDFs, cancellation, tool close during rendering, low storage, dark/light mode and opening a large local PDF. Verify that the original is unchanged and edits remain after relaunch.

# Native PDF suite and full-screen modules

## Scope

All remaining PDF catalog entries now have Android and iOS implementations and tool screens: information, duplicate/insert pages, compression, JPG/PNG export, highlight, freehand drawing, rectangle/ellipse shapes, visual signatures, watermark, page numbers, password protection, metadata removal, flattening, English OCR, text export and repair attempts. Existing reader, organization, image conversion and text editing workflows remain in place.

Modules moved from hidden tabs to `src/app/(modules)` with a separate native stack. Home, Files, Search and Settings remain the four main tabs. The dashboard uses the existing dark gradient card tokens, colored icons, a search shortcut and revised spacing/type hierarchy. The optional demo remains below the tools.

## Native processing

- Android: existing PDFBox Android 2.0.27.0 plus Apache-licensed Tesseract4Android 4.9.0. English `tessdata_fast` 4.1.0 is bundled at build time, verified against SHA-256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`. No OCR model download occurs on a user's device.
- iOS: system PDFKit, CoreGraphics, ImageIO and Vision. No commercial SDK or service was introduced.
- Dedicated serial workers cap outstanding jobs at four, with cancellation checks between pages and before commit. A currently executing native parse, OCR call or serialization finishes before observing cancellation. Temporary inputs are retained until the worker releases them.
- Paths are restricted to imported cache inputs and the app's PDF output directory. Staged files are validated before commit; cancellation/failure removes partial and committed files belonging to the failed job.
- Inputs/results are limited to 2,000 pages. Image batches are limited to 100 pages. Rendering uses a 1.5–3 million pixel budget depending on device memory. Annotation sessions cap marks, points and request size. Only final stroke coordinates cross the bridge; native views handle touch sampling and live rendering.
- Preview work is gated on screen/app focus. Native canvases and preview resources are released when covered or unmounted. No performance or leak guarantees are implied without profiling on devices.

## User-facing behavior and limits

- Output names are requested before processing; collisions use a numbered suffix. Save to device and Share remain available. Saved PDF results use the existing return-route replacement so opening an edit updates the originating reader.
- Max-quality compression performs a lossless rewrite and may not shrink the file. Balanced/Smallest rasterize pages, with a sample-based estimate before processing and actual sizes afterward. Flattening also rasterizes visible annotations/form values. These choices explicitly explain the loss of selectable text, links and editable forms.
- OCR recognizes English and exports UTF-8 text; it does not add a searchable text layer to a PDF. The UI displays a bounded 16 KB preview; exports contain all recognized text. Text extraction exports the existing text layer.
- Drawing/signing creates visible PDF marks; signatures are not cryptographic signatures. Watermark text currently uses printable ASCII for consistent standard-font support across platforms.
- Passwords are accepted only in memory, never stored in history. Protected output is reopened with the new password before success. The current reader does not provide password entry; protected results offer Save/Share with an explicit password-capable-reader explanation.
- Metadata removal clears document properties, not visible personal information or secure redaction. Android also removes reachable XMP dictionaries. iOS rewrites vector page content without the source's document properties; links and forms become static, as disclosed in the screen. Platform-generated producer information may remain.
- Restricted documents and signature-bearing inputs are rejected for modification. Input-password entry is provided by the advanced tool screen; some older tools/readers continue to require unlocked copies.
- Repair means a lenient native parse followed by a full rewrite, reopening, checking the page count and rendering every output page. Unreadable/missing content cannot be recovered, and failure never displays a repaired result.

## Verification

- `npx expo lint`: passed with no warnings.
- `npx tsc --noEmit`: passed after regenerating route declarations.
- `:pdf-engine:compileDebugKotlin`: passed with the new OCR dependency; only PDFBox deprecated color-overload warnings and existing Gradle deprecation notices.
- `git diff --check`: passed.
- No automated tests or web builds were run, per project instructions.
- iOS compilation, fresh native installs, manual output inspection, large/malformed-file exercises and frame-time profiling remain pending. The Android native compilation is not evidence of runtime correctness on either platform.

New native builds are required. JavaScript reloads/OTA updates cannot add the module methods, drawing views or OCR library. Existing builds show a clear build-required message instead of invoking missing native methods.

The Windows route watcher in `@expo/router-server` 57.0.10 compares backslash paths with POSIX route keys and can mistake files outside `src/app` for routes. `scripts/patch-router-types.mjs` normalizes the relative path before containment/key comparisons. This version-specific patch runs during postinstall; restart an already-running Metro instance to load it.

## Manual checks for fresh builds

Check each catalog entry, cancel mid-job, repeat exports with the same name, and navigate away while a preview is loading. Exercise rotated/cropped pages, annotations across multiple pages, empty/scanned text, password and restricted PDFs, signed documents, and 2,000-page boundaries. Inspect output visually in another reader, especially iOS rotated free-text labels and form appearances. Check dashboard/tab transitions with large accessibility text and profile viewer/editor/tool transitions on low-memory Android and iOS devices before making performance claims.

Implementation references: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Expo native modules](https://docs.expo.dev/modules/overview/), [PDFBox content streams](https://pdfbox.apache.org/docs/2.0.13/javadocs/org/apache/pdfbox/pdmodel/PDPageContentStream.html), [Tesseract4Android](https://github.com/adaptech-cz/Tesseract4Android), [PDFKit](https://developer.apple.com/documentation/pdfkit), [Vision text recognition](https://developer.apple.com/documentation/vision/recognizing-text-in-images).

# Native PDF integrity and reader search

Implementation follow-up to `audits/pdf-capability-audit.md`, 2026-09-29. These changes use existing PDFium, PDFBox and Apple platform frameworks. No paid dependency, remote processor, package download, or device automation was introduced. React Native handles controls and bounded commands/results; native code reads and processes document bytes.

## Protection and signatures

`PdfIntegrity.kt` and `PdfIntegrity.swift` call the shared PDFium inspector through `PdfTextEditor`. Organizers now reject signed inputs, including every merge source. Advanced tools preflight their primary input and any inserted source. This detects signature dictionaries through PDFium; it is not certificate validation or a digital signing feature. Existing conservative permission checks remain in place.

The PDFium save path in `cpp/TextEditor.cpp` no longer requests `FPDF_REMOVE_SECURITY`. It reopens the staged result using the supplied input password, verifies the page count, and compares security-handler revision and permission flags before publishing. Existing ordinary text editing still accepts unrestricted PDFs only; native markup requests must satisfy editing/extraction permissions. A failure keeps the original intact and removes the staged result.

PDFBox and PDFKit rewrites cannot recover the original owner/user credentials from an opened PDF. Their advanced modifying operations reject encrypted inputs when preserving that protection is unsupported. An authorized encrypted compression request returns an unchanged byte copy. Protect is an explicit request to replace password protection; its output is reopened with the requested password. Organizers retain their existing encrypted-input rejection. These guards do not promise arbitrary encrypted-document editing.

## Compression, metadata, and image conversion

Ordinary compression no longer redraws complete PDF pages. Android can optimize ordinary opaque RGB/gray image resources, including resources inside forms, then save the existing document. It skips masks, transparency, layers, tagged images, unusual color spaces and oversized decodes. Decode budgets are 1.5 million pixels on smaller heaps and 3 million on larger heaps; resource traversal, depth and image counts are bounded. A replacement is used only when its encoded stream is smaller. Maximum quality keeps images as-is; balanced/small may reduce image resolution and JPEG quality.

iOS ordinary compression saves the existing PDFKit document; image recompression is not implemented there. On both platforms, an output that is not smaller is replaced with the original bytes. Estimates therefore expose the original size as an upper bound, not a fabricated expected size. Compression preserves the document representation instead of intentionally rasterizing it; structural checks alone cannot certify all third-party document semantics.

Flatten remains an explicit raster operation. It removes interactive/selectable behavior by rendering pages. The iOS metadata command now clears exposed `PDFDocument.documentAttributes` and writes the existing document instead of rendering every page. This avoids intentional destruction of links/forms/annotations, but it is not a guarantee that every nested metadata stream or XMP field is removed.

Android image-to-PDF conversion validates the staged output with `PdfRenderer`: it reopens the file, verifies page count, and opens each page to check dimensions before rename. This complements the existing iOS structural validation. It does not compare rendered output pixels.

## Reader search

`nativeReaderSearchVersion = 1` gates the new compact search control so old native binaries do not receive unsupported view props. `use-pdf-search.ts` debounces queries and allows one running native search plus one replaceable pending request. Changing the query, leaving the reader, or opening an editor cancels obsolete work. Queries and selected result geometry are bounded; full document text never crosses the React Native bridge.

Both platforms use the bundled PDFium `FPDFText_FindStart`/`FindNext` API for case-insensitive substring search. Results include normalized page rectangles for Android and PDF-space rectangles for iOS. Android draws nonpersistent overlays in the existing reader; iOS uses PDFKit `highlightedSelections`. Previous/next wraps through results and navigates to the matching page. Reading gestures and ordinary text selection remain available. Search highlights never become saved PDF annotations.

Limits: 128 UTF-16 code units per query, 512 MB source files, 2,000 pages, 500,000 extracted characters per page, 500 matches and 32 rectangles per match. Android content-URI copies use a cancellable 64 KB buffer and are deleted when search finishes. Cancellation is checked between native calls/pages/matches; a single PDFium parsing call is not interruptible. Search requires PDF copy/extraction permission. Scanned pages need OCR separately; search does not run OCR, transliteration, fuzzy matching or Unicode normalization. Case/ligature/combining-character behavior depends on PDFium and the document's text mapping.

## Checks and limits

The initial integrity implementation passed local offline Android PDF Kotlin and arm64 C++ compilation. Reader search and later markup changes require the final consolidated native compilation. Search TypeScript passed targeted ESLint and the project typecheck; the root task records final full-project checks. No automated tests, connected-device interactions or web builds were run. iOS Swift/Objective-C++ changes have source review only on this Windows host; an Apple SDK compile and authorized runtime verification remain necessary before release. No zero-leak, frame-rate, output-fidelity or multilingual-accuracy claim follows from these checks.

This follow-up resolves specific integrity defects and adds reader search. It does not make the entire B-U/AX specification complete: persistent standard PDF annotation editing, secure redaction, advanced forms, full OCR/translation workflows and other gaps remain as described in the audit.

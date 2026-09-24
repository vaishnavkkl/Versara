# Native PDF merge and split

## Workflow

PDF > Merge PDF accepts 2–30 selected PDFs. Native inspection reads page counts before processing; users can remove or reorder inputs, name the result, and merge up to 2,000 pages.

PDF > Split PDF accepts one document. Modes:

- Every page: one PDF per source page.
- Page groups: a chosen number of pages per PDF; the last group includes any remaining pages.
- Custom ranges: comma-separated entries such as `1-3, 4, 5-8`, with one PDF for each entry. Unlisted pages are excluded. Repeated or overlapping ranges are allowed intentionally.

The UI validates ranges and previews the output count. Native workers independently validate inputs, page counts, ranges, output paths, and limits. Split produces up to 100 documents and 2,000 output pages per operation.

Each result offers Open, Save/share, and Delete. Results remain in private app storage; users should export their copies before leaving the tool. Removing an input or output never deletes the original picked document.

## Native engines

- Android: PDFBox-Android 2.0.27.0 runs inside the Kotlin Expo module. `PDFMergerUtility` merges documents and `Splitter` copies selected page ranges. PDF streams use temporary-file-backed memory settings. Split destinations remain alive until every output has been saved because the native splitter shares source resources; all documents are then closed, including on failure/cancellation.
- iOS: PDFKit copies `PDFPage` objects into output documents on a serial background queue. Merge retains backing source documents until serialization completes.
- Text, vector graphics, page dimensions and rotations are copied as PDF content, not rasterized into screenshots. There is no PDF.js, JavaScript PDF writer, or cloud processing.
- Document-level structures such as bookmarks, signatures, interactive forms, and cross-page links may change when pages are reorganized. PDFBox's splitter detaches page links to avoid pulling excluded pages into a result. Split is not a redaction or metadata-removal tool.

Encrypted/password-protected or assembly-restricted inputs are rejected with an actionable message; this workflow does not unlock documents. Malformed, empty, oversized, unreadable and storage-failure cases return structured errors.

## Progress, cancellation and storage

Native jobs expose progress and explicit cancellation. Closing the sheet requests cancellation. Cancellation is checked between documents/pages and before output verification and commit. A native parser, merge append, or file write already running must finish before cancellation can settle.

Inputs are owned cache copies. Cleanup waits until native code releases them. Outputs are written to `.partial` files, reopened to verify page counts, then moved into final locations. On an error or cancellation, staged files and any already committed outputs from that job are removed. Originals and earlier successful outputs are preserved. As with other private application files, a process termination can leave cache/partial files for later cleanup.

## Visual updates

Dark-mode screen and tool-sheet backgrounds are pure black (`#000000`); module cards and navigation retain their blue gradients. Bottom tabs now use 24-point icons, 64×46-point oval selection backgrounds, and a 56-point touch area.

## Verification

TypeScript, lint, and Android module Kotlin compilation passed during implementation. No web builds or automated tests were run under the project preference. iOS compilation and runtime validation on both platforms remain pending and require a new development build.

Manual device checks should cover input order, duplicate selections, all split modes, invalid/out-of-bounds ranges, overlapping ranges, single-page inputs, scanned and searchable PDFs, mixed page sizes/rotations, restricted PDFs, large inputs, cancellation during parsing/writing, sheet dismissal, low storage, output opening, sharing, and deletion. Verify text selection and page appearance in generated PDFs. Do not infer on-device memory/performance or iOS correctness from static checks.

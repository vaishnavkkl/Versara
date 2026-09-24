# Native page order and rotation

PDF > Reorder Pages and PDF > Rotate Pages use the existing local PDF engine. Choose a PDF, edit its page settings, and save a new copy. Inputs remain untouched. Up to 2,000 pages are supported, consistent with the other organization tools.

Reorder offers up/down controls, an exact destination position, reverse order and reset. Original page numbers remain visible alongside new positions. Every page must appear exactly once; both native implementations reject omissions, duplicates and out-of-range indices.

Rotate offers left/right quarter-turns for each page and all pages. Repeated taps produce 180/270-degree turns; four turns return to the original orientation. Changes are relative to the existing page rotation. Native validation rejects duplicate page entries, invalid page numbers and angles other than 90, 180 or 270 degrees. Unchanged pages are preserved.

Preview buttons show original pages before saving. The saved result opens in the native viewer to inspect the final order/orientation. Save/share exports it through the platform menu. Progress, cancellation, errors, single-page handling and reset are included. The page list is virtualized and all controls use the current light/dark palette.

Android uses PDFBox inside the Kotlin worker. Reordering materializes inherited resources, media/crop boxes and rotation before detaching and reattaching the same page objects in their new order. Rotation updates the native page rotation property. iOS uses PDFKit page exchanges and page rotation on its serial worker. Neither implementation rasterizes the PDF or passes PDF bytes through JavaScript.

The existing organizer guards local input/output paths, rejects protected or oversized inputs, writes staging files, reopens outputs to verify page counts, and rolls back on failure/cancellation. Original documents and previous results are retained. As with any PDF edit, document-level structures such as signatures and index-based page labels may change; preservation of every advanced PDF feature is not guaranteed.

Validation is limited to lint, TypeScript and Android Kotlin compilation under the project preference against automated tests/web builds. iOS compilation and device verification require a new native build. Manual device checks should cover arbitrary permutations, first/last moves, reverse/reset, single-page PDFs, existing rotations, all four quarter-turns, mixed page dimensions, inherited page attributes, malformed/protected files, cancellation and low storage. Verify exported page appearance and text content on both platforms.

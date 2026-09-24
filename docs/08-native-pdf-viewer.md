# Native PDF viewer

## Reader options and catalog update

The full-screen reader now keeps page navigation and a labelled **Options** button at the bottom. The previous upper action toolbar has moved into a native `@expo/ui` sheet (SwiftUI on iOS, Material bottom sheet on Android). The sheet supports half/full heights, drag dismissal, a visible close button, safe-area padding and a virtualized list of descriptive action rows.

Options include scroll mode, Fit, focus view, document details, save a copy, open another PDF, and every currently implemented editing/organizing tool. Upcoming tools are visible in an expandable section with disabled rows. This does not implement the remaining processing roadmap. File details show the file name, size and page count.

Opening a tool from the reader creates an independently owned input copy using native file-system operations and pushes a full-screen tool route. The current file is preselected, including as the first merge input; closing the tool returns to the reader. Image to PDF opens an image picker because its input is images. Input copies are deleted with their owning tool session; source documents remain unchanged.

The reader's loading state includes a themed indicator and document name and clears on native load, page-ready or error events. Catalog loading stays inside the selected tool card, with duplicate taps disabled. The catalog presents nine distinct working tools and one consolidated Edit PDF entry beneath a compact header.

Manual checks for this update: open/cancel local and cloud files; use each Options action on an opened PDF and a generated result; merge additional PDFs; return to the same reader/page; dismiss the options sheet with its close button, swipe and Android Back; check dark/light mode, large text, narrow screens, errors and closing while a tool input is being prepared. Lint/typecheck are run; no automated tests or web builds. Native device layout and interactions require manual verification.

The sections below describe the original implementation; the current full-screen flow supersedes its earlier tool-sheet navigation and print controls.

The native reader is available at **PDF > PDF Viewer**. [Image to PDF](09-files-and-image-to-pdf.md) and [Merge/Split PDF](10-pdf-merge-and-split.md) also have native implementations. Other PDF methods remain UI previews.

## Implementation

- `modules/pdf-engine` is a local Expo module, autolinked on Android and iOS.
- iOS uses PDFKit (`PDFDocument` and `PDFView`), with document opening on a background queue. Reading, scrolling, text selection, and pinch zoom use Apple's native view.
- Android uses `PdfRenderer`, a serial background executor, and a native image view for pinch, double-tap zoom, and pan. Page rendering is capped at two million pixels per bitmap. Next/previous and the page-number field move between pages.
- React Native receives only page/zoom/error events and passes file URIs. PDF bytes are never transferred through JavaScript or rendered in a WebView.
- Expo's native document picker, file-system, sharing, and printing modules handle file access and system dialogs. No server is used to open or render documents.
- The reader follows the saved app theme. PDF page colors remain faithful to the original document.

## File lifetime

The picker provides a cache copy, which is copied into the viewer's managed cache through the native file-system module. The picker copy is removed when it belongs to DocumentPicker's cache; user originals are never deleted.

Closing the sheet releases the reader and removes its managed file. Android discards stale render results and closes its renderer and descriptor after in-flight work finishes. iOS releases PDFKit with the view and ignores obsolete document opens.

Sharing and printing receive separate export copies. These survive sheet dismissal because Android's print service can read the file after its JavaScript Promise resolves. Managed exports older than 24 hours are pruned when the viewer next opens; the OS may also evict cache files.

## Current boundaries

Password-protected, corrupt, missing, or unreadable PDFs show an actionable error. Password entry, page-thumbnail navigation, and cross-platform text search from the product roadmap are not included in this first reader. Android zoom magnifies a bounded raster image; extreme zoom can look softer than PDFKit.

## Build and manual verification

A **new Android/iOS development build** is required after adding this module and its native dependencies. An existing development build or Expo Go without the module shows an availability message. A Metro refresh cannot install native code.

Static verification: run the required lint and TypeScript checks and check Expo module autolinking for both platforms. No web build or automated tests are required by the project workflow.

On a development device, verify:

1. Open the viewer from its method card. Check the fully expanded sheet, fixed top-right close button, Android Back, and swipe dismissal.
2. Choose and cancel local/cloud-provider PDFs. Check single-page, multi-page, large, corrupt, and locked files.
3. Move between pages, enter a page number, pinch and pan, reset with Fit, then replace the PDF.
4. Share, cancel sharing, print, and close the viewer while the system print dialog is in use.
5. Close during loading and reopen. Confirm there is no stale document, spinner, or native crash.
6. Check both saved themes and navigate repeatedly between the five bottom tabs. Confirm rounded-square selection, responsive switching, and accessible touch targets.

Validated during implementation: lint, TypeScript, Android Kotlin compilation (`:pdf-engine:compileDebugKotlin`), and Expo module autolinking on Android and Apple. No web build or automated tests were run. iOS compilation, device rendering, and navigation frame timing remain to be verified in a development build.

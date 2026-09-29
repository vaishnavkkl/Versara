# Editor menus and privacy selection

Privacy Review lists recent PDFs and images together, with shared search, grid/list layout, bounded caches and existing native device access. Open offers PDF and image imports. Selecting a PDF opens the existing per-page PDF privacy editor; selecting an image opens image review. Dedicated redaction and metadata tools retain their file-type restrictions.

Editor options now use larger labels and touch targets. Footer measurement mirrors the new compact option width. Brush, stroke pattern, shape and font selectors use Expo UI's native anchored menus, which close after selection. PDF annotation selectors appear as compact icon buttons beside page navigation, outside the document canvas. Detailed opacity, colour, history and save controls retain their existing handlers below the preview. The web fallback offers functional inline choices; no web build was run.

The device file browser sorts folders before files, then sorts each group by name, modification date, size or type. The direction toggle affects the selected sort key while keeping folders first. PDF annotation controls share the page-navigation toolbar row, with their existing icons and action handlers.

Android signature normalization explicitly enables alpha on its mutable bitmap before writing pixels. Opaque JPEG decoding otherwise carries the opaque flag through ARGB conversion and ignores the calculated transparency when saving the cleaned PNG. The PNG preview and BGRA PDF export continue using the same calculated pixels. This remains light-paper removal, not general subject segmentation. Existing cleaned PNG assets are not rewritten; re-add an image from an older signature draft to regenerate it. The native fix requires a new app build.

Validation: TypeScript and Expo lint passed. A broader direct ESLint run found existing errors in skill/build scripts and `src/app/file-preview.tsx`; none of those files were changed here. Native Android compilation could not run: the default Gradle wrapper attempted an unavailable download, and the cached distribution could not initialize its Windows native library. iOS compilation and device checks were not available. No automated tests or web builds were run.

Manual device checks still needed: JPEG and transparent-PNG signature import, remove/restore background, exported PDF transparency, undo/redo, both privacy file types, large text and landscape menu fit, selection/resize, native menu dismissal, and saving after style changes.

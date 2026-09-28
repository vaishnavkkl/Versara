# Consistent PDF tool previews

PDF tool previews share the Edit PDF page toolbar, full-height canvas, gesture hint and fixed action area. Page navigation supports arrows and direct page entry. The preview area does not scroll away with formatting controls.

- Edit PDF, Add Text and Remove Text use the shared preview layout. Existing-text drafts are rendered by the same native PDF engine commands used for Apply and Save, including font, size, color, indentation and deletion.
- Highlight, Draw, Shapes and Signature use the same layout and canvas background. Their native drawing surface retains two-finger zoom/pan, live marks, Fit, Undo and Redo. Style controls expand in a bounded panel.
- Page Numbering uses the Edit PDF native zoom canvas instead of a static image. Its preview contains the actual numbering commands. Fit, pinch, pan and double tap are available.
- Rotate opens directly into the shared full-height page preview. Left/Right updates the displayed page immediately, with This page/All pages scope and a separate Save action. Quarter turns swap the canvas bounds before rotating so the page fits without clipping. The existing decoded page stays mounted; taps do not generate temporary PDFs. Export adds the same rotation delta to each source page in the native engine. Landscape puts rotation controls beside the preview.
- Extract, Delete and Reorder open source-page previews inside the tool using the same native zoom canvas. Reorder has larger page thumbnails. Merge and Split source thumbnails open this preview too.
- Single-document PDF operations keep the source preview above a collapsible settings dock and fixed export action. Watermark and page numbering show native output previews in that same layout, updating after settings settle. Multi-document selection/organization retains its source chooser and opens the shared page preview. The document information screen remains a metadata view with Preview PDF.

## Live rendering and lifetime

Typing no longer cancels the native page render or restarts a trailing debounce. There is one running render and one latest waiting draft. Completed frames from the current editing context can appear while typing continues; waiting intermediate drafts are replaced. The status distinguishes Updating preview, Live preview and invalid drafts. The canvas stays mounted while its image changes, preserving zoom and pan.

Changing document/page/selection, saving, leaving or backgrounding invalidates the editing context. Obsolete frames cannot publish into it and rejected image files are removed. Apply/Save continue to use native commands and explicitly stop live work before their foreground job.

Source previews borrow the mounted tool's input and own a separate temporary image directory. They serialize native jobs, cancel on page changes/background/close, retain only the previous displayed image during replacement, and remove temporary files after pending work finishes. They do not copy the entire PDF or start background verification. No new native dependencies are needed. Read-only previews now use the bounded PDFium preview path with text-object extraction disabled; text-editing previews retain extraction. Native updates require a new app build.

## Verification

Expo lint, TypeScript `--noEmit` and the tracked-file whitespace check passed. No automated tests or web builds were run. Visual checks on the connected Android device were blocked by its touch-prevention overlay. Native iOS visual checks and continuous-typing/frame-time measurements remain device validation work; static checks do not establish frame-rate guarantees.

Manual acceptance: type continuously in an existing text fragment; confirm intermediate/final text and formatting appear before Apply, then cancel and confirm restoration. Apply, undo, redo and save must match the preview. Navigate mixed-size/rotated pages, fit/zoom/pan, draw and undo marks, inspect numbered pages, and close/background previews while rendering.


## Editor consistency follow-up

- Shared actions and option chips have semantic SF Symbols/Material icons and tool-family colors. The shared PDF toolbar includes a landscape control. Numeric inputs use keyboard avoidance and scroll insets in image resize/export controls and PDF settings.
- PDF/image drawing supports Pen, Pencil, Marker and Highlighter presets, plus solid/dashed/dotted strokes. These are width/opacity presets, not pressure-sensitive or textured brushes. Completed native paths are cached between draw frames; only completed gestures reach JavaScript.
- Select & resize hits existing annotations, shows four corner handles, and supports dragging. Changes replace a mark by ID and participate in a bounded undo/redo history (40 changes, shared unchanged marks). Pinch gestures cancel a pending selection drag rather than committing an accidental edit. The shape palette has 18 icon choices.
- Watermarks include typography, color, opacity, visual page placement and an optional shape outline. Page numbering uses the same placement icons. Output and preview use the same PDFium commands.
- Compression estimates are explicitly estimates. Native Android/iOS export compares the generated size to the source and copies the original bytes if compression is equal/larger. That fallback also preserves any original encryption. The result reports when no size reduction occurred.
- Image editors expose a shared toolbox. Switching applies current changes into a temporary working copy and replaces the tool route, without asking for a user save. Non-compression intermediate renders use PNG; explicit compression/conversion keeps the chosen encoding. Export remains explicit. A multi-image batch must finish export before switching so extra inputs are not silently lost.
- Working copies retain at most two successful intermediate files, wait for pending writes before cleanup, and expire after leaving the editor. Returning to a tool operates on the applied working image; its previous parameter panel is not a nondestructive layer stack. Normal tool undo/redo applies within the active step.
- The main iOS image editor uses the device encoder list, exposing HEIC and TIFF where available, alongside JPEG/PNG. Android continues to offer JPEG/PNG/WebP. File types and MIME types match the encoded data.

Validation: lint and typecheck are required, with Android Kotlin and arm64 C++ compilation for native changes. No automated tests or web builds are run. iOS compilation, touch interactions and measured frame times still require device validation; do not infer an FPS guarantee from compilation.


## Stroke patterns and compact controls

- Dotted strokes use filled circles sampled along the entire stroke, including across segment bends. Dot centres are three stroke widths apart; unusually long strokes increase spacing to stay within 2,048 dots. The native PDF/image canvases and PDF/image exporters use the same geometry, width and brush opacity. Completed paths are cached and released on teardown. Dashes retain native dash patterns; closed shape fills and outlines remain solid.
- Android also records the final finger-up point, so quick strokes retain their endpoint even without an intervening move event. A tap creates a single dot. Marks retain their pattern through selection, resizing, undo/redo and save.
- Native modules expose `nativeStrokePatternsVersion`. Dotted/dashed controls require the updated drawing canvas and the corresponding exporter; older installed binaries show a build-update hint instead of silently offering unsupported patterns. These changes require a new native Android/iOS build, not just a JavaScript refresh.
- PDF tool routes own orientation. Landscape replaces Demo in the header and remains selected when opening settings or another preview within that tool. Style, Select and the Area/Brush switch sit beside page navigation. General tool settings use the same top controls; groups wrap when needed for narrow screens or larger text.
- Buttons and selected controls use the primary theme. Option icons distinguish blue selection/pen, green area/pencil, teal dash/highlighter, pink brush/marker and purple style/dots. Gold has been removed from the shared tool palette; document ink colours remain freely selectable.

Verification for this change is restricted to source review and build checks at the user's request. No phone interaction, installation, automated tests or web build. Lint, TypeScript and Android native Kotlin/arm64 C++ compilation are the checks; iOS compilation and touch/export appearance remain unverified here.

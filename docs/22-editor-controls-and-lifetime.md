# Editor controls and lifetime

## Text editing
Existing PDF text uses a compact single-line field immediately above the keyboard. The page remains live; formatting is collapsed while typing. Done or the check button applies the change. Add Text edits on the native page, auto-zooms to a new placement, and initializes from the nearest text object's visible size, color and closest standard PDF font. Standard-font fallback does not embed an arbitrary document font in new objects.

## Annotations
Highlight has Area and Brush modes, adjustable brush width, full palette/custom colors, and fixed Undo/Redo/Save controls. Native canvases support two-finger zoom and pan; Fit resets the view. Shapes use icons for rectangle, ellipse, triangle, diamond, pentagon, hexagon, star, arrow, line and chevron; border and fill are independently selectable, including no fill. Final normalized vector paths are saved through the shared PDFium engine on both platforms, preserving the document page content. Ellipses use a 64-segment vector outline. Sessions remain bounded to 300 marks and 20,000 sampled points.

## Numbering
Choose page range, start, label format, optional prefix, six positions, edge margin, font family, bold/italic/underline, size and color. Preview uses exactly the native numbering command used on save, including page crop/rotation. Step through preview pages; return to settings to adjust. Numbers count only the selected pages. Labels that do not fit produce an error.

## Selection and toolbox
Android long-press uses native PDFium character bounds on demand; handles adjust the selected range and the native floating menu offers Copy and Select All. Selection respects PDF copy permissions and has a 20,000-character page cap. iOS uses PDFKit's native text selection. Scans need OCR. The tool bar exposes four quick tools plus a searchable two-column toolbox instead of a long horizontal list.

## Resource ownership
Native canvases are mounted only on the active screen. Text previews have one running render and one pending request; decode queues are bounded. Disposal cancels work/animations, drops image references and closes worker/document resources. Image text initialization checks cancellation before beginning the next native step and removes temporary files only after its pending step settles. iOS image text jobs use autorelease pools. Image adjustment previews coalesce slider updates, release their CIImage and UIImage, and clear Core Image caches at teardown. PDF preview cleanup timers stop when inactive or saved. Output validation is a single save step, with no idle verification loop.

## Validation
Requires a new native development build for the keyboard, annotation, numbering and selection changes. Run lint, typecheck and Android module compilation. iOS compilation and keyboard/selection/annotation alignment, repeated editor-to-Home RAM, and frame-time profiling require device validation; static inspection cannot establish leak-free or frame-drop-free behavior. No automated tests or web builds were requested.

Completed checks: Expo lint, TypeScript `--noEmit`, Android PDF/image Kotlin compilation, shared PDF C++ compilation for the configured Android architectures, and `git diff --check`. All passed. Native compilation reports platform/C++ deprecation warnings; these are not runtime performance measurements.

## PDF reader controls and editor handoff

The native PDF reader replaces system fast scrolling with a blue capsule handle. It appears on scrolling, remains visible while dragged and fades after idle. Its moving 32-by-48 touch region is the only scrub target: touching elsewhere along the right edge remains ordinary page interaction. Android disables ListView fast scrolling; iOS observes PDFKit scroll offsets and owns only the handle gesture. Timers, observations and animations are released on teardown.

The portrait page controls include Landscape. In landscape, separate vertical thumbnail lists show odd/even pages on either side; Fit and page/view controls occupy the left rail, and editing tools remain on the right. A top corner control restores portrait without occupying a quick-tool slot.

Opening a PDF editor now unmounts the reader and thumbnail views before creating the independent editing session, allowing the native reader queue to cancel/release before the editor starts. A two-frame handoff yields for that unmount; the reader remains paused until focus changes or opening fails. This reduces overlapping preview work; measured frame-time improvements still require device profiling.

Validation for the reader follow-up: Expo lint, TypeScript and Android pdf-engine Kotlin compilation passed. Device validation could not finish because the connected Android device disconnected. The custom scrollbar requires a rebuilt app; iOS compilation and measured navigation frame times remain unverified.

## PDF listing to reader startup

PDF Recents now passes its known document path directly to `/pdf-viewer`, avoiding the generic media route's initial slide transition and redundant metadata lookup. Android reader startup measures only the requested page instead of opening up to 2,000 pages for dimensions; visible rows discover their own dimensions as they render. Mixed-size pages can adjust their row height on first display.

The native recent-file list accepts an `active` flag on both platforms. Losing focus or importing a selected file cancels queued thumbnail jobs and invalidates pending callbacks while retaining its bounded cache and scroll position. An already-running native decode can finish, but cannot update a cancelled cell. Returning resumes visible thumbnails.

These changes remove avoidable startup work; they are not a measured FPS guarantee. Native changes require a new development/release build. Verify long and mixed-size PDFs, page selection, back navigation, and edited-file returns on device; iOS compilation requires macOS.

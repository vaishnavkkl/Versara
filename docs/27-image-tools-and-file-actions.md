# Image tools, file actions and compact toolboxes

## User-facing changes

- Dialogs use the current light/dark surfaces, typography, borders and accent. Destructive actions have a distinct color. The dialog remains visible during its native fade, releases its content afterwards and respects reduced motion. Large text stacks the actions.
- Edited files has Open, Edit, Rename, Duplicate, Save to device, Share, Details and Remove from list. Rename updates the library name and Recents atomically; existing device copies keep their names. Duplicate creates a durable app copy. Remove only removes the library entry.
- Named sharing retains up to eight recent attachments, capped at 32 MB each, so receiving apps can read them after the Android chooser returns. Larger files share their existing path to avoid another large cache copy.
- Settings uses the same grouped surfaces, a native history switch, a device motion status and an Edited files shortcut. Existing theme, layout, permissions, history and cache controls remain functional.
- The PDF and image toolboxes use a 3-column by 3-row grid, with nine tools per page, consistent color families, search and Previous/Next controls. The grid can scroll within its page when a small window, keyboard or large text leaves insufficient height. Short action menus use a shorter sheet. The image editor's six main tabs also fit without horizontal scrolling at the default text size.
- iOS launches tools from the native sheet's actual dismissal callback; Android waits for native `hide()` completion. The extra JS launch timer is removed, and the Android host stays mounted between openings.

## Native image functionality

`FileEngine.nativeImageToolsVersion = 1` enables the new `/image-tool` route in Search and the image preview toolbox. Older binaries show unavailable tools until a development build includes the new native code.

| Tools | Behavior |
| --- | --- |
| Compress / batch compress | Quality and optional target KB, original/edited preview toggle; bounded quality reduction followed by resizing when necessary |
| Resize / social presets | Exact width/height, proportions lock, custom decimal percentages (0.1-400%), common presets, immediate pixel/MP output dimensions, fit/fill/stretch and fit background color |
| Perspective | Four source corners with validation and native perspective correction |
| Canvas / borders | Adjustable padding and color; large images downsample enough to include the border within the memory budget |
| Exposure / sharpen / blur | Native filters; blur supports the whole image or a rectangle drawn in the preview |
| Draw / annotate | Native pen, shape icons, border/fill colors, thickness, undo and redo |
| Watermark | Text or imported logo, size, opacity, color and position with preview |
| Redact | Opaque filled regions baked into the raster output; covered source pixels are discarded |
| Metadata / info | Fresh raster export without source EXIF/GPS/camera tags; dimensions, size, type and available camera/location metadata |
| Convert | Device-supported native encoders only; JPG/PNG/WebP on Android, ImageIO-reported encoders on iOS (including HEIC/TIFF where available) |
| Rename | An identical byte-for-byte copy with a user-chosen filename |
| Batch edit | Up to ten images, serial resize/convert/compress export with a filename prefix, per-file progress and cancellation |

Crop, rotate, flip, basic color adjustments, filters, add/edit text and image-to-PDF retain their existing native implementations. Rotate additionally has a straighten slider, with matching transformed bounds in Android and iOS previews. There are no new commercial SDKs or processing services.

## Resource ownership and preview behavior

- Only paths, numeric settings and bounded mark coordinates cross the JS bridge. Bitmap decode, transforms, pixel filters and encoding run on native workers.
- Native workers allow one active job and two queued jobs at most. Cancellation is checked between stages, during Android filter passes, and before publishing an output. A codec operation already executing finishes before cancellation is observed.
- Preview requests wait for the previous job to settle and discard superseded settings. Only three preview files are retained. The shared Edit PDF canvas preserves zoom for live image updates and unmounts off-screen.
- Preview sources are downsampled to 1440 px. Export source decoding is capped at 2048/3072 px and output pixel budgets at 3/6 MP, depending on device capacity. Explicit dimensions above the budget are rejected. The UI states the limit and reports final saved dimensions and bytes.
- Marks are capped at 300 and 20,000 points. Undo/redo shares those bounded mark objects. Batches contain at most ten files and process serially; cancellation keeps finished outputs and removes unfinished files.
- Export uses a temporary native file before publishing. Unmount cancels native jobs, waits for them to settle and deletes the session directory. Picker returns after unmount also clean their imports. Replacing batch selections or watermark images releases old imports.
- Outputs are saved in app storage and indexed in Edited files and Recents. Result actions open, share or save a device copy. File naming preserves the selected output extension.

## Validation

Run Expo lint, TypeScript and `:file-engine:compileDebugKotlin`. No automated tests or web builds are authorized for this work.

2026-09-26: Expo lint, TypeScript and Android native Kotlin compilation passed. iOS compilation and physical-device performance validation are still pending.

Before release, validate both device builds: small screens and large text, light/dark dialogs, opening/dismissing sheets, every encoder offered by that device, transparent images, EXIF rotation, perspective corners, selected-area blur, redaction, batch cancellation, picker cancellation and interrupted export. Profile frame time and memory during repeated open/edit/close cycles. iOS compilation and on-device animation/performance verification require their respective development builds; this implementation does not claim a measured frame rate or zero leaks.


## 2026-09-27 resize and toolbox follow-up

- Both toolbox sheets are sized for at most three rows; pagination always advances nine tools. Search covers the full catalog, not just the visible page.
- The editor Resize tab and standalone Resize/Social/Batch tools share percentage and pixel fields. Clearing one dimension in pixel mode derives it from the original aspect ratio. Output width, height and megapixels update immediately. Encoded bytes are reported after saving, because dimensions alone cannot predict them reliably.
- The editor native export accepts explicit output width and height after crop/rotation. `nativeImageResizeVersion = 1` gates these options so older binaries cannot silently ignore them. Output dimensions are bounded to 8192 per side and the native device pixel budget.
- Batch percentage resizing uses each source image's own dimensions. Custom pixel dimensions apply to every image. The displayed dimensions refer to the first image in the batch.
- All current image catalog entries have implementation routes: native crop/rotate/flip/adjust/filter editing, native image text editing, the advanced image tools, and image-to-PDF. Image controls missing from an older binary now say they need an app rebuild instead of implying that implementation is coming later.
- Static lint/type checking and Android Kotlin compilation are the validation gates. iOS compilation, visual checks and device performance measurements remain pending; no automated tests or web builds are run.
# Image text confirmation follow-up

- Edit Text selects an OCR line and renders its replacement live through native annotations. It uses a compact input above the keyboard; the draggable on-image input is reserved for Add Text.
- Both modes show an Apply checkmark in the top-right header while a draft is open. After applying, the header returns to Save. Text style controls start collapsed to leave more room for the preview.
- Edit mode ignores new-text placement events. Cancel dismisses the keyboard and restores the committed preview; Back closes an open draft before leaving the editor.
- Verification: Expo lint and TypeScript pass. Keyboard positioning and visual behavior still need Android/iOS device verification.

## Scrollable toolbox and landscape follow-up

The latest toolbox replaces nine-item pagination with a three-column, vertically scrollable catalog grouped by tool category. Search retains matching category headings. Android and iOS sheets open at 75% of the current window height, including the drag-handle allowance. The landscape rail keeps Tools pinned below independently scrollable quick actions, so short screens do not clip the toolbox button. PDF readers now include the same Portrait/Landscape action as image previews; orientation is local to the reader route.

Validation: Expo lint and TypeScript pass. Native sheet gestures, rotation, and cold-start animation still require device verification.

## Image Edit Text keyboard alignment

Image Edit Text now follows the PDF editor's compact input bar: single-line text field, formatting, delete and cancel controls, with Done submitting the replacement. Apply remains in the top-right header. KeyboardAvoidingView uses height on Android and padding on iOS. The preview shrinks while the input bar keeps its height; formatting collapses when the text field gains focus, and guidance/idle actions hide while typing. Window height is no longer used to switch this editor into a side panel when the keyboard opens. Keyboard listeners are removed on teardown. Live native annotations and image saving are unchanged.

Expo lint and TypeScript pass; physical-device keyboard positioning remains to be verified.

## Native toolbox scrolling and two-sided landscape controls

Android toolboxes now scroll in Compose LazyColumn; iOS uses SwiftUI ScrollView. The React Native catalog is an intrinsic-height child with an explicitly measured native viewport width, rather than a nested React Native scroll view. This makes the full categorized catalog contribute to native scroll extent and leaves sheet drag handling in the same native UI system. The sheet remains 75% high.

Landscape image previews place orientation, crop, rotate and resize on the left; text editing, add text, filters and save on the right. Landscape PDF readers put orientation, previous/next and Fit on the left, with Edit PDF, Add text, Highlight and Draw on the right. Each rail scrolls independently; the toolbox stays pinned on the right. The PDF top page controls and thumbnail strip are hidden in landscape. Landscape uses single-page fitting inside an inset viewport and resets to Fit on rotation; portrait retains its scrolling preference. Scroll mode and thumbnail controls are offered in portrait only.

Validation: TypeScript, lint and diff whitespace checks. No automated tests or web builds; installed-device scrolling and iOS presentation still require visual validation.

## Toolbox blank-content correction

The native sheet host now receives explicit window dimensions. The catalog renders immediately with a nonzero width fallback; native measurements refine it but no longer gate mounting. This removes the empty-sheet dependency on a zero-width layout callback. The 75% native scroll viewport and categorized catalog remain.

## 2026-09-28 closed toolbox touch interception

Full-window native toolbox Hosts are now removed when the sheet is closed. Android retains its Host only until hide completes; iOS retains it until onDismiss, then clears the selected action and removes the presenter. This prevents an invisible native host from covering reader thumbnail taps and quick tools. Selection callbacks still run after dismissal.

Expo lint, TypeScript and changed-file whitespace checks pass. The device check was interrupted by concurrent phone use; thumbnail selection and Edit PDF navigation have not been confirmed on-device after this correction. No native sources changed in this follow-up.

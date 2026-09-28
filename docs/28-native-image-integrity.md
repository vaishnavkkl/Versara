# Native image integrity and crop restoration

Implementation date: 2026-09-29. This extends the existing image editors and exporters. It adds no cloud processing, paid SDK, dependency, route or alternate editor UI.

## Export destinations

The basic Android/iOS editor now accepts outputs in both app Documents/files and app Cache, matching the working-copy destinations used by `ImageWorkspace`. Both implementations resolve canonical paths and require a path separator after an allowed root; sibling directories and paths escaping the app roots remain rejected. Existing destinations remain rejected. The basic exporters and iOS text exporter write a unique temporary file and publish it only after encoding succeeds.

## Source resolution and memory

Normal final exports now decode the original source dimensions instead of applying a hidden 2048/3072/4096-pixel cap. This applies to basic editing, advanced tools and image text rendering. Screen previews retain their bounded decoding sizes.

Before final decoding and expanded output allocation, native code estimates a working pixel budget for source, destination, filter scratch buffers and encoder work. Android uses available app heap, available system memory and a bounded device-class allowance. iOS uses a conservative fraction of physical memory capped at 256 MB. These are allocation guards, not a zero-OOM or performance guarantee.

An export exceeding its budget fails with an instruction to choose smaller dimensions in Resize. It does not silently save a reduced-resolution file. A crop or arbitrary rotation may still require processing the complete source/rotated canvas; a small crop of a very large source can therefore require an explicit resize until a native tiled decoder/exporter is available.

Explicit resizing may decode only the source resolution needed by the requested output size, accounting for crop and rotation in the basic editor. Upsizing still starts from the original resolution. Explicit target-byte compression may reduce resolution to reach the requested target, preserving the existing compression behavior. Quality-only compression and format conversion retain source dimensions when memory allows. Adding a canvas border no longer silently reduces the underlying final image to fit a budget; the expanded final dimensions are checked instead.

The native processing guards support dimensions up to 32768 per side, subject to the working pixel budget. UI-specific resize limits may remain stricter. A successful export still reports its actual width, height, byte size and MIME type through the existing result contract. No new request field is needed for this behavior.

## Transparency

- iOS text export creates a non-opaque renderer for PNG, preserving untouched source alpha. JPEG previews/exports explicitly composite white.
- Basic JPEG export on both platforms explicitly composites white before encoding; PNG retains alpha.
- Advanced fill/stretch resize preserves source alpha. Fit intentionally applies its existing chosen background color, and Canvas/Border intentionally adds its chosen background.
- Existing final format availability remains capability based. These changes do not add an unavailable codec to either platform.

## Native crop history contract

Both native `ImageEditorView` implementations accept `cropRequest`, a JSON string containing either `{x, y, width, height, revision}` in normalized image coordinates or `{reset: true, revision}`. This is a restore command, not a per-frame binding.

- Native code validates finite coordinates and a positive rectangle inside the image.
- A restore updates the crop without emitting a user crop-change event.
- A requested rectangle survives asynchronous initial source decoding.
- Native gestures update the retained rectangle and emit the existing completed-gesture event.
- A geometry/aspect change resets crop as before; a subsequent restore command applies its exact rectangle.
- Revisions allow a caller to restore identical coordinates again without depending on a changed rectangle value.

The bridge advertises `nativeImageHistoryVersion = 1`; the JS layer must gate history restoration for older binaries. Changes to rotation/aspect and crop restoration should be treated as one history transaction so intermediate native reset events are not recorded as another user action.

Android crop resize also bounds the minimum handle size by the available normalized rectangle, avoiding an invalid `coerceIn` range when restoring a narrow edge crop.

## Validation limits

Source inspection and changed-file whitespace checks completed for these native changes. Android compilation is part of the root task's consolidated build check. iOS compilation, encoded-pixel/alpha comparisons, gestures and memory profiling remain unverified in this Windows environment. No connected-device automation, automated tests, web builds or cloud operations were run by this implementation subtask.

When separately authorized, useful fixtures are transparent PNG text export, transparent fill/stretch resize, opaque-background fit, full-size images below/above the memory guard, EXIF orientations 1-8, arbitrary rotation plus crop/resize, cancelled export, stale output paths and crop restoration before source load. These are a verification plan, not claims that runtime checks have passed.

## Basic adjustment slider performance follow-up

The brightness, contrast, saturation, warmth, straighten and export-quality controls retain their layout, ranges and native Expo UI slider behavior. Independent slider rows are memoized and receive a stable change callback, so a value change does not reconcile every other native slider Host. Every sample still updates edit history immediately; no JS debounce or delayed final commit is added. Straighten computes its new angle from the current history state, avoiding an older React closure during rapid changes.

The native preview fixes address source-confirmed redundant work and a starvation condition:

- iOS previously displayed a completed filtered frame only if no newer parameter event had arrived. Continuous slider input could therefore discard every completed frame until the drag stopped. It now displays completed frames for the same source generation while keeping exactly one render in flight and one latest pending settings snapshot. Old-source or disposed-view completions are still rejected. Rotation frames use their rendered dimensions; tonal changes do not trigger another image/overlay layout pass. The final idle render uses the final settings at the existing bounded preview resolution.
- Each iOS preview now owns its Core Image context. Teardown clears that preview's caches rather than flushing the shared export/other-preview context.
- Android keeps its existing GPU Canvas color-filter path. Color matrices are rebuilt only when a displayed frame needs different color settings, rather than once for every parameter event. Geometry-only updates reuse the color matrix; unchanged settings return immediately. The native invalidation follows the display frame, and tonal changes retain the current crop.
- Android avoids scheduling the same source decode again during initial layout. Decode results and errors both check their source ticket before updating the view. Source replacement clears the obsolete displayed bitmap reference; export resolution and codecs are unchanged.

These changes add no SDK, cloud request, paid dependency or native bridge property. Source review covers the latest-value path, source changes, teardown, and crop handling. Changed-file whitespace checks passed; the root task runs consolidated lint, TypeScript and Android compilation checks. iOS compilation and actual slider frame timing remain unverified because no connected-device automation or runtime profiling was performed.

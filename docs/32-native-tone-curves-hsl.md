# Native tone curves, Levels and HSL color

The existing advanced image editor now exposes Tone Curves, Levels and HSL Color in Adjust & enhance. They use the existing route, preview surface, history, reset, local recovery and export workflow. Native color capability version 1 enables curves/HSL, and version 2 adds Levels on Android and iOS. Older binaries show the existing rebuild guidance instead of exporting an unchanged image from unsupported parameters.

## Implemented controls

- Tone Curves has master RGB, Red, Green and Blue channels. Each channel has five fixed input anchors: black, shadows, midtones, highlights and white. Drag an anchor vertically or choose a tone and change its output with the native slider. The graph follows the gesture on the UI thread; native preview requests receive transient snapshots at most every 120 ms. Releasing commits one undo step, while cancellation restores the previous curve. Reset channel restores its identity mapping. Full reset and undo/redo use the existing history.
- Levels provides black and white input points on a 0-255 scale and midtone gamma from 0.1 to 3. The black point must remain at least one input step below white. Controls clamp to the valid interval, and a collapsed interval disables its slider. Reset Levels restores black 0, gamma 1 and white 255.
- HSL Color has red, orange, yellow, green, aqua, blue, purple and magenta ranges. Each range has hue shift (-180 to +180 degrees), saturation (-100 to +100 percent) and lightness (-100 to +100 percent). Reset color range clears only that range.
- Color tools default to PNG so transparency survives the default export. The existing output format chooser remains available; formats such as JPEG intentionally cannot retain alpha.

These are adjustable operations within the current tool session. Switching tools follows the existing PNG workspace workflow and commits that session to a working raster. This is not a cross-tool layer graph. Curve anchors have fixed input positions; adding arbitrary points or moving their horizontal coordinates is not supported. Layers and masks remain separate outstanding specification work.

## Shared native math

Android `ImageTools.kt` and iOS `ImageTools.swift` implement the same equations on straight sRGB channel values. No platform tone/filter preset substitutes for these operations.

Levels normalizes each straight channel using `clamp((input - black) / (white - black), 0, 1)`, then applies `pow(normalized, 1 / gamma)`. Gamma above 1 brightens midtones. Native validation uses a small floating-point tolerance for the one-step gap so valid neighboring 8-bit values are accepted.

For curves, inputs are fixed at `[0, .25, .5, .75, 1]`. Outputs must be finite and within `[0, 1]`. Linear interpolation between adjacent anchors defines each channel curve. Levels runs first, then the master curve, then the individual channel curve. A 256-entry table per channel rounds the combined result to 8-bit output. A neutral mapping skips the color pass. HSL follows the channel lookup.

HSL uses the usual max/min RGB conversion, with lightness `(max + min) / 2` and saturation `delta / (1 - abs(2 * lightness - 1))`. Neutral gray pixels are unchanged by hue-range edits. The eight hue centers are `[0, 30, 60, 120, 180, 240, 270, 300]` degrees. Adjustments interpolate linearly between adjacent centers, including magenta to red across 360 degrees. This avoids hard selection seams.

Hue adds the interpolated shift and wraps around the circle. Saturation multiplies by `1 + adjustment / 100` and clamps to `[0, 1]`. Positive lightness moves proportionally toward white, `L + (1 - L) * adjustment / 100`; negative lightness moves toward black, `L * (1 + adjustment / 100)`. HSL converts back to RGB and rounds to 8-bit channels. Alpha is never part of these equations.

Android reads and writes one native row of straight sRGB ARGB values. iOS materializes a bounded sRGB CGContext, converts its premultiplied channels to straight values before adjustment and premultiplies the result afterward, retaining the original alpha byte. Codec, color-management and premultiplication rounding can differ across operating systems; identical equations are not a claim of bit-identical files or broad-gamut preservation. This color module intentionally works in 8-bit sRGB.

## Preview, cancellation and memory

Preview and export invoke the same native kernel; previews keep the existing 1440-pixel longest-edge bound. Exports retain source dimensions within the existing device-dependent native memory guard. Oversized exports fail with resize guidance instead of silently reducing resolution. Both implementations run in their existing serial native job queues and check cancellation on every processed row. Source pixels never enter JavaScript.

Advanced previews now keep one running request and one replaceable pending snapshot. A continuous slider gesture can display completed frames while the next frame processes. Different sources, compare modes, screen lifetimes and export transitions invalidate old frames. Save and tool handoffs take a synchronous history snapshot, reject late settings events while locked and cancel/settle previews before exporting. The preview file cache retains at most three published frames, plus the currently running output.

Local drafts written before curves/HSL/Levels existed restore with neutral defaults for these new fields. Other settings remain subject to the existing validation. Transient curve samples are not persisted as separate undo steps. No paid dependency, cloud image operation, new package or background network call was added.

## Verification

Full Expo lint, TypeScript, offline Android Kotlin/C++ compilation and an Android-only JavaScript/Hermes bytecode export passed after the controls, gesture fixes and preview queue were added. iOS changes have source review only on this Windows host. No automated tests, device automation, web builds or runtime profiling were run. Alpha fidelity, orientation, cross-platform color comparisons, gesture feel and frame-rate measurements remain unverified by these source/build checks.

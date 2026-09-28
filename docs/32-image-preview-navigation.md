# Image library to preview scheduling

2026-09-29 source follow-up. The reported navigation frame drops were reviewed without a connected device, automation, profiling or network processing. The points below are code-level causes and mitigations, not measured frame-time results.

## Observed work on the navigation path

- `src/app/file-preview.tsx` mounted the native preview as soon as library metadata resolved, while the native stack slide could still be running. It also repeated the metadata lookup for a file already available to the list.
- Both `ZoomableImageView` implementations initially decoded up to twice the viewport's longest side, capped at 4096 pixels on larger devices. Decoding ran off the main thread, but displaying the resulting bitmap still required a large texture upload during the transition.
- Source and layout callbacks could enqueue redundant preview decodes. Android used an unbounded single-worker queue; iOS dispatched independent global tasks and had no view-destruction cancellation hook.
- Library-file taps did not pause thumbnails until focus changed. iOS also reapplied unchanged list/palette JSON and did not check the list's active state before attaching a completed thumbnail.

## Implementation

- The preview waits for the focused native stack screen's opening `transitionEnd` before starting image decoding and file-status/Recents work. It resets this readiness when the screen is covered. A one-second maximum fallback prevents direct-link or non-animated mounts without an event from remaining on the existing loader indefinitely. Navigation animation, header, toolbar, gesture behavior and file actions retain their current design.
- `src/features/files/preview-handoff.ts` transfers at most four metadata records from the list to the next preview, with a ten-second expiry and one-time consumption. It stores no image bytes. Deep links and edited-file revisions continue to resolve through SQLite; file existence is checked after the transition. Updating the Recents timestamp cannot convert a valid preview into an error.
- Opening a library/imported image marks the listing busy before pushing the route. This pauses native and fallback thumbnail work and prevents duplicate opens. An imported file forces the library to refresh when returning.
- Android and iOS first decode to the viewport's pixel size, capped at 1536 pixels on lower-memory devices and 2048 otherwise. Additional detail is requested after pinch/double-tap zoom settles, retaining the prior 2048/4096-pixel detail caps. A detail update preserves the current zoom/position; failure retains the working fit preview. Original files and export resolution are unchanged by preview downsampling.
- Android allows one running decode and one newest pending request. Both platforms suppress duplicate size requests, invalidate outdated callbacks, cancel pending work on detach/disposal and release displayed image references. iOS uses one utility decode operation at a time and the Expo view-destruction hook. A codec already executing may finish before cancellation is observed.
- iOS library JSON updates now skip identical values, and completed thumbnail callbacks check activity as well as cell identity/window attachment.

Native implementation paths are `modules/file-engine/android/src/main/java/expo/modules/fileengine/ZoomableImageView.kt`, `modules/file-engine/ios/ZoomableImageView.swift`, and `modules/file-engine/ios/RecentImagesView.swift`. Lifecycle registration is in `FileEngineModule.swift`. JavaScript-only scheduling changes also benefit an existing binary, but the decoding, queue and lifecycle changes require a new native build.

## Validation boundary

TypeScript and Expo lint passed locally on 2026-09-29 with Expo telemetry disabled and offline mode enabled; native Android compilation is consolidated with the other native changes. No automated tests, devices, cloud operations or web build were used. Swift compilation is unavailable in this Windows workspace. Smoothness, texture-upload cost and memory reclamation timing remain unmeasured without platform builds/profiling; this change makes no frame-rate or zero-leak guarantee.

API references consulted: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Expo Router stack](https://docs.expo.dev/router/advanced/stack/), and [native stack transition events](https://reactnavigation.org/docs/native-stack-navigator/#events).

## Save consistency after slider changes

`useEditHistory.getCurrent()` exposes the last synchronously accepted settings without waiting for a React render. The basic image editor takes that snapshot when Save or Apply begins, including crop, rotation-dependent resize dimensions, output format and quality. One synchronous lock covers the naming dialog and export; cancellation/errors release it in `finally`. Late native slider/crop events and queued control presses cannot change the settings while this snapshot is being saved. Slider memoization and the existing lossless PNG intermediate used for switching tools are preserved. This removes a source-level stale-render/duplicate-save race; it does not claim to recover native events that have not reached JavaScript.

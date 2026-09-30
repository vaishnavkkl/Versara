# LibreOfficeKit for Versara DOCX

Research date: 2026-10-01. Decision: retain the Documents module and replace its simplified DOCX layout engine with a Collabora Office engine renderer and editor on Android and iOS. The existing miniz/pugixml engine remains useful for format inspection and safe package access, but it must not be responsible for Word pagination.

## What the source provides

LibreOfficeKit is the C/C++ API over LibreOffice's document model. Its public API loads a document (`documentLoad` or `documentLoadWithOptions`), reports document size, paints page tiles into bitmap buffers (`paintTile`), accepts touch/keyboard and UNO commands, emits tile/cursor/selection invalidation callbacks, and saves through `saveAs`. This is a real layout engine rather than a DOCX-to-text conversion. The API is documented in [LibreOfficeKit](https://docs.libreoffice.org/libreofficekit.html) and its [C header](https://github.com/LibreOffice/core/blob/master/include/LibreOfficeKit/LibreOfficeKit.h).

Collabora Office's offline Android and iOS apps use the LibreOffice core. Their current source is in the [Collabora monorepo](https://gerrit.collaboraoffice.com/online), with the core under `engine/` and mobile clients under `android/` and `ios/`. The clients are important reference implementations for keyboard input, touch, selection handles, tile invalidation, and document lifetime. The [Android build guide](https://github.com/CollaboraOnline/CollaboraOnline.github.io/blob/master/content/post/build-code-android.md) and [iOS build guide](https://github.com/CollaboraOnline/CollaboraOnline.github.io/blob/master/content/post/build-code-ios.md) describe the source layout and platform builds.

**Current mobile source correction:** The maintained `distro/collabora/co-26.04-mobile` branch has renamed the native API to `COKit`, with a C++20 interface. Versara pins revision `5ae1c42aee3b09be881c5a3a97c0581f63404505` and vendors its [COKit API header](https://github.com/CollaboraOnline/online.mirror/blob/5ae1c42aee3b09be881c5a3a97c0581f63404505/engine/include/COKit/COKit.hxx) and [initializer](https://github.com/CollaboraOnline/online.mirror/blob/5ae1c42aee3b09be881c5a3a97c0581f63404505/engine/include/COKit/COKitInit.h). The older LibreOfficeKit links below explain the architecture, but implementation must follow the matching COKit headers and built binaries.

## Processing path and source entry points

1. Initialize the core, then load the local DOCX through `documentLoadWithOptions`. The engine parses the package into its Writer document model and lays out sections, anchored drawings, headers, footers, and text together. The matching current entry points are in [`COKit.hxx`](https://github.com/CollaboraOnline/online.mirror/blob/5ae1c42aee3b09be881c5a3a97c0581f63404505/engine/include/COKit/COKit.hxx).
2. Call `initializeForRendering`, get the document dimensions in twips, and request only viewport tiles through `paintTile`. The app maps twips to screen pixels and draws the bitmap tiles as pages. See the [tiled rendering API](https://docs.libreoffice.org/libreofficekit.html) and [`LibreOfficeKit.hxx`](https://github.com/LibreOffice/core/blob/master/include/LibreOfficeKit/LibreOfficeKit.hxx).
3. Convert screen touch positions to document coordinates and send `postMouseEvent`; send keyboard/IME input through the relevant text input and key event APIs; send formatting operations through `postUnoCommand`. On callbacks, update tiles, cursor, selection handles, and toolbar state. The [LibreOffice Android architecture](https://github.com/LibreOffice/core/blob/master/android/README.md) documents its worker thread, tile invalidation, input, and overlay handling.
4. Save via `saveAs` to a staged DOCX. The rendering session must own the loaded document and release it on close. The React Native bridge should pass small commands and state changes, while native code owns the large bitmap buffers and all LibreOfficeKit calls.

This is a processing architecture, not a promise of pixel-identical Microsoft Word output: font availability and unsupported Word features still need comparison against the supplied sample on devices.

## Integration boundary in this Expo app

1. Keep `src/app/doc-editor.tsx`, the file/recents routing, save flow, and React toolbar. Add a versioned rendering backend behind `modules/doc-engine`, rather than replacing the user workflow.
2. Build the LibreOffice/Collabora core outside the generated Expo `android/` and `ios/` directories. Package Android libraries per supported ABI and iOS static archives plus runtime data/fonts in the local native module. Configure linkage with a config plugin and a development build.
3. Expose a small session API: open a local DOCX path; get page geometry/count; request visible tiles at a bounded zoom; send touch, keyboard and formatting commands; receive invalidation, cursor, selection, and dirty-state events; save to a staged DOCX path; close and release the session. Keep document bytes and tile buffers out of React JavaScript.
4. Render only visible page tiles and a small prefetch margin. Bound bitmap caches and pending tile jobs, cancel superseded requests, pause work off-screen, and release the document before deleting temporary files.
5. Stage saves to a new file, reopen for validation, then use the app's existing recoverable replace/save-as flow. Keep the original untouched on any failed save.

## Platform build facts

- **Android:** Collabora's native engine build requires Linux, a compatible Android NDK, and separate binaries for each ABI. Its app uses a native worker for LibreOfficeKit calls and a tile rendering surface. A Windows-only local build cannot validate this backend. [Source](https://github.com/CollaboraOnline/CollaboraOnline.github.io/blob/master/content/post/build-code-android.md)
- **iOS:** The engine must be built on macOS with Xcode; the build produces static archives. Collabora's guide says its app currently requires a physical iOS device for testing because its engine target is not the simulator target. Versara needs its own signed build to validate the integration. [Source](https://github.com/CollaboraOnline/CollaboraOnline.github.io/blob/master/content/post/build-code-ios.md)
- **Licensing:** LibreOfficeKit headers are MPL-2.0; the full mobile distribution includes other components and assets. Audit bundled licenses and app distribution obligations before shipping. [Source](https://github.com/LibreOffice/core/blob/master/include/LibreOfficeKit/LibreOfficeKit.h)

## Verification target

Use the supplied `RFO_Template(4).docx` as a regression document. It has four Word section properties, thirteen floating drawings, VML header artwork, and many recorded page transitions. Compare page count, drawing placement, headings, tables, and headers against a trusted desktop rendering on both physical Android and iOS devices. The current native text layout is not a valid fidelity baseline. Work is complete only when open, edit, save, reopen, and PDF export preserve those elements without page overflow or missing graphics.

## Integration state

`modules/doc-engine/cpp/CokitSession.*` now wraps the pinned API for opening Writer files, bounded page tiles, page geometry, input, UNO commands, callbacks, and staged DOCX/PDF saves. Android JNI and iOS Objective-C++ wrappers exist, and the Android C++ bridge passed an NDK syntax check. The Android build compiles this wrapper into Collabora's engine library, exposing only its C symbols to the Expo module. This keeps C++ objects and allocator calls inside the same binary. The native module links COKit only when the matching vendored binary is installed. A manual GitHub Actions workflow is configured to build the free source for Android arm64 and iOS device arm64; `scripts/install-cokit-artifacts.mjs` checks the revision and package contents before installing them.

**Still required for a working editor:** Run and fix the source builds, bundle and initialize all mobile runtime assets, connect a tiled editing surface and IME/selection callbacks to the current screen on both platforms, and validate the supplied document on devices. At this point the app still uses the simplified editor. No COKit binary has been built, linked, or tested in a Versara app build. The `nativeCokitAvailable` flag reports binary linkage only; it does not mean the document screen uses the engine. The standard GitHub macOS runner has 14 GB of storage, so whether the iOS source build fits must be established by running it; no paid runner is selected.

The source is free software under MPL 2.0 and other included open-source licenses. GitHub says standard Actions runners are free for a public repository; Versara's GitHub repository is public. Artifact size is capped in the workflow and retention is one day. The complete third-party license notices and corresponding source access must accompany any distributed native binaries. [LibreOffice licensing](https://www.libreoffice.org/licenses/) · [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

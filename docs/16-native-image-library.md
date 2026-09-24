# Native recent images and library layouts

## Structure and diagnosis

The app uses Expo SDK 57. Routes live in `src/app`, shared controls in `src/components`, and file/PDF workflows in `src/features`. `modules/file-engine` handles native device access and imports; `modules/pdf-engine` handles native PDF rendering, editing, conversion and PDF/media thumbnails. Appearance comes from the shared palette and Settings.

Previously, the shared recent-files screen rendered images through a JavaScript-managed FlatList. Image thumbnails bypassed the native thumbnail queue and sent original image URIs to expo-image, without an explicit small raster size. This was a likely source of decode/rebind pressure during scrolling, not a measured diagnosis of every dropped frame.

## Changes

- Recent images now use Android GridView with recycled adapter cells and iOS UICollectionView. Native code owns scrolling, cell reuse, thumbnail requests and bitmap caching. React sends a bounded metadata snapshot and receives open/remove actions; image bytes never cross into JavaScript.
- The same native list serves PDF, Image, Video and Audio libraries (native list version 2 adds video frames and audio artwork; older binaries keep the React Native list for video/audio).
- List thumbnails are 40 points/dp. Decode targets are at most 112 pixels in lists and 208 in grids (72/144 on low-memory devices). Android first asks the content provider for its cached thumbnail (`loadThumbnail`, Android 10+), then falls back to ImageDecoder/sampled BitmapFactory with EXIF orientation, MediaMetadataRetriever frames for video and embedded artwork for audio. iOS uses ImageIO downsampling, AVAssetImageGenerator, AVAsset artwork or local Photos previews. Photos preview requests do not download cloud assets.
- Android cells are built once per layout type (list or grid) and binding only swaps text, colours and bitmaps, so scrolling does not trigger layout-parameter churn. Thumbnail requests pause during flings and resume for visible cells when scrolling settles.
- The native image cache targets 2 MB on low-memory devices and 4 MB otherwise. Android uses one decoder on low-memory devices and two otherwise, with a newest-first queue of at most 24 requests (oldest dropped). iOS uses one or two decode operations with at most 24 queued; Photos requests belong to visible cells and are cancelled on reuse. Native lists release work when covered/backgrounded, and caches respond to memory warnings. Only up to 160 metadata records are accepted.
- Appearance controls remain only in Settings. Home, tool catalogs, and PDF/Image/Video/Audio libraries have a single grid/list toggle button, remembered per screen.
- PDF and media toolboxes use tool grids in native sheets at three-quarter height. iOS uses a fraction detent. Android drives the Material sheet directly with its half anchor skipped and a fixed 75% content height, because SDK 57's universal fraction prop snaps to half/full on Android. Tools start only after the sheet has finished closing, so pickers and screens never open over a dismissing sheet. Unavailable tools remain disabled and labelled.
- Files never open inside sheets or tool screens: recents open `file-preview`, and tool results or page previews open the `pdf-viewer` route. Full screens use a back button on the left; close buttons appear only on the right of sheets.
- Older development binaries retain the existing image-list fallback and show a rebuild notice instead of attempting to mount a missing native view. No dependency was added.

## Validation

Run `npx.cmd expo lint` and `npx.cmd tsc --noEmit`. No automated tests or web builds were run.

Android Kotlin compilation (`:file-engine:compileDebugKotlin`) passes. Swift compilation is unavailable on this Windows workspace. Both native implementations therefore require compilation and device validation in a new development build.

Manual checks: scroll and fling device/imported photos in both layouts; include large JPEG/HEIC, rotated images, corrupt/missing files and local/cloud-only Photos assets; open and remove items; search; background and return; switch themes in Settings; check TalkBack/VoiceOver, large text and rotation; open and scroll each toolbox and confirm it starts at 75% height. Profile frame times and allocations on Android and iOS, including a low-memory device. Static checks do not establish stutter-free scrolling or absence of leaks.

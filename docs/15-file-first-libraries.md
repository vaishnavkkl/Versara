# File-first libraries

PDF, Image, Video and Audio now follow **category → recent file → preview → Options**. The dashboard remains a two-column grid. Category screens no longer list tools as cards.

- Each category has search, a system file picker and up to 100 recent matching files ordered by last open time. Search can find older records. Recents contains files imported into Versara and PDF outputs created with this implementation; it does not scan the user's whole device or fabricate history.
- Imports are retained under the application's documents directory. SQLite stores metadata and relative document paths, so iOS sandbox prefix changes do not invalidate new entries. Removal deletes only owned imports; external originals and saved PDF exports are preserved.
- PDF opens full-screen with a compact close header, native zoom, a virtualized horizontal page-thumbnail strip, page navigation and Options. Vertical scrolling and focus view remain in Options. Focus view hides the strip for more reading space.
- Images use a fitted native preview. Create PDF receives the current image and allows adding more. Video and audio use native Expo playback; hooks release players when the screen loses focus or enters the background. Playback does not request microphone access or enable background services.
- Media actions use native sheets. Available actions are shown first; upcoming editing tools remain clearly disabled in a collapsed list.
- PDF thumbnails use Android PdfRenderer / iOS PDFKit. Video thumbnails use MediaMetadataRetriever / AVAssetImageGenerator. Audio uses bounded embedded artwork on Android when present, otherwise a waveform icon; iOS audio currently uses the waveform icon.
- Thumbnail work is serialized off the JS thread and limited to small raster outputs. Components release requests on unmount/inactivity; unused jobs are cancelled, cache entries are capped and old disk previews are pruned. Virtualized lists keep image decoding bounded to the render window. Only URIs and metadata cross the JS bridge.

## Validation

Run lint, TypeScript checking and the Android native module compile check. No automated tests or web builds. Swift code requires iOS compilation and device validation. Added expo-video, expo-audio and native thumbnail methods require a new development build; a JavaScript reload alone is insufficient.

Manual checks: import one file of each type; cancel a picker; reopen after restarting the app; search and remove imports; try a missing/corrupt file; jump through a multi-page PDF using thumbnails and vertical mode; pinch to zoom; create a PDF from the current image; confirm generated PDFs appear in Recents; switch categories and backgrounds during playback; check both appearance modes and large font sizes. Device profiling is still required to measure memory and frame time under large-file workloads.

# File selection and image-to-PDF

## Entry points

- The standalone Files module has been removed from the dashboard and navigation.
- PDF > Image to PDF and Image > Images to PDF open the same native converter.
- PDF tools retain their system file pickers. The PDF Viewer reads selected documents, and Image to PDF lets users choose source images.
- Only selected files are read. No broad storage permissions, filesystem scanning, or upload service is used. A cloud file provider may download a file before returning it to the app.

## Conversion

Select up to 30 images, remove/reorder them, enter a PDF name, and choose A4, Letter, or Fit image. Each image becomes one page. Paper presets use an 18-point white margin and automatically choose portrait/landscape; Fit image preserves the image's aspect ratio without a margin. Images are contained without cropping, transparent areas are white, and EXIF orientation is applied natively.

Android uses `ImageDecoder` on API 28+, or sampled `BitmapFactory` plus native `ExifInterface` on API 24–27, and writes pages with `android.graphics.pdf.PdfDocument`. HEIC requires decoder support on the device; older devices receive an actionable error.

iOS uses ImageIO to downsample and orient images, and a Core Graphics PDF context to write pages. Decoding and PDF creation run on serial background queues on both platforms. No image bytes/Base64 cross the JavaScript bridge.

Decoded images are limited to 2,200 pixels on the longest side and three million pixels each, with a 24-million-pixel budget divided over the selected pages. This trades extreme zoom detail for bounded memory use. iOS releases decoded image resources per page; Android also caps total page raster data retained by its PDF writer. Device memory stress testing is still required.

Native job events report completed pages. Cancellation is checked between decoding, page creation and output writing; an in-progress decoder or final native write completes before cancellation settles. Closing the sheet requests cancellation and defers input deletion until native work finishes.

## Storage and results

Selected files are copied into a session-specific cache folder. Picker copies and session files are cleaned up without deleting originals. The converter validates its output parent, writes to a `.partial` file, then moves it into Documents/Versara PDFs only after success. Failed/cancelled jobs remove their partial output.

Successful PDFs persist in app storage. The result offers Open PDF, Save/share a copy, Create another PDF, and Delete this PDF. Users should export a copy to their preferred folder before closing the result; there is no standalone in-app file browser. The system share sheet exports copies to available destinations; iOS includes Save to Files. Removing the Files module does not delete previously created PDFs.

## Verification

Lint, TypeScript, and Android module Kotlin compilation passed during implementation. No web builds or automated tests were run. The native module must be included in a new development build; iOS compilation and on-device checks remain necessary.

Manual checks: cancel the picker; select JPEG/PNG/HEIC and unsupported images; reorder/remove pages; verify photo orientation, white transparency, every paper option, filenames, progress, cancellation, sheet dismissal during conversion, free-storage failures, share cancellation, saved output reopening, large images, and both themes.

The visual palette uses the supplied deep-blue reference. Navigation has an oval selected background with a blue gradient and white icons; light mode retains light content surfaces with the same blue navigation.

# Image Tool Suite

Heavy media processing must be done locally via native engines (e.g., CoreImage and Android image codecs) and never on the React Native JS thread.

The implemented image tools, platform encoder availability, memory limits and file actions are documented in [Image tools and file actions](27-image-tools-and-file-actions.md).

Native tone curves, Levels and HSL controls are covered in [advanced color editing](32-native-tone-curves-hsl.md). Slider scheduling and image-list navigation improvements are documented in [the editor follow-up](33-ocr-and-image-preview-follow-up.md).

## Image Utilities
- **Compression:** Target file size, quality-based, batch compression. Must show before/after preview.
- **Resize:** Exact pixels, percentage, aspect-ratio lock, social presets.
- **Format Conversion:** JPG/JPEG, PNG, WebP, HEIC/HEIF (TIFF where native).
- **Operations:** Crop, rotate, flip, rename, batch processing.
- **Image → PDF:** Support multiple images, layout options (A4, Letter, fit/fill, margins).

## Separate modules
Audio and Video are no longer part of this app. Their planned capabilities are tracked in [the separate module scope](23-standalone-module-scope.md).

## User Experience Rules
- **Batch Processing:** Support batch operations where technically safe (e.g., compress 10 images at once).
- **No JS Thread Blocking:** Long operations require progress, cancellation, error handling, and temp-file cleanup.
- **Safe Share Workflow:** A signature workflow could be: *Choose photo → privacy scan → remove metadata → share*.

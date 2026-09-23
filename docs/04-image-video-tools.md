# Media Tool Suite (Images & Video)

Heavy media processing must be done locally via native engines (e.g., AVFoundation, MediaCodec, CoreImage) and never on the React Native JS thread.

## Image Utilities
- **Compression:** Target file size, quality-based, batch compression. Must show before/after preview.
- **Resize:** Exact pixels, percentage, aspect-ratio lock, social presets.
- **Format Conversion:** JPG/JPEG, PNG, WebP, HEIC/HEIF (TIFF where native).
- **Operations:** Crop, rotate, flip, rename, batch processing.
- **Image → PDF:** Support multiple images, layout options (A4, Letter, fit/fill, margins).

## Video Utilities
- **Compression:** User selects target size (10MB, 25MB, 50MB, custom) or presets (WhatsApp, Email, High quality).
- **Information:** Show original size, duration, resolution, frame rate, estimated output, codec.
- **Additional Tools:** Trim, crop, resolution conversion, frame-rate conversion, extract frame, mute audio. (Video editor features are limited in V1).

## User Experience Rules
- **Batch Processing:** Support batch operations where technically safe (e.g., compress 10 images at once).
- **No JS Thread Blocking:** Long operations require progress, cancellation, error handling, and temp-file cleanup.
- **Safe Share Workflow:** A signature workflow could be: *Choose photo → privacy scan → remove metadata → share*.

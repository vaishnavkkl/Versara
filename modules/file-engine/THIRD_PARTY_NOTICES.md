# Native image processing dependencies

Android image text recognition uses Tesseract4Android 4.9.0 (Apache-2.0), with the same bundled Tesseract `tessdata_fast` 4.1.0 English model used by the PDF engine. The `pdf-engine` Android module contributes `tessdata/eng.traineddata` and OCR notices from its prepared assets to the application; `file-engine` does not download models at runtime. The recognizer extracts line text, bounds and baseline angles locally. The former Google ML Kit text recognition dependency is no longer declared.

The shared model and its Apache license are prepared by `scripts/prepare-pdf-ocr.mjs`. Tesseract's native dependencies retain their own upstream terms; see the packaged `licenses/tesseract` notices and the Tesseract4Android distribution's notices. This file does not replace those notices.

iOS image text recognition uses Apple's local Vision framework. Image decoding, graphics and encoding use the operating system's APIs. Apple system frameworks are platform dependencies, not FOSS libraries or cloud processing services. There is no paid per-image processing SDK or app-owned cloud API in these paths.

Replacing an OCR engine preserves the application result contract, but does not guarantee identical text recognition accuracy or language coverage. The currently packaged Android model is English.

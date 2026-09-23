# PDF Tool Suite

The PDF Tool Suite is a major subsystem focused entirely on local, offline document processing. 
*Note: DOCX → PDF is explicitly excluded from V1.*

## Core Features
- **PDF Viewer:** Open local PDFs, page thumbnails, zoom, search text, dark mode, share, print.
- **Organization:** Merge, split, extract pages, delete pages, reorder, rotate, duplicate, insert pages.
- **Conversion:** JPG/PNG/HEIC → PDF, PDF → JPG/PNG, PDF pages → images.
- **Compression:** Quality-based (Max quality, Balanced, Max compression). Must show original size, estimated size, and expected quality prior to processing.
- **Information:** Page count, file size, dimensions, PDF version, encryption status.

## Progressive Features (Post-V1)
- **Editing & Annotation:** Add text, highlight, draw, shapes, signature, watermark, page numbers.
- **Security:** Password protection, metadata removal, flatten annotations.
- **OCR:** OCR scanned PDFs, extract text, export extracted text.
- **Repair:** Detect and attempt safe repair of malformed PDF structures (do not claim repaired unless validated).

## Security & Implementation Rules
- Always use native platform PDF libraries (e.g., PDFKit on iOS, PdfRenderer on Android).
- Password removal is only allowed when technically/legally permitted by the file.
- Printing should use native iOS/Android mechanisms (no cloud printing).

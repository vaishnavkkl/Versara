---
name: create-native-module
description: Guide and rules for scaffolding and implementing local Expo native modules for heavy processing.
---

# Creating Local Native Modules in Expo

When implementing heavy processing features like PDF manipulation, image/video compression, or OCR, follow these guidelines to create robust native modules.

## Scaffold the Module
Use the Expo CLI to generate a local native module:
`npx create-expo-module --local [module-name]`

Suggested modules for this project:
- `pdf-engine`
- `media-engine`
- `image-engine`
- `ocr-engine`
- `redaction-engine`

## Core Rules
1. **Thin Wrappers:** The module should primarily wrap a stable native iOS/Android library (e.g., PDFKit, AVFoundation). Keep business logic in JS where possible, but keep heavy iteration/processing in Native.
2. **Asynchronous Execution:** Heavy processing MUST be asynchronous. Return Promises from Kotlin/Swift to avoid blocking the React Native JS thread.
3. **Structured Errors:** Return categorized errors (e.g., `PDF_PASSWORD_REQUIRED`, `MEDIA_PROCESSING_FAILED`), not generic crashes.
4. **Memory Management:** NEVER pass large data as Base64 strings. Always accept and return file paths (URIs).
5. **Job Progress:** For long-running tasks, implement a progress callback mechanism to update the JS layer.
6. **Cancellation & Cleanup:** Allow operations to be cancelled. Always clean up temporary files created during processing.

## Example Native Signature
```swift
// Swift Conceptual Example
@Async
func compressPdf(inputUri: String, options: [String: Any], promise: Promise) {
    // Process asynchronously, do not block main thread
    // Return outputUri
}
```

# App Architecture & Technical Standards

## Native Module Architecture
Heavy functionality must not run on the React Native JS thread. Create modular native interfaces using Expo Modules API (Swift for iOS, Kotlin for Android).

Suggested modules:
`pdf-engine`, `media-engine`, `image-engine`, `ocr-engine`, `redaction-engine`, `network-engine`, `battery-engine`, `ai-engine`, `file-engine`, `print-engine`.

Each module should expose a minimal typed API to TypeScript, keeping the JS layer thin.

## File Access & Memory Safety
- Use system document/photo pickers.
- Prefer passing file URIs (paths) to native modules. NEVER use Base64 strings for large files.
- The application must not crash due to OOM (Out Of Memory) when processing large files (e.g., 500MB videos, 200MB PDFs).
- Heavy operations must run asynchronously, never block the JS thread, support cancellation, and clean up temporary files.

## Storage & Job System
Use local **SQLite** for:
- Recent operations & Tool history
- Favorites & Settings
- AI conversations
- Diagnostic sessions
- Model metadata

**Job System Abstraction:**
Build a unified processing job system to track operations across modules.
Statuses: `queued`, `processing`, `completed`, `cancelled`, `failed`.

## AI Fallback & Context Control
- AI (e.g., via `react-native-executorch`) is strictly optional. The app must work fully offline without it.
- Never send the whole device/filesystem to the LLM context. Pass only the minimum structured data (e.g., selected text, structured diagnostic JSON).
- The LLM must not directly execute arbitrary file operations; it should output structured data for validation by the application layer.

## Error Handling
Every native operation must return structured errors (e.g., `PDF_PASSWORD_REQUIRED`, `MEDIA_PROCESSING_FAILED`). User-facing messages must be understandable and actionable.

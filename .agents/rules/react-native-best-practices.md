# React Native & App Best Practices

## 1. Performance & Memory Safety
- **Never block the JS thread:** Heavy operations (PDF processing, image/video compression, OCR) MUST run asynchronously on native threads using Expo Modules.
- **File Handling:** ALWAYS pass file URIs (paths) between JS and Native. NEVER use base64 strings for large files (images, PDFs, videos) to prevent memory bloat and out-of-memory (OOM) crashes.
- **Rendering:** Use `FlashList` for lists. Use `React.memo`, `useMemo`, and `useCallback` appropriately to prevent unnecessary re-renders.
- **Animations:** Use `react-native-reanimated` for all animations to ensure they run on the UI thread at 60/120fps.

## 2. Theming & UI
- **Light & Dark Mode:** Support cross-platform light and dark themes from day one. Use a centralized theme token system.
- **Accessibility:** Ensure large tap targets (minimum 44x44pt).

## 3. Architecture & Navigation
- **Routing:** Use `expo-router` for file-based navigation. Keep screens in `app/` and components outside.
- **Persistence:** Use SQLite for complex data and history. Avoid `AsyncStorage` for anything other than basic key-value preferences.
- **Thin JS Layer:** The React Native side should act as an orchestrator. Complex logic and processing belong in native modules.

## 4. Offline First & Privacy
- **No Cloud Dependency:** Core features must work completely offline.
- **Permissions:** Request permissions just-in-time, only when a feature is activated, not on app startup.

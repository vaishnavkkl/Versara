# Library thumbnails after saving

PDF and image thumbnails now use a file revision in addition to the URI. Replacing a file at the same path no longer selects its earlier decoded thumbnail.

- Successful saves notify the category lists, device PDF list and shared thumbnails. Returning to a list bypasses the short metadata cache after a save, including Save as new.
- App and device copies receive separate thumbnail revisions, so repeated saves with the same size or device modification timestamp still refresh.
- Android and iOS native lists use the revision in their bounded thumbnail caches (`nativeImageListVersion = 5`). Earlier installed builds recreate the native list when the library changes to discard their URI-only cache.
- Recents and Edited files pass metadata revisions to the shared thumbnail component. Image views reload after a revision change, and PDF requests reject earlier component results. Invalidated pending cache entries are detached; their generated files are released after their last owner leaves.
- Recovery also invalidates previews after restoring or completing an interrupted replacement. Revision tracking retains at most 256 file URIs and removes component subscriptions on teardown. Hidden previews remain paused.

Verification: `npx expo lint --no-cache`, `npx tsc --noEmit`, Android `:file-engine:compileDebugKotlin --offline`, and diff whitespace checks passed. The already-declared `expo-clipboard` dependency was restored in `node_modules` before the final static checks; package declarations and the lockfile are unchanged. No automated tests or web builds were run. Swift compilation and device interactions remain unverified on this Windows workspace.

Manual device acceptance: edit an image or the first page of a PDF, Save, then return to its category list in both grid and list layouts. Repeat rapidly, including a same-size output. Check Recents and Edited files, Save as new, and saving from an edited-file entry before switching to another category. Unchanged items should retain their cached thumbnails on a build with list version 5.

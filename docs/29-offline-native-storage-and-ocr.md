# Offline native OCR and app storage

Implemented 2026-09-29 following the dependency/network audit. Changes reuse the existing native modules and visual components. No device automation, model/SDK download, cloud processing service, or paid dependency was used for this work.

## Android image OCR

Exception (2026-10-01, by product decision): Android image **Edit text** recognition uses Google ML Kit `text-recognition` 16.0.1 again, with its Latin model bundled in the app. The editor's size and baseline mapping were tuned to ML Kit line boxes, and Tesseract boxes did not keep the original text style. ML Kit is no-cost but proprietary, and Google documents SDK usage metrics, so the app must not claim to be fully FOSS or free of analytics. Image privacy scans and PDF OCR stay on Tesseract, and iOS uses Apple Vision.

`file-engine` otherwise uses the already cached Tesseract4Android 4.9.0 dependency instead of Google ML Kit. The PDF engine already packages `tessdata/eng.traineddata`; image OCR copies that asset into its app-owned no-backup directory once. There is no runtime network fallback.

The existing TypeScript result contract remains unchanged: analysis dimensions; up to 400 lines; normalized upright-image rectangles; text, angle, text color and sampled background colors. Line baselines in native hOCR provide skew angles, and the existing background/style sampling remains in use. Recognition runs on the native worker with the existing 2048-pixel analysis limit. Text edits still export from the source image, not from the analysis bitmap.

The packaged model is English. Tesseract and the former Latin ML Kit model have different recognition behavior; exact accuracy, rotated-text behavior and multilingual parity are not claimed from code checks. iOS continues using local Apple Vision. Apple system frameworks are platform APIs rather than FOSS libraries.

## Cancellation and resource lifetime

The optional `FileEngine.cancelImageTextRecognition(uri)` method cancels queued and active recognition of the matching source URI. A native request is registered before worker dispatch, so leaving the editor before the worker starts does not leave an uncancellable OCR job behind. Matching a completed request by identity prevents its teardown from removing a newer request for the same URI.

Android signals Tesseract `stop()` and also checks cancellation in the progress callback and result loop; recognition objects/iterators and analysis bitmaps release in `finally`. iOS cancels its `VNRecognizeTextRequest`, checks cancellation before/after processing and while collecting results, and drops registration in `defer`. Module teardown cancels recognition. Cancellation is cooperative, so model initialization/decoding already in progress can finish its current native operation before cleanup.

## Full-resolution text export

Android text export now uses the image engine's memory-aware full-resolution decoder. Only previews use the capped preview decoder. A final edit that cannot fit the native working-memory budget reports a resize/retry error instead of silently reducing resolution. JPEG output explicitly composites transparency over white; PNG output retains alpha. Both platform text exporters retain the other image-integrity changes documented with the image engine.

## Local Photos imports

iOS Photos import requests set `isNetworkAccessAllowed = false` for both image and legacy video paths. A cloud-only asset returns `FILE_NOT_LOCAL` with guidance to choose a file already present on the device. Native listing thumbnails already disabled network access and continue doing so.

The Photos callback only returns data/a local URL to the native worker. It does not write the destination from the callback. A timeout cancels the Photos request; a late callback therefore cannot create an unexpected file after the importing screen has closed. Existing local imports still use the same destination/name/result contract.

## Backup exclusions

`app.json` sets Android `allowBackup: false`. The durable `plugins/with-local-storage.js` plugin also generates explicit legacy backup exclusions and Android 12+ cloud/device-transfer exclusions for app roots, files, SQLite databases, preferences, external app data and device-protected data. Only these plugin mods were applied to the existing generated Android project; no destructive prebuild was used.

For iOS, the same plugin emits `VersaraExcludeAppDataFromBackup`. The local module registers `LocalStorageAppDelegateSubscriber`, which sets the excluded-from-backup resource value on the app's Documents and Library directories at launch and foreground. This covers saved/imported documents, drafts, databases and preferences underneath those directories. Failures are logged rather than crashing launch. A new native app build with the config plugin is required for these changes.

This changes future app-data backup participation. It does not delete an existing device backup, disable the user's OS backup service globally, or control files that users have exported to Photos, external folders, or another provider.

## Dependency removal and remaining provider boundary

The unused `expo-notifications` dependency and its orphaned lockfile dependencies were removed with an offline, lockfile-only npm operation with install scripts/audit/funding requests disabled. An explicit Expo autolinking exclusion also prevents an old local `node_modules` copy from linking Firebase Messaging into the next build. Offline autolinking resolution confirmed the notification module is absent while `file-engine` remains linked.

Generic system document/folder pickers and the user-directed native share sheet remain available. An OS file provider or sharing destination can perform its own network activity outside Versara's native processing. This change does not claim that every third-party provider is constrained to local storage. Enforcing that boundary would require provider-specific availability handling and can change which files users can select; the existing picker flow was preserved.

## Verification

The local-storage config plugin passed JavaScript syntax checking. Its Android-only mods generated the expected manifest policy and backup XML. Offline autolinking resolution contains no notification module. The Tesseract API was inspected from the existing cached AAR; no new SDK/model was fetched. Consolidated lint/typecheck and native compile results belong to the coordinating implementation report.

No connected device, simulator automation, automated test suite, or web build was used. OCR accuracy, visual behavior, actual memory/frame performance, OS backup behavior and iOS compilation remain unverified on-device in this Windows workspace.

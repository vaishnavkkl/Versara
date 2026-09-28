# Dependency and network audit

Date: 2026-09-28. Scope: source, configuration, lockfile metadata, vendored license files, and primary upstream documentation. This audit changes documentation only. It did not use a connected device, run app automation, install dependencies, submit builds, enable a cloud service, or change an existing screen or feature.

Historical snapshot: subsequent implementation on 2026-09-29 replaces Android ML Kit image OCR, removes unused notification autolinking, disables Photos downloads and adds backup exclusions. See [the implementation and its remaining provider boundary](../29-offline-native-storage-and-ocr.md). Findings below describe the code at the audit date.

## Result

The PDF/image processing entry points are implemented locally in Kotlin, Swift, and C++ through the existing `pdf-engine` and `file-engine` Expo modules. No paid PDF/image editing SDK, license-key requirement, cloud processing endpoint, advertising integration, or payment integration was found in the inspected application source and declared dependencies.

However, **the current app cannot be described as entirely FOSS or entirely free of possible network activity**:

1. Android image OCR uses Google's no-cost, proprietary ML Kit SDK. Recognition runs on-device with a bundled model, but Google's documentation also describes SDK diagnostics/usage metrics sent to Google.
2. Importing a Photos asset on iOS explicitly permits downloading an iCloud-only original.
3. Android's application manifest permits OS backup. No app-owned exclusion policy was found for saved documents or preferences.
4. System document providers and user-selected sharing destinations can access cloud services independently of the local processing engine.
5. An unused application-level notification dependency includes Firebase Cloud Messaging on Android. Presence alone does not prove registration or runtime traffic.

These are existing findings to resolve deliberately. This audit does not disable OCR, remove cloud-only file access, alter backups, or remove dependencies, because those actions could change current behavior.

## Dependency inventory

| Component | Actual project evidence | Classification and constraints |
| --- | --- | --- |
| Expo 57.0.24, React 19.2.3, React Native 0.86.3 | `package.json`, `package-lock.json` | Open-source framework/UI layer. React Native screens and configuration run in JavaScript; heavy processing is native. A claim that every app component is native-only would be inaccurate. Expo packages do not by themselves require an EAS subscription. |
| PDFium Chromium revision 8066 | `scripts/prepare-pdfium.mjs:10`, `modules/pdf-engine/android/CMakeLists.txt`, `modules/pdf-engine/PdfEngine.podspec` | Native PDF editor for both platforms. PDFium's BSD-style license and additional upstream notices are present under `modules/pdf-engine/vendor/android-arm64/licenses/` and matching iOS archive directories. Binary distribution tooling has an MIT license. No paid SDK activation is present. |
| PDFBox-Android 2.0.27.0 | `modules/pdf-engine/android/build.gradle:12`; `modules/pdf-engine/android/src/main/assets/licenses/pdfbox/LICENSE.txt` and `NOTICE.txt` | Native Android PDF manipulation, Apache-2.0 with upstream resource notices. Its Adobe glyph/font attribution is not evidence of a commercial Adobe SDK. |
| Tesseract4Android 4.9.0 and `tessdata_fast` 4.1.0 English data | `modules/pdf-engine/android/build.gradle:13`, `scripts/prepare-pdf-ocr.mjs`, `modules/pdf-engine/android/src/main/java/expo/modules/pdfengine/PdfAdvancedTools.kt:124` | Free/open-source Android PDF OCR. The English model is bundled at build time and copied from application assets at runtime. No runtime model fetch is implemented in this path. OCR currently initializes `eng`; multilingual support is not implemented here. |
| Google ML Kit text recognition 16.0.1 | `modules/file-engine/android/build.gradle:22`, `modules/file-engine/android/src/main/java/expo/modules/fileengine/ImageText.kt:30` | No-cost proprietary Android image OCR SDK. The `com.google.mlkit:text-recognition` artifact includes its Latin model. This is different from the Play Services model-download artifact, but bundling does not establish a no-telemetry guarantee. See the network findings below. |
| Apple PDFKit, Vision, Core Graphics, ImageIO, Photos, UIKit and platform codecs | Both local module podspecs; `modules/file-engine/ios/ImageText.swift:26`; `modules/pdf-engine/ios/PdfAdvancedTools.swift:141` | System frameworks used locally, with no application per-document processing charge or app server integration found. They are Apple platform APIs, not FOSS libraries. Apple Vision OCR runs through `VNImageRequestHandler` on a local image. Store distribution/account costs are outside this runtime dependency audit. |
| nlohmann/json 3.12.0; stb_image_write | `modules/pdf-engine/cpp/third_party/JSON-LICENSE`, `STB-LICENSE`, `modules/pdf-engine/THIRD_PARTY_NOTICES.md` | MIT-licensed native utilities; no cloud operation or paid API. The project notices select stb's MIT option. |
| React Native UI, gesture, animation, SVG and state packages | `package-lock.json` entries for `@expo/ui`, `@gorhom/bottom-sheet`, Gesture Handler, Reanimated, Worklets, Screens, Safe Area Context, SVG and Zustand | Their package metadata declares MIT. Native package implementations/transitive notices still need to be retained when distributing the app. |
| Sora font | `node_modules/@expo-google-fonts/sora/LICENSE_FONT`, `LICENSE`, `app.json` font plugin | Font is OFL-1.1; package tooling is MIT. The `.ttf` assets are bundled locally. No runtime Google Fonts HTTP fetch was found. |
| Expo Notifications 57.0.20 | `package.json:20`, `node_modules/expo-notifications/android/build.gradle`, its Android manifest | MIT Expo wrapper includes `com.google.firebase:firebase-messaging:25.0.1` and `ExpoFirebaseMessagingService`. No application import, scheduling invocation, push-token registration, or Firebase project configuration was found. This still adds cloud-capable native code and should be evaluated for removal in a separate behavior-preserving cleanup. |

The npm lockfile contains 898 package records including the root. Every non-root record declares license metadata. Most declare MIT; other entries include Apache-2.0, BSD, ISC, OFL-1.1, MPL-2.0, CC-BY-4.0, and dual-license alternatives. Examples requiring their own notices are `lightningcss`/platform packages (MPL-2.0), `caniuse-lite` (CC-BY-4.0), and `node-forge` (BSD-3-Clause OR GPL-2.0). These declarations do not indicate a paid runtime subscription. They are metadata, not an exhaustive audit of every distributed file or a determination that all license obligations are already satisfied.

## Existing network and cloud-capable behavior

### Android image OCR: bundled model, SDK telemetry

`ImageText.recognize` constructs ML Kit's `TextRecognizer`, passes a local decoded bitmap, and closes the recognizer in `finally`. No app-written upload of that bitmap was found.

Google identifies the selected `com.google.mlkit:text-recognition` dependency as the bundled installation: the model is linked into the app at build time. [Official Android text recognition documentation](https://developers.google.com/ml-kit/vision/text-recognition/v2/android).

Google describes ML Kit as no-cost and on-device. Its terms state that input/output data stay on-device, but also describe server contacts and transmission of performance/utilization metrics. Restrictions on extracting its source distinguish it from an open-source dependency. [ML Kit overview](https://developers.google.com/ml-kit/guides), [Terms and privacy](https://developers.google.com/ml-kit/terms).

Google's Android disclosure includes device/app information, per-installation identifiers for bundled features, performance information and API configuration among SDK-collected data. Exact traffic from this built app was not observed because no device/network profiling was authorized. [Android data disclosure](https://developers.google.com/ml-kit/android-data-disclosure).

Implication: the settings sentence stating there is “no analytics” at `src/app/(tabs)/settings/index.tsx:26` is too broad for the existing dependency. For a strictly FOSS/no-SDK-telemetry requirement, the existing Tesseract stack is a candidate to evaluate for Android image OCR. Replacing ML Kit requires preserving line bounds, text angle, ordering, language behavior and editor coordinate mapping; it should not be silently swapped during an audit.

### iOS Photos: cloud-only originals may download

`modules/file-engine/ios/FileEngineModule.swift:245` sets `PHImageRequestOptions.isNetworkAccessAllowed = true` in `export(asset:to:)`; the video branch does the same at line 256. This allows Photos to retrieve a missing local original. Thumbnail listing is different: `modules/file-engine/ios/RecentImagesView.swift:152` explicitly sets the option to `false`.

The relevant platform property controls access to the network for image requests. [Apple Photos documentation](https://developer.apple.com/documentation/photos/phimagerequestoptions/isnetworkaccessallowed).

Implication: image processing remains local after import, but import itself can use iCloud. A strict local-only policy would need a clear unavailable-local-file outcome; simply toggling the flag can make currently importable files fail. The current audit preserves this behavior and reports it.

### Backups and system providers

`android/app/src/main/AndroidManifest.xml:14` has `android:allowBackup="true"`. No app-owned `fullBackupContent`, `dataExtractionRules`, or explicit backup exclusions were found in application configuration/native source. Saved PDF output uses `Paths.document` in `src/features/files/file-storage.ts:5`, while temporary imports use cache.

Android documents that eligible app data may be included in OS backup when enabled; cache directories are excluded by default. Actual backups depend on the user's OS settings and device. [Android Auto Backup documentation](https://developer.android.com/identity/data/autobackup).

No `isExcludedFromBackup` policy was found in the local iOS modules either. This does not establish what a particular device has backed up. A strict no-cloud-storage policy needs explicit backup design for both platforms and inspection of final application configuration.

`src/features/files/file-storage.ts:14` and `recent-files.ts:82` use the system document picker with cache copying. `modules/file-engine/ios/PdfDeviceLibrary.swift` uses the system folder picker. A chosen provider may download a cloud-backed file before returning it; the existing `docs/09-files-and-image-to-pdf.md` already acknowledges this. `shareFile` invokes the native share sheet, where users choose the destination. These provider/share operations are distinct from an app-owned cloud processing service.

### Permissions, OTA and unused network surfaces

- The generated Android manifest requests `android.permission.INTERNET`. This permission permits network access; it is not proof that the app's PDF processing uploads anything. Removing it without reviewing native dependencies and debug Metro access would change behavior.
- OTA metadata sets `expo.modules.updates.ENABLED` to `false`. A separate `CHECK_ON_LAUNCH=ALWAYS` value does not override the disabled flag. No direct `expo-updates` dependency, update URL, `extra.eas.projectId`, or `eas.json` was found in the inspected project configuration.
- No app-owned `fetch`, Axios, WebSocket, URLSession or HTTP client request was found in the inspected `src` and project-owned native processing sources. This source search cannot prove absence of network calls inside precompiled/transitive SDKs.
- `src/components/external-link.tsx` can open an in-app browser, but no current application use of that component was found. It is an unused network-capable helper, not evidence of a processing endpoint.
- Audio/media helper code and packages remain even though the current product scope excludes audio/video/device modules. Removing dormant code/dependencies needs a usage audit; that cleanup was not performed here.

## Developer setup downloads are separate from runtime processing

| Path | Network behavior during development/build setup | Runtime distinction |
| --- | --- | --- |
| `package.json:49` postinstall | Invokes PDFium and OCR preparation scripts after an install. | Do not run install/postinstall during a strictly offline code audit. |
| `scripts/prepare-pdfium.mjs:25` | Downloads pinned native archives from GitHub when a matching local verification marker is absent; checks each archive SHA-256. | Prepared PDFium libraries are packaged and run locally. |
| `scripts/prepare-pdf-ocr.mjs:11` and line 22 | Downloads a pinned English trained-data file and its license if absent; validates model SHA-256. | Android PDF OCR reads the packaged model from assets. |
| `modules/pdf-engine/PdfEngine.podspec:3` | May invoke PDFium preparation when the local XCFramework is missing. | A CocoaPods operation is not inherently offline even with this local pod. |
| `android/build.gradle`, `modules/pdf-engine/android/build.gradle`, Gradle wrapper and lockfile registry URLs | Dependency resolution can contact Google Maven, Maven Central, JitPack, Gradle distribution hosts and npm. | With existing caches, local static checks/offline builds can avoid dependency downloads. Missing artifacts should be reported, not fetched without authorization. |
| Expo development CLI | Development tooling is separate from the shipped editor. | Use `EXPO_NO_TELEMETRY=1` and existing local binaries for static checks; do not invoke EAS, cloud simulators or remote update commands for this request. |

No EAS operation, package installation, model/binary download, cloud upload, push registration, backup operation, or connected-device command was performed for this audit. Primary documentation pages were read to verify the SDK behavior above; no user document or application data was sent to those sites.

## Follow-up order and verification boundary

1. Resolve the ML Kit telemetry/FOSS mismatch before describing the application as no-analytics or entirely open-source in its processing dependencies. Preserve Android image text editing quality and its result contract during any later migration.
2. Decide and implement a local-only import and OS-backup policy with honest unavailable-file messaging. Preserve the visual design; do not silently remove successful import paths.
3. Assess unused notification/browser/audio dependencies and remove only those proven unnecessary, with native builds to verify autolinking remains intact.
4. Preserve license notices for PDFium, PDFBox, OCR models/codecs, fonts and bundled JavaScript dependencies. The Tesseract notice mentions Leptonica/libjpeg/libpng but is not by itself a complete proof that every required transitive notice reaches the final package. Verify final APK/IPA contents during an authorized release packaging check.

This is a static audit, not runtime certification. It does not certify zero network traffic, zero memory leaks, 60 FPS, OCR accuracy, final APK/IPA license completeness, or iOS build success. Connected-device and automated UI verification remain excluded by the user's instruction.

Validation recorded by the coordinating audit: Expo lint and TypeScript `--noEmit` both passed. Expo lint ran with `EXPO_NO_TELEMETRY=1` and `EXPO_OFFLINE=1`. No native or web build, automated test suite, or device check was run for this audit.

# Native editor source audit

Implementation follow-up (2026-09-29): [completed changes and remaining scope](../31-editor-functionality-implementation.md). The evidence below is the original audit snapshot; use the follow-up documents for remediated paths.

Date: 2026-09-28. Scope: the supplied professional PDF/image editor specification (sections A-BC), evaluated against the current working tree, including the preceding dotted-brush changes.

This is a **code-only audit**, not implementation of the full specification. Application source, dependencies, native configuration and UI were left unchanged during this pass. No connected device, simulator automation, cloud build, processing service, package installation, automated test or web build was used. Only audit documents were added. Existing uncommitted application changes were preserved.

The app has substantial native functionality, but the complete professional-editor specification is not implemented. A catalog entry or successful typecheck does not establish feature completeness, output fidelity, offline privacy or measured performance.

Detailed evidence:

- [PDF capabilities, sections B-U](pdf-capability-audit.md)
- [Image capabilities, sections V-AN](image-capability-audit.md)
- [Dependencies, licensing distinctions and network paths](dependency-and-network-audit.md)

Status meanings: **Implemented** means the relevant code path exists and was traced; **Partial** means some requested behavior is absent; **Missing** means no implementation was found in the inspected scope; **Risk** means a concrete path conflicts with a requirement or can fail. None certifies device behavior.

## 1. Existing architecture assessment

The current architecture should be extended, not replaced:

| Responsibility | Current implementation | Assessment |
| --- | --- | --- |
| Navigation | Expo Router in `src/app/`; separate viewer, PDF tool, image editor, image text and image tool routes. Root stack in `src/app/_layout.tsx:39`. | Suitable. Keep route names and current UI. Tool sessions are process-local, so routes cannot restore an interrupted edit by themselves. |
| UI and editing controls | React Native/React state; shared theme, dialogs, `ToolButton`, `EditorOption`, `ColorSwatches`, `TextStyleControls`, tool rails and platform-native toolbox sheets. | Reusable foundation. There is no need to replace the design system or introduce another sheet library. |
| Native PDF work | Local `PdfEngine`: Android Kotlin/PDFBox/PDFium; iOS Swift/PDFKit/Core Graphics with the same C++ PDFium text/vector editor. | Processing is native. Capability and document-integrity differences remain between operations/platforms. |
| Native image work | Local `FileEngine`: Kotlin bitmap/Canvas processing and Swift Core Image/Core Graphics/ImageIO; native image text recognition and overlays. | Processing is native, but exports currently trade source resolution for fixed memory limits. |
| Edit state/history | Per-screen React state and bounded histories; shared mark history for PDF and image drawing. | No persistent cross-tool command history, image layer graph or crash-recoverable editing session. |
| Library metadata | SQLite recent/edited-file tables; native device PDF index. | Durable file metadata exists. It is not a draft store or processing-job journal. |
| Working copies | PDF sessions copy inputs; image tools share a temporary workspace. | Originals generally remain separate until an explicit save, but workspace handoff and multi-stage save commit have concrete gaps. |
| Previews | Native canvases, bounded thumbnail jobs, one current PDF text render plus one latest waiting request. | Good mechanisms to retain. Source review cannot establish a 60 FPS or zero-leak result. |

Source anchors: `src/features/pdf/pdf-tool-session.ts:10`, `src/features/files/image-workspace.tsx:15`, `src/features/pdf/pdf-preview-queue.ts:9`, `src/features/files/thumbnail-cache.ts:44`, `src/features/files/recent-files.ts:23`, `src/features/files/edited-files.ts:16`.

### Existing resource separation

1. **Original/imported file:** durable imported files in the library; PDF tools receive a separate input copy (`pdf-tool-session.ts:30`).
2. **Working edits:** PDF text commands/marks and image screen parameters in memory. Image workspace intermediates are rendered files in cache (`image-workspace.tsx:16`).
3. **Preview cache:** separate temporary page/image files, thumbnail entries and native bitmaps.
4. **Export:** native output followed by Save/Save As, device publication and edited-file indexing.

The image workspace expires after its last consumer leaves, waits for pending work and retains at most two intermediate files (`image-workspace.tsx:26`, `:48`). This is useful transient ownership, but it deliberately does not provide autosave or crash recovery. Switching tools rasterizes the working image rather than keeping all prior edits adjustable.

## 2. Existing module inventory

The linked PDF and image reports classify every module B-U and V-AN. The remaining cross-editor requirements are below.

### A. Global editing workflow

| Feature | Status | Source finding / gap |
| --- | --- | --- |
| Undo, redo, multi-level history | Partial | Mark history retains 40 changes (`use-mark-history.ts:16`); PDF text retains 30 snapshots (`pdf-text-editor.tsx:313`); image text has bounded history (`image-text-editor.tsx:159`). Basic image adjustments do not have equivalent undo/redo, and history does not span tool routes. |
| Autosave draft, crash recovery | Missing | No persistent draft/command tables or restore path found. `pdf-tool-session.ts:10` and `image-workspace.tsx:53` use in-memory maps. SQLite stores library metadata, not unfinished edits. |
| Save, Save As, named export | Implemented with risk | Shared Save/Save As and name validation exist in `save-file.ts:37`, `:51`, `:92`. Replace can commit the app copy before device publication succeeds; see finding G1. |
| Duplicate | Partial | Edited-file duplication copies a durable file (`edited-files-screen.tsx:98`). General object/layer/stroke duplication is not a shared editing operation. |
| Reset / before-after | Partial | Some individual tools have reset/original comparison. No uniform session-wide restore-original or cross-tool before/after state. |
| Recent documents | Implemented | Durable library metadata in `recent-files.ts:23`; edited outputs in `edited-files.ts:16`. |
| Unsaved warning | Partial | Image editor/text routes and PDF text/markup warn. PDF advanced-tool dirty tracking depends on mark count (`advanced-pdf-tool.tsx:124`); general form settings and organizer changes do not participate in one global dirty model. |
| Background save | Partial | Native worker execution avoids doing heavy work in JS. No durable, OS-managed resumable save scheduler was found. Worker execution does not guarantee completion after process death or background suspension. |
| Progress / cancellation | Partial | Native PDF job registry and advanced image jobs support progress/cancel. Basic image/text work uses different APIs. Cancellation is often cooperative between stages, not an interruption of a running decoder. |
| Error recovery | Partial | Inline errors, retries and failed-output cleanup exist. Recovery from a partially committed save or a killed editing session is not unified. |
| Phones / landscape / tablets | Partial | Safe areas, responsive tool catalogs and landscape rails exist. No full tablet/two-page professional editor design or device validation is established by this audit. |

### AO-BC. Shared requirements and delivery

| Spec | Status | Assessment |
| --- | --- | --- |
| AO History system | Partial | Local histories exist; no shared human-readable command timeline, jump-to-history or persisted cross-tool restore. |
| AP Alignment / smart guides | Missing | No common object snapping, equal-spacing guides or snap haptics implementation found. |
| AQ Transform handles | Partial | Native mark selection supports movement/resizing, and image crop/text placement has controls. Rotation, locking, proportional/free-transform parity and accessible object manipulation are not shared across tools. |
| AR Clipboard | Partial | Android PDF reader copies permitted selected text (`PdfEngineView.kt:526`); native input controls support platform text editing. There is no general annotation/image/layer clipboard protocol. |
| AS UI/UX structure | Partial | Existing categories, quick rails and contextual sheets should be preserved. Do not add enabled placeholder buttons for missing capabilities. Some editor settings still use bounded inline panels rather than a universal sheet. |
| AT Haptics | Missing | No app haptics implementation found for snapping, slider zero, locking, reorder or saving. Native platform feedback alone is not the specified interaction system. |
| AU Accessibility | Partial | Shared controls have labels, selected/disabled states and 44-48 point targets; catalogs adapt to font scale. Canvas object navigation, contrast and complete TalkBack/VoiceOver workflows need additional work and later validation. |
| AV Large files | Partial | Bounded queues/caches, lazy reader pages, native workers and off-screen release exist. Fixed image export downsampling currently sacrifices fidelity. Static inspection cannot prove large-file stability or frame time. |
| AW RN implementation rules | Largely implemented | RN configures native processing using URIs/parameters. Preserve native workers and existing module boundaries; review input copies and path ownership before adding engines. |
| AX PDF integrity | Risk | Text is genuinely edited, but markup uses page vectors; compression/security/organizer behavior has important exceptions described in the PDF report. |
| AY Image integrity | Risk | Fixed-resolution exports, destructive tool handoff and alpha-loss paths conflict with full-resolution/non-destructive requirements; see image report. |
| AZ Feature priority | Partial | Many everyday P0 tools exist, but P0 layers/healing/background removal/scanner/fill-and-sign and several annotation capabilities are missing. P1/P2 are not complete. |
| BA Audit before implementation | Addressed by this report | The audit precedes any new implementation. This pass makes no application or UI changes. |
| BB Tool documentation | Partial | Existing docs cover behavior and limits, but not every tool has the requested properties/gestures/history/persistence/export/edge-case record. Use the template below for future changes. |
| BC Quality expectation | Partial | Shared components and native engines are established. Current coverage does not yet equal a professional document/image editor, especially across history, annotations, layers and fidelity. |

## 3. Feature gap and risk analysis

Read the linked reports for exact native evidence and platform differences. The most consequential findings are:

| Priority | Finding | Consequence |
| --- | --- | --- |
| High | Image workspace outputs use a cache directory that basic native image exporters reject. | Switching tools after basic crop/adjust edits can fail instead of carrying the working copy forward. |
| High | PDFium drawing/watermark/numbering saves and some other PDF transformations remove input encryption. | Password protection is not consistently preserved when editing an authorized encrypted input. Direct text editing instead rejects encrypted inputs; see the per-operation guards in the PDF report. |
| High | PDF organizer paths do not apply the signature checks used by other PDF operations. | Rewriting a signed PDF can invalidate or lose its cryptographic signature without the consistent guard required by the specification. |
| High | Balanced/Smallest PDF compression rebuilds pages from images. | The output can lose editable/selectable content and other document structure. Existing UI disclosure does not satisfy the new explicit-flatten-only requirement. |
| High | Image export decodes at reduced resolution; some PNG/text/resize paths use an opaque background. | Output can lose source pixels and transparency even when users choose a lossless container. |
| High | ML Kit may send SDK metrics, iOS asset resolution permits iCloud downloads, and OS backup is not explicitly excluded. | Strict no-cloud/no-telemetry behavior cannot be claimed for the whole app from the current configuration. This is separate from native local document processing. |
| Medium | PDF drawings/highlights are page-content vectors rather than persistent editable PDF annotations. | They remain vector content, but do not provide annotation-list editing, comments or text-associated markup after reopening. |
| Medium | No recoverable draft or common cross-tool history. | Leaving/killing the app loses unfinished editing state; prior image tool settings are baked into working pixels. |
| Medium | G1: shared Save commits the app copy before device copy/indexing. | A later failure can leave an updated library file and stale device output or metadata while the UI reports a save failure. |

### G1: multi-stage Save is not a single recoverable commit

`src/features/files/save-file.ts:104` moves the output over the owned library origin. Device publication follows at line 109, followed by metadata registration at line 112. There is no enclosing rollback or durable transaction journal spanning filesystem, device storage and SQLite. If device access fails or the process stops between these steps, the previous app copy has already been replaced. This is a source-confirmed ordering risk, not a failure reproduced on a device.

Keep the existing Save/Save As UI. A future fix should stage and validate output, journal publication, retain a recoverable previous version until commit, then update library/device references with a defined retry policy. Filesystem and platform-provider operations cannot be made atomic merely by wrapping SQLite updates in a transaction.

## 4. Recommended component architecture

Retain the current screens and controls. Add shared behavior underneath them in small compatible steps:

1. **Editor session adapter:** stable session identity, immutable source reference, current command list, revision, dirty state and native capability flags. Existing PDF text/mark and image controls dispatch into the adapter.
2. **Command history:** typed operations with before/after values or reversible deltas; coalesce slider drags and text-entry bursts; enforce memory/point budgets. Do not store full-resolution bitmap snapshots for each adjustment.
3. **Local draft repository:** app-private durable SQLite journal and referenced local assets. Cache eviction must never delete the active original or recoverable draft assets.
4. **Native processing adapters:** continue using `PdfEngine` and `FileEngine`; pass local URIs and bounded structured payloads. Share validation, capability reporting and document permission checks rather than duplicating an engine.
5. **Preview coordinator:** reuse the current one-running/one-latest queue and generation cancellation. Render a reduced preview while retaining original geometry/resolution for export.
6. **Export coordinator:** explicit output semantics, staged native file, structural validation, recoverable publication and user-controlled replacement. Preserve PDF encryption/annotations and image alpha unless the chosen operation explicitly changes them.
7. **Optional advanced layers/annotations:** extend the data representation before enabling UI controls. Reuse the toolbox categories, styles, color picker and transform language already present.

Do not add a new navigation framework, paid SDK, remote rendering service or replacement dashboard to deliver these changes.

## 5. Proposed state/data model

This is a design proposal, not code added to the app:

```ts
type EditorSession = {
  schemaVersion: number;
  id: string;
  kind: 'pdf' | 'image';
  source: { uri: string; fingerprint: string };
  revision: number;
  savedRevision: number;
  commands: EditCommand[];
  historyCursor: number;
  assetIds: string[];
  viewState: { page?: number; zoom: number; x: number; y: number };
};

type EditCommand = {
  id: string;
  label: string;
  operation: string;
  targetId?: string;
  before?: unknown;
  after: unknown;
};
```

Replace the illustrative `unknown` payloads with a versioned discriminated union per native operation before implementation. Use stable page/object/annotation/layer identities; PDF object indices alone are not persistent identifiers across arbitrary rewrites. Validate fingerprints before restoring commands to a changed source.

Keep native page handles, decoded bitmaps and passwords out of serialized command history. Keep draft state separate from preview files and exported outputs. Store only the local asset references needed to reconstruct a session, with bounded retention and explicit deletion. Dirty state follows revision changes, including object edits and settings that affect output, not only mark count.

## 6. Required native capabilities

| Area | Existing base to reuse | Required extension |
| --- | --- | --- |
| PDF annotations | PDFium/PDFKit and current native markup canvases | Read/write actual annotation objects, stable IDs, ink/quads/free-text/comments, selection/edit/delete and round-trip fidelity. |
| PDF text/objects | Existing C++ content editor | Preserve security, consistent signature/permission gates, richer text layout and native image-object extraction/transforms. |
| Secure redaction | Native document engines | Remove intersecting content and hidden data, not just cover pixels or add rectangles; block release until supported cases are validated. |
| OCR/searchable PDFs | Bundled Android Tesseract and iOS Vision | Coordinate-aware invisible text layer, language support and output validation. Image OCR currently uses a separate Google SDK on Android. |
| Forms/scanning/signing | Existing PDF reader and platform camera/document APIs | Actual form-field model; offline capture/correction workflow; reusable visual signatures clearly separated from certificate signing. |
| Image fidelity/history | FileEngine filters/transforms and current workspace | Native tiled/region processing where feasible; replay operations from source, retain alpha, durable layer/mask model and shared history. |
| Stylus/brush/selection | Existing native touch drawing | Pressure/tool-type support, palm handling where available, eraser/lasso, opacity/smoothing and editable selected properties. |
| Jobs and save | Current worker registries and save helpers | Shared bounded lifecycle, staged validation, resumable local state and recovery from interrupted publication. |

These capabilities are gaps, not promises that the currently bundled engine implements every necessary API. Reuse the current free native engines first and verify capabilities in their actual version before selecting any additional library.

## 7. Dependency and offline assessment

No commercial PDF editing SDK, paid processing API, billing SDK or app document-upload service was identified in the inspected first-party processing paths. This is not a complete legal certification of every transitive dependency or vendored binary.

The app is not accurately described as using only open-source SDKs: Android image OCR uses Google's free proprietary ML Kit SDK, and iOS uses Apple platform frameworks. ML Kit's official documentation describes SDK metric transmission. iOS code explicitly permits network retrieval of photo/video assets. OS document providers, user-initiated sharing and device backup are additional boundaries outside local PDF/image processing.

Build-time dependency/model downloads are distinct from runtime cloud processing. Existing preparation scripts fetch native binaries and OCR data; this audit did not run them. Expo cloud builds and remote simulators were not used. See the [dependency report](dependency-and-network-audit.md) for versions, license evidence, official sources, unused cloud-capable packages and configuration findings.

Under the user's preservation constraint, these findings are reported rather than silently removing SDKs, disabling iCloud imports or changing backup behavior.

## 8. Implementation priority

| Order | Scope | Acceptance condition |
| --- | --- | --- |
| 1 | Correct existing path/alpha/save/security defects | Existing routes and controls retain their behavior; generated files meet the selected format/security contract; no new tool buttons needed. |
| 2 | Resolve strict offline dependency/privacy exceptions | No paid/cloud processing dependency; explicitly selected policy for proprietary SDK telemetry, cloud-backed imports and backup. Existing flows need compatible local alternatives before removal. |
| 3 | Durable session/history foundation | Recover unfinished edits locally, preserve source, undo across tools, retain current UI. |
| 4 | Finish P0 PDF annotation/draw/OCR/scanner/forms basics | Real supported native operations with persistence and export; disabled unsupported actions stay honest. |
| 5 | Finish P0 image fidelity/layers/retouch/background capabilities | Non-destructive state through export, full-resolution strategy, correct alpha and truthful tool names. |
| 6 | P1 professional tools | Add verified native object editing/redaction/curves/HSL/masks/selection/clone capabilities using the shared model. |
| 7 | Optional P2 | On-device only, free compatible dependencies/models, explicit resource budgets. No cloud AI or remote fallback. |

The list is a proposed sequence; this audit does not implement or enable missing features.

## 9. Files/components requiring future modification

| Concern | Existing locations to extend |
| --- | --- |
| Workspace destination/fidelity | `src/features/files/image-workspace.tsx`, `image-editor.tsx`; native `ImageProcessing.kt`, `ImageEditing.swift`, `ImageTools.kt/.swift`, `ImageText.kt/.swift` |
| Shared save commit | `src/features/files/save-file.ts`, `edited-files.ts`, `recent-files.ts`; native `DeviceSaver.kt/.swift` |
| Session/history/drafts | `src/features/pdf/pdf-tool-session.ts`, `use-mark-history.ts`, `pdf-text-editor.tsx`, image workspace/text/basic/advanced editors; extend local database schema with migrations |
| PDF security and annotation fidelity | `modules/pdf-engine/cpp/TextEditor.cpp`, `PdfOrganizer.kt/.swift`, `PdfAdvancedTools.kt/.swift`, `PdfMarkupView.kt/.swift`, module TS contracts |
| Native capabilities/availability | `PdfEngineModule.kt/.swift/.ts`, `FileEngineModule.kt/.swift/.ts`, `src/constants/pdf-methods.ts`, `image-methods.ts` and tool registries |
| Offline/privacy policy | Native asset resolution, OCR adapter/dependencies, app config/config plugins and privacy descriptions; do not hand-edit generated projects as a durable fix |
| Reusable controls | Keep `src/components/toolbox-*`, `tool-rail.tsx`, `color-swatches.tsx`, `text-style-controls.tsx`, `editor-option.tsx` and existing theme; only extend when a working native capability needs a control |

## 10. Verification strategy and results

Performed in this pass:

- Reviewed TypeScript/React Native, Kotlin, Swift, shared C++, module build configuration, dependency manifests and existing product/architecture docs.
- Ran local Expo lint with `EXPO_NO_TELEMETRY=1` and `EXPO_OFFLINE=1`: **passed**.
- Ran local TypeScript `tsc --noEmit`: **passed**.
- No runtime application code or UI edits; no connected-device commands or automation.

Native compilation was not rerun for this documentation-only audit. Earlier native build results do not establish the requested features or runtime correctness. Swift/iOS compilation, PDF round-trip fidelity, touch behavior, performance and actual network traffic remain unverified in this pass.

For future authorized implementation, use local lint/typecheck and applicable local Kotlin/C++/Swift compilation first. Record a source-level matrix for encrypted/signed/cropped/rotated PDFs, annotation round trips, alpha images, large originals, tool handoffs, cancellation and partial saves. Unit/integration/UI cases may be designed in documentation; **do not run automated tests, web builds, device automation, cloud builds or network processing under the current authorization**. Any later interactive/device validation needs a separately changed user instruction.

### Tool record required for future changes

For each tool, document: name and purpose; existing icon/location/settings; exact supported properties; gestures; data representation and native API; history behavior; draft persistence; export semantics; unsupported cases; cancellation/memory limits; source/build checks actually run; and behavioral checks still unverified. Do not mark a tool complete because its button or preview exists.

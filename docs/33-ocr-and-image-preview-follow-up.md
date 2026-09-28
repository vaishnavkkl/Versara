# OCR and image preview follow-up

2026-09-29. This extends the existing editors and tool routes from the professional-editor specification. It does not replace the current interface or claim completion of the entire specification.

## OCR screen crash

The final action in `advanced-pdf-tool.tsx` contained inline whitespace between `PdfPreviewFooter` and its button. JSX preserves that same-line whitespace as a string, which React Native cannot render inside the footer's `View`. The footer now uses ordinary multiline JSX. A local ESLint rule also checks raw text and literal spaces in known native layout containers, including the shared PDF preview containers.

## Searchable OCR PDFs

Scan Text (OCR) keeps its existing text-file output and adds a Searchable PDF option. It uses bundled English Tesseract data on Android and on-device Vision recognition on iOS. No document or recognized text is sent to a server. Existing page-range selection, progress, cancellation, naming, saving and opening workflows remain in use. Older native binaries disable the new output option until rebuilt.

Recognition renders one bounded page bitmap at a time: at most 1.5 million pixels on lower-memory devices or 3 million otherwise, with a 4096-pixel longest edge. Searchable output accepts up to 100 selected pages, 2000 words per page and 20,000 words per operation. Existing selectable text is skipped by default; the user can turn this off for mixed scanned/text pages, with a duplicate-text warning.

The shared PDFium engine adds invisible text objects to the original page structure using normalized recognition bounds and rotation-aware PDF coordinate transforms. The existing visible page content is retained; exporting a searchable PDF does not flatten the document into page images. Word extraction is checked before saving. Newly added objects are tagged for saved-file verification, which checks exact text, invisible rendering, word counts and positions. Unsupported characters or a failed verification produce an error with text-file export guidance and discard the staged output. This English output uses standard PDF fonts; it is not a multilingual OCR implementation.

Signature and permission preflight remains enforced. The saved PDF is reopened and its page count, encryption handler and permissions are compared with the source. Temporary files are removed on cancellation or failure. These safeguards are source and build checked; they do not establish runtime OCR accuracy or certify fidelity for every PDF.

## Image slider and navigation work

- Basic adjustment sliders avoid reconciling every sibling native slider Host on each sample. Values enter edit history immediately. Android coalesces color-matrix updates to drawn frames. iOS displays completed frames from the current source while processing the latest pending value, instead of discarding every completed frame during a continuous drag.
- Advanced image previews allow one running operation and one replaceable pending snapshot. Source, comparison, screen and export changes invalidate old frames. The preview cache remains bounded and export uses the native full-resolution path.
- Image-list navigation postpones image decoding and texture creation until the screen transition finishes, pauses list thumbnails, reuses available metadata, and first decodes a display-sized preview. Higher detail loads after zoom settles. Native decode work is deduplicated and bounded. See [image navigation](32-image-preview-navigation.md).
- New native color tools and their mathematical, history and export limits are described in [advanced color controls](32-native-tone-curves-hsl.md).

## Validation boundary

Final checks passed: Expo lint, TypeScript, diff whitespace checks, offline Android `:pdf-engine:compileDebugKotlin`, `:file-engine:compileDebugKotlin`, `:pdf-engine:buildCMakeDebug[arm64-v8a]`, and an Android-only production JavaScript/Hermes bytecode export. The first bytecode attempt was denied by the Windows sandbox; rerunning with access to the installed local Hermes compiler succeeded. Native compilation retains existing dependency deprecation warnings.

No connected device, emulator, device automation, automated test, web build or cloud service was used. iOS source is reviewed on Windows and has not been compiled here. Native changes require rebuilding the application. Actual frame timing, OCR accuracy, selection alignment and exported-image appearance remain unmeasured without runtime verification.

Remaining major specification work includes PDF forms, comments and semantic annotation editing, content redaction, scanner capture, full PDF object/image editing, advanced reader modes and navigation, multilingual OCR, image layers/masks/selections, selective adjustments, healing/clone and segmentation. The new tools are not substitutes for those workflows.

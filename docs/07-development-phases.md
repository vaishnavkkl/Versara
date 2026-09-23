# Development Phases & Priority

The product should be built incrementally focusing on reliability and speed over feature count.

## Phase 1: Foundation (V1 Priority)
- Expo project, TypeScript, Expo Router, theme system.
- Tool registry, file abstraction, job system, local SQLite.
- **Goal:** Deliver a runnable shell with a small vertical slice (Image Picker → Image Compress → Progress → Result → Save/Share).

## Phase 2: Image Utilities (V1 Priority)
- Image picker, compression, resize, format conversion, JPG → PDF, metadata removal.

## Phase 3: PDF Core (V1 Priority)
- Viewer, merge, split, extract, reorder, rotate, compress, print/share. (Exclude DOCX → PDF).

## Phase 4: Screenshot Privacy (V1 Priority)
- OCR, entity detection, confidence scoring, review UI, permanent image redaction.

## Phase 5: Video (V1 Priority)
- Video target size compression, trim, resolution conversion.

## Phase 6: Network (V1 Priority)
- Wi-Fi info, ping, DNS, latency, packet loss, Internet speed, diagnosis UI.

## Phase 7: Battery (V1 Priority)
- Charging state, session rate, drain test. (Adhere to public API parity across iOS/Android).

## Phase 8: Local AI (Post-V1)
- Model manager, context builder, PDF/network/battery/screenshot explanations. (Only begin after deterministic utilities are stable).

## Signature Workflows
Eventually build workflows combining multiple tools:
- *Make this shareable:* Compress → Remove metadata → Redact → Share.
- *Prepare this PDF:* Merge → Reorder → Compress → Sign → Print.
- *Fix this upload:* OCR requirements → Resize/Compress/Convert → Export.

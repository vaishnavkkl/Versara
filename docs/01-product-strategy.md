# Product Strategy & Principles

## Product Goal
Build a production-quality cross-platform mobile utility application for **iOS and Android** using React Native, Expo, and Native Modules.
The application must be fundamentally **utility-first**, working entirely on-device without requiring internet for core file processing.

- No required login, account, or cloud storage.
- No generic AI-chatbot-first UX.
- AI is an optional supporting capability, not the core reason for the app.

## Product Positioning
**Offline mobile toolbox for PDFs, images and screenshot privacy.**

- Primary value proposition: Complete everyday document and image tasks directly on the phone.
- Secondary value proposition: Private/on-device processing for sensitive files.
- AI value proposition: Ask the local AI to explain a result or document.

## Important Product Principle
Every tool must follow:
**Input → Configure → Process locally → Preview → Save/Share**

- Optimize for minimum number of taps.
- Hide technical complexities (e.g., show "Target size: 25 MB" instead of bitrate/codec settings) while offering Advanced modes separately.
- Core tools must work completely offline.

## Differentiation Strategy
Differentiate through:
1. Offline by default
2. No account
3. Files stay on device
4. Extremely simple workflows
5. Batch processing
6. Exact target-size controls
7. Privacy/redaction
8. Clear previews before saving
9. Optional local AI
10. Consistent UX across every tool

## Scope decision - September 2026
Audio, Video and Device (including network and battery diagnostics) will be developed as separate modules outside this app's current delivery plan. Do not list them on the dashboard, in search, or in the tool catalog. Versara currently focuses on PDF, Image and Privacy. Existing general file-browser compatibility does not imply an editing module is available.

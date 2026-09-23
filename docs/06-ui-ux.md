# UI, UX, and Feature Delivery

## UI & Visual Design
- **Visual Direction:** Clean, fast, utility-focused, modern, large tap targets, clear progress, excellent dark mode.
- Avoid cluttered "100 tools on one screen" dashboard looks.
- The user should understand the app within five seconds.

## Tool Registry & Search
- Implement a local tool registry to avoid hardcoded navigation. 
- Implement local search mapping terms to capabilities (e.g., "wifi slow" -> Internet/Wi-Fi Diagnostic, "join pdf" -> Merge PDF).
- Every utility ends with a consistent result screen (Open, Share, Save to Files, Run Again, Delete Output).

## Feature Delivery (Definition of Done)
A feature is complete only when:
1. UI exists.
2. Native implementation exists.
3. iOS and Android implementations work.
4. Offline behavior works where promised.
5. Permission behavior is correct (asked just-in-time, no broad startup permissions).
6. Large files tested.
7. Errors handled.
8. Cancellation works.
9. Temp files cleaned up.
10. Output saved/shared.
11. Automated tests exist.
12. Accessibility labels and Dark mode work.
13. No unnecessary network requests.
14. AI is not required for deterministic functionality.

## Search/ASO Architecture
Store metadata should target real user intents (PDF editor, WiFi test, photo compressor) rather than keyword stuffing the brand name. Balance popular competitive terms against specific ones.

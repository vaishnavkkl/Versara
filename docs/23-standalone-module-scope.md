# Separate Audio, Video and Device modules

These are independent future modules, excluded from the current Versara app plan. The app dashboard, search catalog, tool picker and introductory copy expose PDF, Image and Privacy only. Legacy module links return Home. General file browsing and opening existing file types remain compatible.

Audio editing/conversion, video editing/compression, and device/network/battery diagnostics should have independent requirements, lifecycle management and release decisions. Do not add them back to this app as placeholders. No delivery date is implied.

The earlier ideas below are reference material for those separate projects, not commitments for this app.

## Audio
Trim and convert audio, adjust volume, and extract soundtracks; define native/offline capabilities separately.

## Video Utilities
- **Compression:** User selects target size (10MB, 25MB, 50MB, custom) or presets (WhatsApp, Email, High quality).
- **Information:** Show original size, duration, resolution, frame rate, estimated output, codec.
- **Additional Tools:** Trim, crop, resolution conversion, frame-rate conversion, extract frame, mute audio. (Video editor features are limited in V1).

## Network / Internet Tool Suite
Must distinguish between "Wi-Fi connection" and "Internet connection". Use lightweight endpoints and disclose network usage. Do NOT falsely claim internet diagnostics work offline.

- **Wi-Fi Info:** SSID, local IP, gateway, DNS, signal info (where OS permitted).
- **Internet Diagnostics:** Reachability, DNS lookup, latency, jitter, packet loss, HTTPS connectivity, upload/download speed.
- **Diagnosis Output:** Provide plain language explanations (e.g., "Your download speed is good, but the connection is unstable").
- **Modes:** Basic vs. Detailed.

## Device / Battery Tools
- **Charging Test:** Capture starting level, elapsed time, ending level, and estimate % per hour. Distinguish between Android's BatteryManager telemetry and iOS's public APIs (do not invent missing values).
- **Battery Drain Test:** Record battery level over time while app is used. Note platform limitations regarding per-app drain attribution.
- **Device Info:** OS version, model, CPU, RAM, storage, screen dimensions.

# Privacy, Network & Device Tools

## Screenshot Privacy / Redaction
A distinctive feature for the app. The redaction must be permanent (flattened image), not just a visual mask.

**Pipeline:**
Image → OCR → Entity Detection → Sensitivity Classification → Confidence Score → User Review → Permanent Redaction → Export/Share.

**Categories:**
- Personal (Name, Phone, Email, Address)
- Financial (Card, Bank/Account numbers)
- Identity (Gov ID, Passports)
- Authentication (OTP, Passwords, API keys)
- Location (Address, GPS, Coordinates)
- Other (QR codes, Usernames)

**Privacy Metadata Removal:**
Remove EXIF data (GPS, camera info, timestamp) and offer a privacy preview before export.

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

# Privacy Tools

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

## Separate modules
Network and battery/device diagnostics move to a separate Device module. They are outside this app's current UI and release plan. See [separate module scope](23-standalone-module-scope.md).

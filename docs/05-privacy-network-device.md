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

## Implemented workflow

Privacy is available on Home and in Search, including recently used tools:
- **Privacy Review:** choose an image, scan locally, review possible text matches and select which lines to cover.
- **Redact Image:** select an image and open the existing image redaction tool.
- **Remove Image Metadata:** select an image and open the existing image metadata tool.
- **Redact PDF:** select a recent PDF, scan each page with the same offline image privacy detector, review suggestions or draw covers, then preview and save a new image-based PDF. Only selected regions are blacked out. Text selection, links and forms are removed from the copy; originals stay unchanged.
- **Remove PDF Text:** select a PDF and open the existing text-removal editor. This is explicitly labeled as text removal, not secure redaction.

Privacy Review preserves the original. Its export uses an upright, opaque raster with selected regions permanently replaced by black pixels. Transparent areas become white. The app previews the generated PNG before a named Save copy; saved copies appear in Edited files, with separate Save to device and Share actions. File selection reuses the recent libraries, including their normal retained imports. OCR results and cover history remain session-only and are not written to editor drafts.

Text scanning uses the existing bundled English Tesseract model on Android and Apple Vision on iOS. Native rules find possible email addresses, phones, payment cards (Luhn check), context-labeled bank/identity details, credentials, one-time codes, names, street addresses, coordinates and usernames. Scores describe heuristic rule matches, not recognition certainty or proof that an image is safe. Matches cover an entire recognized line with padding. Version 1 has no automatic face or QR detection, and does not reliably identify unlabeled names, arbitrary identities or non-English text; manual review and covers handle these cases.

Scan jobs are bounded to one running and one queued job, with at most 400 OCR lines and 200 returned findings. The UI explains truncation and allows up to 300 covers. Backgrounding cancels scanning and preview preparation; leaving cancels jobs, releases canvases and clears session files after pending work settles. Full-size exports respect the existing native memory budget and fail explicitly instead of silently shrinking the image.

The native privacy encoder accepts only rectangles and PNG output. It overwrites pixels, strips nonessential PNG chunks, reopens the output and verifies selected regions are opaque black before committing. No paid dependency, remote processing, model download or new SDK is introduced. A new native app build is required; older binaries show a build-availability message. See [implementation and verification](34-privacy-module-and-toolbars.md).

## File selection

Privacy shortcuts and Search use the same editor navigation. Older redact/metadata privacy routes redirect to the existing image tools. Image shortcuts use the normal image library/workspace and its save workflow; Privacy Review alone owns a separate scanning session.

Every Privacy entry opens the recent Images or PDFs screen first, with search and grid/list layout. Selecting a file opens the chosen tool directly. Remove controls are hidden during selection, and Back returns to Privacy. The Open button remains available for other files.

When Android reports All files access, optional image/PDF imports use the existing custom explorer in selection mode. Folders remain navigable, files are filtered by type, and multi-file operations enforce their selection limit. Cancel returns no selection. The system picker remains available as a fallback; iOS uses its system Files picker because photo permission is not device-wide file access. Imports copy user files into app-owned storage and never move or delete originals. Single-image tools now request a single selection.

## Separate modules
Network and battery/device diagnostics move to a separate Device module. They are outside this app's current UI and release plan. See [separate module scope](23-standalone-module-scope.md).

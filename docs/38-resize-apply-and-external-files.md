# Resize, Apply, and external files

## Resize keyboard

Resize controls inside an option sheet use `BottomSheetTextInput`, allowing the
sheet's existing interactive keyboard behavior and Android resize mode to keep
fields visible. Form sheets skip the geometry check that closes option sheets
when an input behind them gains focus. Width, height, and percentage controls
include a Hide keyboard action for numeric keyboards. Landscape controls remain
inside the screen's keyboard avoiding view.

## Applying image adjustments

Basic image export uses a 12-byte-per-pixel working allowance for sequential
bitmap transforms instead of the advanced tools' 20-byte allowance. Existing
device memory limits, output pixel limits, and full-resolution checks remain.
The editor releases its preview while exporting and preserves the crop for
remounts after errors or cancelled saves. Repeated Apply taps are ignored during
an active operation.

The exact reported Apply error was not supplied. These changes address the
identified export memory and repeated-tap failure paths; confirmation of the
reported Saturation failure requires the user's device and error message.

## Open with Versara

Android already declares PDF and image VIEW intents in `app.json`. The generated
Android manifest in the current local project does not contain those filters;
regenerate native configuration before building. iOS now declares PDF and image
document types. The existing Expo Router native intent redirects incoming
`content://` and `file://` URLs to import, then the matching viewer.

Android imports resolve provider MIME types with `ContentResolver.getType` and
fall back to the source filename. iOS imports resolve the source content type
and extension before copying to the extensionless staging file.

These configuration and native engine changes require a rebuilt installed app;
JavaScript reload or an OTA update alone cannot enable them. For the existing
local Android project, run `npx expo prebuild --platform android --no-install`
before the usual development build. EAS builds using Continuous Native
Generation apply `app.json` during prebuild.

## Verification

Only lint and TypeScript checks are run for this change. Automated tests, web
builds, and native builds are omitted at the user's request. The user will
manually check keyboard positioning, Apply, refreshed thumbnails, and opening
PDFs/images from another app, both with Versara closed and already running.

# PDF tool options layout

Repair, Compress, Duplicate, Insert, Export Images, Remove Metadata, and Flatten
previously opened a settings dock that could take 44% of the portrait height.
These tools now use the same Options bottom sheet as the PDF editor. Options
start closed, leaving the source preview the remaining screen space. Protect
still opens its required password sheet.

Compression quality presets and Estimate size are compact bottom controls.
The estimate summary appears above Compress PDF; a valid estimate for the
selected quality remains required. Compression guidance and detailed estimate
information live in the sheet. Export Images has JPG/PNG choices at the bottom,
with quality and page ranges in the sheet.

Existing page navigation, native preview gestures, fixed action placement, and
the landscape side actions remain. Options buttons use the editor's responsive
toolbar placement and are disabled while processing. Sheet fields use the
existing keyboard-aware input and form-sheet handling.

This is a JavaScript layout change and requires an app reload. Verification is
limited to lint, TypeScript, and source review. No automated tests, web/native
builds, or device interaction are run; the user will verify the layouts manually.

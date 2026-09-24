# Native PDF dependencies

Android merge and split use [PDFBox-Android](https://github.com/TomRoush/PdfBox-Android), version 2.0.27.0, an Android port of Apache PDFBox maintained by Tom Roush and contributors.

The upstream license and attribution text are bundled in Android assets under `licenses/pdfbox/LICENSE.txt` and `licenses/pdfbox/NOTICE.txt`. These files include Apache PDFBox's additional resource licenses and attributions.

iOS uses Apple's system PDFKit, ImageIO, and Core Graphics frameworks.

## Native text editor (Android and iOS)

- PDFium, Chromium revision 8066: BSD-style license and upstream third-party licenses. Source: https://pdfium.googlesource.com/pdfium/
- Precompiled binaries: https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium/8066 (distribution tooling under MIT). All seven mobile archives are pinned by SHA-256 in `scripts/prepare-pdfium.mjs`. V8 and XFA are disabled.
- nlohmann/json 3.12.0: MIT. Vendored source: https://github.com/nlohmann/json/tree/v3.12.0; license in `cpp/third_party/JSON-LICENSE`.
- stb_image_write, commit f0569113c93ad095470c54bf34a17b36646bbbb5: MIT option selected. Source: https://github.com/nothings/stb/tree/f0569113c93ad095470c54bf34a17b36646bbbb5; license in `cpp/third_party/STB-LICENSE`.

Upstream binary and dependency licenses are bundled in Android assets under `licenses/pdfium` and the iOS `PdfEngineLicenses` resource bundle. The shared editing implementation is project-owned source in `cpp/TextEditor.cpp`; no commercial SDK, license key, account, or service is required.

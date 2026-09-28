# PDF reader stuck on loading

The advanced-tools change placed `PdfMarkupView` before `PdfEngineView` in both native module definitions. Expo SDK 57 assigns the first declared view as the module's default. The reader's JavaScript wrapper still requested `requireNativeView('PdfEngine')`, so it mounted the markup canvas, which accepts neither the PDF URI prop nor the reader's load/error callbacks. The loading indicator therefore never completed.

The wrapper now explicitly requests `requireNativeView('PdfEngine', 'PdfEngineView')`. Both native definitions also place the reader first again, retaining the original default for older JavaScript bundles. Named annotation and text-editor views are unchanged.

The explicit-name fix works with the native build containing the advanced tools, as well as earlier SDK 57 builds of the reader: the named reader is already registered in both. Reload the JavaScript bundle; no native rebuild is needed for this reader fix. Restoring the default registration also takes effect in subsequent native builds.

Verification: inspect the installed Expo Modules Android/iOS default-view registration logic, run Expo lint and TypeScript, and compile the Android native module. No automated tests or web builds. Device opening/navigation and iOS native compilation are not verified by these static checks.

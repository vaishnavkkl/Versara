# Startup, PDF image placement and batch previews

The native splash now shows the existing Versara logo in both appearances instead of a transparent blank image. Root layout hides it after appearance hydration and first layout, with a short native fade. The separate React splash and its forced two-second hold are no longer mounted. Save recovery starts after the splash handoff. These native splash asset/configuration changes require a new app binary; a Metro reload cannot change the installed launch screen. Check cold launches using a release build on both platforms.

Add Image is listed under PDF Edit & annotate and uses the existing offline native image normalization and PDFium image embedding pipeline. Choose an image, move it and resize it on the current page; page controls support placing images on other pages. Ordinary photos retain their backgrounds and skip the signature paper-removal pass. Existing draft asset budgets, limits and native capability checks remain in effect. The image is embedded into page content when saved without rasterizing existing PDF content.

Batch image tools track the selected input and render its native preview through the existing latest-request queue. Swiping at fit scale changes images; Previous/Next controls and a filename/count provide accessible alternatives. Pinch zoom and Fit are supported. Only one preview is decoded, inactive previews unmount, generated frames remain capped at three, and exports run sequentially. Source identity prevents an old image preview from appearing under the next image's filename.

Single-image export tools now ask Save / Save as new once and carry that choice through publication retries. Rename keeps its filename prompt and creates the named copy. Batch exports keep a single shared filename prompt and save all outputs as new files. Completed outputs show their destination and no second save action. No Save to device button remains in source.

Validation: lint and TypeScript checks are required. No automated tests or web builds. Cold-start timing, gesture behavior and frame times still need manual release-build device verification.

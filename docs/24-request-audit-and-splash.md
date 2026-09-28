# Editor request audit and splash refresh

This is a source audit of the previous editor request. Implementation exists for the items below; device behavior and performance are not certified by source inspection or static checks.

| Request | Implementation and limits |
| --- | --- |
| Keep text input visible with the keyboard | `pdf-text-editor.tsx` places the compact existing-text field above the keyboard, collapses formatting while typing, and hides the footer while the keyboard is open. Add Text uses the native on-page field. |
| Keyboard check/Done instead of Enter | Existing-text input uses `returnKeyType="done"` and `blurAndSubmit`. The native PDF field uses Android IME Done and iOS Done; submitting applies the text. The precise keyboard glyph depends on the device keyboard. |
| Add Text zoom and document style | Placement supplies focus bounds to the native canvas. Initial size, color, weight and font family come from nearby text. New objects use the closest standard PDF font, so arbitrary embedded document fonts are not reproduced exactly. |
| Highlight brush and thickness | Area/Brush modes, adjustable width, preset colors and a custom color picker are wired to native annotation canvases. |
| Undo/redo and consistent highlight controls | Mark history supports undo/redo across pages. Page controls are above the canvas; Undo, Redo and Save stay in a fixed footer, with a collapsible style panel. Preview supports zoom, pan and Fit. |
| Long-press selection and copy | Android requests native PDFium character bounds, offers selection handles and Copy/Select all. iOS uses PDFKit selection. Copy restrictions apply; scans require OCR and Android selection is capped at 20,000 characters per page. |
| Common PDF tools first | `PDF_QUICK_IDS` puts Edit PDF, Scan Text, Remove Text and Add Text first in the PDF tool catalog. |
| Page-number preview and styling | Preview and save share native numbering commands. Controls include page range, starting number, format/prefix, six positions, margin, font, bold/italic/underline, size and color. |
| More shapes, icons, separate fill/border | Ten shape icons, border width/color, independent fill color including None, and custom colors. Ellipses use a 64-segment outline. |
| Easier toolbox and tool listing | Four quick tools plus Tools; the sheet has search and a two-column grid. Fixed the missing portrait `flexDirection: 'row'` that stacked quick actions vertically. Landscape retains its side rail. |
| Separate Audio, Video and Device | Removed from the current dashboard/search/tool catalog; legacy module routes redirect Home. Product/architecture/phase docs point to the separate-module scope. General file browsing compatibility remains. |
| Release editor memory and stop idle processing | Active-screen gates unmount native canvases, preview queues are bounded, disposal clears image/document resources and callbacks, and pending jobs are canceled where supported. Preview cleanup timers stop while inactive or saved. A running non-cancelable native operation can finish before releasing its resources; there is no repeated save verification loop. |

Related implementation notes: [Editor controls and lifetime](22-editor-controls-and-lifetime.md), [Separate module scope](23-standalone-module-scope.md).

## Splash

`animated-splash.tsx` now displays a blue image card and a folded PDF card. The old video/audio artwork and repeating meter animations are removed. Typography changes from individually animated extra-bold letters to a single semibold Sora wordmark with tighter spacing and a lighter subtitle. Updated 2026-09-27: the image card, PDF card and wordmark make a subtly staggered entrance using opacity, 4-8 px translation and 0.98-to-1 scale. The splash holds for two seconds before a 200 ms exit fade; tapping cannot shorten it. Reduced motion shows static artwork for the same two seconds. Timers and animations are canceled on unmount, with a bounded fallback if completion is interrupted. Native splash configuration still supplies the matching blank background before the React view is ready.

## Validation boundaries

- Static checks passed: Expo lint (no warnings), TypeScript `--noEmit`, and whitespace validation.
- Prior Android native compilation results are recorded in the editor-lifetime notes; this refresh does not change native sources.
- A new native development build is required for the earlier editor features. iOS compilation, actual keyboard/selection/annotation alignment, large files, and repeated editor-to-Home memory/frame measurements remain device validation work.
- No automated tests or web builds are run, per project instructions. Passing static checks does not establish that all interactions work on a device or that navigation has no frame drops.

## Splash visibility sequencing follow-up

The React splash now waits for the root view layout and native splash hide call before starting its entrance or two-second timer. Native fading is disabled so it does not conceal the React entrance. The cards use a small staggered rise, rotation and scale, followed by the wordmark; reduced motion retains static artwork. Fast Refresh does not replay a completed root splash: verify with a full cold launch. An installed binary with old native splash artwork must be rebuilt to pick up app.json assets; development builds do not reproduce every release splash property.

## Splash flourish follow-up

The two-second introduction adds a single soft expanding ring, a small rotating sparkle, a scanning light across the PDF card and a subtle coordinated card lift. These use UI-thread opacity/transform animations, finish before the exit fade, and do not loop or extend the hold. Reduced motion suppresses the decorations. All shared-value animations and timers are canceled on teardown.

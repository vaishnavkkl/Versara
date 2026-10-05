# Surround-tool reveal

Opening the tools around a PDF or image reveals the four groups in a clockwise
wave: each group fades, moves 28 points outward, untwists from a three-degree
tilt and grows from 90% to its normal size. Four animated styles drive the groups,
instead of one per icon. The PDF/image surface stays static, without animated
scale, opacity or a shadow. The reveal takes 240 ms; closing reverses the wave
over 120 ms before removing the surrounding controls.

An explicit shared progress value drives transform and opacity on the UI thread.
The reveal starts after two animation frames so its initial state and the final
preview layout have committed. The native
preview keeps its component identity and takes its final layout once; its size
is not animated every frame. Help mode and page state changes do not restart the
reveal. Opening again interrupts an exit. Closing cancels pending entrance frames;
the exit completion releases the controls and finishes the ring state. Teardown
cancels frames and animations and guards queued completions. Closing controls
cannot receive touches or accessibility focus. Reduced motion changes immediately.

Validation: lint, TypeScript and whitespace checks passed. Earlier native reader
changes passed offline Android `:pdf-engine:compileDebugKotlin`. Device feel-checks remain:
open and close rapidly, tap a tool during the reveal, toggle help and dismiss a
bubble, scroll each side, rotate, and try reduced motion and larger text. Profile
the release build on a slower Android device before claiming frame-rate results.

All tools closes the surround view and its name mode before the toolbox sheet is
presented after the closing animation, in both PDF and image previews. A labelled
48-point × Hide tools button stays above the image ring, outside help interception.
In PDF surround mode the close action is a 44-point icon in the existing page-control
row beside Fit and orientation, replacing the row's search shortcut while the ring
is open. Search remains available in the ring. There is no separate PDF close row
or duplicate close icon among the surrounding tools, leaving more height for the PDF.
Back also dismisses it. Dismissing the sheet leaves the ordinary
preview controls visible. Shared bottom sheets use a bounded 220 ms timing curve
and system reduced-motion handling. The installed gorhom version treats configs
with `duration` as timing configs; duration-based Reanimated springs must not be
passed as spring configs to this version. PDF tool catalogs are memoized across
page changes. Thumbnail strips retain their layout while the toolbox shows, but
cancel thumbnail requests and stop following the page until it closes, avoiding
an extra native document resize when opening the sheet.

The surround reader now disables native dimming/blur and keeps every visible
page readable at its natural height, including multiple short image-to-PDF pages.
Portrait surround mode always allows vertical scrolling, also on older builds.
Tools still use the current page reported by the reader; page controls allow an
explicit page selection when several pages fit. These changes are JavaScript
changes and do not depend on rebuilding the earlier native focus fix.

Earlier native PDF focus changes handle short boundary pages: reaching the end of the scroll
focuses the final page even when it cannot reach the viewport midpoint. Android
checks all visible rows between the boundaries. In focus mode, a short page's
row is at least the viewport height so multiple short trailing pages can each
reach focus. Cached and freshly rendered rows use the same height rule. Normal
reading restores the compact page heights. Rendering a neighbouring page
does not replace the focused page reported to JS. iOS uses the scroll boundaries
for both its blur veil and the page reported to tools, with half a viewport of
extra trailing scroll space while focus mode is active (restored on exit).
These earlier native reader fixes
require a rebuilt app. Verify mixed page sizes, a very short final page, page
jumps and opening an editor on the focused page. iOS compilation requires macOS.

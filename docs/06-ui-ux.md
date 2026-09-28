# UI, UX, and Feature Delivery

## UI & Visual Design
- **Visual Direction:** Clean, fast, utility-focused, modern, large tap targets, clear progress, excellent dark mode.
- Avoid cluttered "100 tools on one screen" dashboard looks.
- The user should understand the app within five seconds.
- Dashboard modules use quiet neutral surfaces, tinted category icons and consistent typography. Grid and list use the same shared card; only arrangement changes. PDF, Image, Edited files and Privacy form a balanced two-column catalog.
- PDF and Image open file-first category libraries, with recent files, small previews, search and one Open button. Each library shows only its own file type.
- Open a file to reach its full-screen preview. PDF pages appear in a single horizontal thumbnail strip below the canvas; tap a thumbnail to jump. Options includes vertical scrolling and focus view.
- Four quick actions and a Tools button stay visible after a file opens. Tools opens a spacious native sheet with search and the shared grid/list preference. Common PDF tools come first. Tools reuse the selected file. Unimplemented actions are disabled and collapsed under upcoming tools.
- Grid switches to a readable list on narrow windows or large accessibility text. Titles can wrap; controls retain 48-point hit targets. The layout picker reflects when grid is unavailable.
- Bottom tabs have stable, equal-width targets and persistent labels. One selection pill moves on the UI thread with an interruptible, non-overshooting spring. Reduced motion changes selection immediately; screen navigation never waits for the indicator.
- The quick actions form a horizontal row in portrait; landscape uses a side rail to preserve preview height.
- Editor options use action-specific SF Symbols on iOS and Material Icons on Android through the shared editor icon map. Crop ratios, filters, brush styles, rotation, page selection and export actions have meaningful symbols; settings and adjustment icons are reserved for those controls. Context-dependent choices pass explicit icons, and unmapped labels never fall back to a settings icon. Preserve the existing theme colors, labels and touch targets.
- Editor controls belong at the bottom when they fit. PDF Style, Select, Brush/Area and Settings, and image Settings, use measured footer space and font-scaled label widths. Only when that row is crowded do tool controls move into the top toolbar. Page navigation, orientation and common view actions keep their established top positions. Controls render once; inert measurement views cannot receive touches or accessibility focus.
- PDF text editing follows the same measured placement for Add/Select text and PDF options. These controls remain accessible at the top while the keyboard hides the main footer. Image text formatting, adjustment panels and privacy cover controls stay in their bottom docks; common navigation and the image text confirmation checkmark retain their header positions.
- Edited-file rows, page selection/reordering, privacy findings and tool cards reuse memoized components and stable event callbacks. Edited files and PDF page lists decode thumbnails only for visible rows on the active screen; hidden thumbnail owners release native work. Replaced thumbnail files remain protected until their last viewer releases them.
- Custom dialogs use theme-specific input surfaces and translucent text selection colors so selected filenames and messages remain readable in dark mode.
- Toolbox sheets show their first options immediately in a bounded, virtualized three-column catalog. The native presenter owns a fixed 75%-height viewport; the React Native list is the only scroll owner. Header/search stay fixed, rows mount in small batches, cards use shared themed surfaces, and incomplete rows keep equal column widths. Short file-action catalogs omit search. There is no artificial loading delay or full-catalog content measurement. Content stays present during dismissal; image tool switching shows progress while applying the working copy.
- Tone-curve SVG paths are calculated entirely inside one worklet using a loop. Avoid nested array callbacks that the React compiler can hoist into RN-runtime functions; inspect the compiled worklet when changing gesture calculations.
- PDF tools share Edit PDF's page navigation, full-height preview canvas and fixed action area. Numbering and source-page previews reuse its native zoom canvas. Text drafts update as native renders complete while typing; annotation controls remain outside the preview. See [consistent PDF previews](26-consistent-pdf-previews.md).
- The launch splash uses only PDF and image cards, a semibold Sora wordmark, and a subtle staggered entrance. Hold the splash for two seconds, then fade into the app over 200 ms; taps do not dismiss it early. Reduced motion keeps the two-second hold with static artwork. Cancel splash animations and timers on teardown.
- Recents use local SQLite metadata and durable imported copies. Removing an import preserves the external original. Newly created PDFs appear in PDF Recents.

## Tool Registry & Search
- Implement a local tool registry to avoid hardcoded navigation. 
- Implement local search mapping terms to capabilities (e.g., "join pdf" -> Merge PDF).
- Every utility ends with a consistent result screen (Open, Share, Save to Files, Run Again, Delete Output).

## Feature Delivery (Definition of Done)
A feature is complete only when:
1. UI exists.
2. Native implementation exists.
3. iOS and Android implementations work.
4. Offline behavior works where promised.
5. Permission behavior is correct (asked just-in-time, no broad startup permissions).
6. Large files tested.
7. Errors handled.
8. Cancellation works.
9. Temp files cleaned up.
10. Output saved/shared.
11. Manual device validation is documented; no automated tests or web builds per project preference.
12. Accessibility labels and Dark mode work.
13. No unnecessary network requests.
14. AI is not required for deterministic functionality.

## Search/ASO Architecture
Store metadata should target real user intents (PDF editor, page numbering, photo compressor) rather than keyword stuffing the brand name. Balance popular competitive terms against specific ones.

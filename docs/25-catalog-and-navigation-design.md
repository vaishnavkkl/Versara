# Catalog and navigation design

## Research and direction

Reviewed on September 26, 2026:

- [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars): stable top-level destinations and clear navigation hierarchy.
- [Apple: Communicate your brand identity on iOS, WWDC26](https://developer.apple.com/videos/play/wwdc2026/251/): keep navigation familiar and express the app's identity in its content.
- [Android layout and navigation patterns](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns): familiar navigation among peer destinations and controls placed near their content.
- [Android: Translate iOS designs](https://developer.android.com/design/ui/mobile/guides/foundations/translate-designs): prioritize content, retain icons and labels, and avoid lateral screen motion between tab destinations.
- [Expo SDK 57 BottomSheet](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/bottomsheet/) and the installed package types: keep native sheet presentation and account for platform-specific sizing.

These are design inputs, not a claim of a single universal "2026 UI standard". The chosen treatment is a restrained, readable utility catalog with native sheet behavior.

## Changes

- A single `ModuleCard` supplies surfaces, typography, icon sizes, spacing, press feedback and disabled/loading states for dashboard modules, full tool pages and toolbox tiles. Grid/list changes arrangement, not visual identity. Full titles wrap.
- Category colors live in the existing palette. Cards use flat neutral surfaces with subtle boundaries; category color is concentrated in the icon. No animated blur, gradients or shadows are used for these cards.
- Home keeps search near the top, groups PDF/Image/Edited files/Privacy into four balanced positions, and moves the layout switch next to the catalog. Privacy opens its native scan, manual-redaction and metadata-removal workflows; older binaries show clear native-build guidance. The demo remains a secondary introduction below the catalog.
- The toolbox keeps native presentation, provides more vertical room, and has a simple title/file context, clear close control, search, layout switch, distinct section headings and an empty-search recovery action. Search matches multiple words against tool names, descriptions and sections. Android actions wait for native dismissal; the iOS selection timer is bounded and protected from repeated taps.
- Catalogs adapt to one column below 360 points or at font scale 1.4 and above. The layout control reflects this and explains why grid is unavailable to assistive technology.
- Bottom tabs keep equal-width hit targets and every label visible. A single absolute selection pill uses a Reanimated UI-thread spring with no overshoot; icon emphasis follows its progress. Rapid switches retarget the same animation. Rotation places it directly at the new position, RTL reverses its travel, and reduced motion skips travel. Animations are canceled on teardown.
- Tab screens continue to navigate immediately with the router's existing behavior. No full-page sideways animation or animation-completion gate is introduced.

## Validation

Static checks passed: Expo lint, TypeScript `--noEmit`, and `git diff --check`. No automated tests or web builds were run.

The connected Android app loaded the updated dashboard. Inspection of native accessibility bounds caught an unsupported callback-style path on the animated card; using a static style object with press state fixed padding and equal widths. Measured two-column card bounds are `[53,918][526,1319]` and `[558,918][1032,1319]` on the attached phone.

Screen capture returned black and Android reported the physical display OFF, even while its activity was resumed. Visual review and touch/animation verification therefore remain unconfirmed. A native layout tree is not a substitute for a screenshot or release-build frame profiling. iOS presentation and motion also need device review.

Manual acceptance: inspect both themes and grid/list, search for a tool and clear an empty result, open/dismiss a toolbox and select an action once, switch tabs rapidly and reverse mid-flight, rotate, enable Reduce Motion, and check large text. Measure frame times in a release build on the slowest supported device before claiming smoothness guarantees.

## Dashboard discoverability follow-up ? October 12, 2026

User feedback described Home as blank or overly spacious. Source review found a separate brand header and generic workspace introduction, tall category cards, and a recent-tools section that disappears for new users. These are discoverability and hierarchy issues to address in the interface; the feedback does not establish a user knowledge problem.

Home combines the brand and purpose into one compact header, keeps search directly underneath, and opens the four main categories under Browse all tools. Quick actions were removed following user review. Recent tools remain below the categories, with no empty spacer tiles.

Dashboard-only cards use a 128-point minimum instead of the general catalog's 152 points, and screen section spacing is reduced from 20 to 16 points. Text can grow; action labels are not truncated. Recents stack on narrow screens or at larger font scales. Existing dark/light palette, touch targets, Help, introduction dismissal and grid/list preference remain in use.

Validation: Expo lint, TypeScript and diff whitespace checks passed. No automated tests or web builds ran. This was a source/layout review, not screenshot or on-device verification. Manual review should cover a fresh install, both themes, large text, grid/list, all four picker launches and cancellation, and returning Home after using a tool. Ask the reporting user whether the first action is now easier to find.


## Card artwork and equal sizing follow-up

The four Home category cards now measure their natural content and share the largest height. Measurements are bounded to four entries and refreshed for width, font scale and grid/list changes. Widths remain equal within each row. Edited-file counts occupy the description instead of adding a taller footer. Shared tool cards use smaller padding and a 40-point glyph to remove unused space.

Following user review, the four categories use their original BrandGlyph icons again. The added ModuleArtwork illustrations were removed. Equal card sizing, compact spacing, tool destinations and file-picker behavior remain unchanged.

The updated Android Highlight screen was visually inspected on the connected phone: the new settings entry, preview and save actions were visible without overlap. The active document was left in place, so Home, other tools, landscape, large text and iOS still need visual review. Expo lint, TypeScript and whitespace checks passed. No automated tests or web builds were run.


## Grid/list selection follow-up

Home and PDF/image tool catalogs now honor the selected layout at every width
and font scale, instead of disabling Grid below 360 points or at 1.4x text.
Cards continue to wrap text and grow vertically. Grid is the default when no
preference exists, and the user's explicit choice persists. The toggle imports
the Expo SQLite localStorage installer directly rather than relying on the
theme's side effect. Grid is the first toggle option. No release APK or device
interaction was run for this change; verify both selections on the affected phone.

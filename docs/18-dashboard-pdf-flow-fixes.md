# Dashboard and PDF flow fixes

- The optional practice demo sits below the dashboard tools and Edited files. Header help remains available after dismissal.
- The selected bottom tab uses an explicit non-collapsible capsule with a solid background and border. Its label and background share one layout pass; text can increase its height.
- Opening a text/page-edit result returns to the reader that launched the tool, updates its document and remounts it with a revision even when Save overwrote the same URI. Back then returns to the library instead of walking through the editor and original PDF. Source-page previews and multi-output split previews retain their existing back stack.
- PDF replacement awaits the SDK 57 asynchronous file move with overwrite enabled before device export, metadata updates and result display. PDF input copies were already asynchronous and remain so.
- PDF native canvases start after two animation frames so navigation can commit and the covered canvas can release. Editor initial-page rendering waits for that readiness. Reader thumbnails restart only after the reopened reader loads, with the existing 350 ms delay; cache pruning pauses off-screen. PDF reader routes use immediate transitions. Processing, zoom, edit history, cancellation and file ownership remain in their existing implementations.
- Save as new prompts for a filename in the existing application dialog, validates empty/invalid names and retains the format extension. Cancel and Android Back dismiss without saving. PDF tools and image editors use the same prompt.

## Device validation still required

Static validation: `npx.cmd expo lint` and `npx.cmd tsc --noEmit` passed.

A read-only `adb shell dumpsys gfxinfo com.versara.app` snapshot of the connected phone's existing session reported 1,679 frames, 13 frame-deadline misses (0.77%), a 26 ms 95th percentile and a 73 ms 99th percentile. This is cumulative app-wide data, not an isolated PDF transition trace or a before/after measurement of this patch. A screenshot showed the existing Search screen with its selected capsule visible. No device navigation, reload, build or file edits were performed for this inspection.

Cold-launch Home in both themes and with large text; check the full label and oval for each tab. Check demo placement and dismissal.

Open a PDF from its library and from Edited files. Edit, Save, Open PDF, then Back; repeat with Save as new and a custom name. Verify the new contents and displayed filename, and that Save as new preserves the original. Repeat after opening another PDF within the reader. Check name-prompt cancellation, invalid names, omitted extensions and keyboard access on Android/iOS.

Try text edits, page deletion/reordering/rotation, source-page previews, multi-output split previews, undo/redo, discard and Save failures. Check repeated reader/editor transitions and background/foreground cycles with a large PDF on a slower device. Measure native and JS frame times in a release build; these scheduling changes are not a claim of measured frame-rate or memory guarantees. No automated tests or web builds were run.

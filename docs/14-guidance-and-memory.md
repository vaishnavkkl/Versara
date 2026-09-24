# Simple guidance and bounded memory

## User experience

Home offers a dismissible quick-start card. Dismissal is remembered locally, and Help remains available from Home, tool catalogs, individual PDF tools and Settings. Help is optional; it never delays opening a file.

The guide gives three plain-language steps and a short interactive practice demo: choose an example, change its meeting time, and inspect the result. It is clearly labelled as a simulation and does not read, create or save files. It uses text and lightweight native views, with no video, timer, remote request or large image assets. Each implemented PDF tool has its own three-step instructions.

Settings now contains working appearance and guidance controls, with informational privacy/availability text. Unimplemented AI/history/storage controls no longer appear as tappable dead ends. Upcoming tools are labelled in all catalogs and on Home.

## Resource ownership and limits

- Covered/backgrounded readers unmount their native PDF views, releasing PDFKit/PdfRenderer documents, page images and their worker resources. Returning reopens the same file at the remembered page. Zoom resets; this avoids retaining large hidden document renderers behind tool/help routes.
- Editor state and committed edits remain available, but its bitmap canvas unmounts and draft previews pause when the screen is inactive. User-requested saves are not cancelled just because Help or the system picker covers the screen.
- The preview scheduler retains at most one active request and one waiting request. A newer request resolves and replaces the previous waiting request, releasing obsolete edit payloads immediately. The latest successful page preview is reused when identical.
- Each Android/iOS processing worker accepts at most four active/queued jobs. Excess work returns an actionable busy error. Early/late cancellation bookkeeping is capped at 64 IDs per worker. Completed jobs remove their active state; destruction cancels accepted jobs and lets them settle before resources are released.
- Android uses a 4 MB page cache on low-RAM devices. Other devices use a heap-relative cache bounded to 8–24 MB. Rendering is bounded to one million pixels on low-RAM devices and 2–4 million elsewhere, with resolution increasing only when the page/view size benefits. Memory-pressure callbacks evict cached pages and unregister when the view is disposed. Displayed bitmaps are never recycled while Android's render thread may still hold them.
- iOS retains PDFKit's native rendering behavior. Native processing stays on existing user-initiated background queues, with autorelease pools and bounded requests. PDFium work stays serialized because sharing its engine across arbitrary parallel jobs is not safe.
- Image-to-PDF thumbnails use view recycling and no persistent image cache. File bytes still cross native APIs as paths, never base64. Session files and preview images retain their existing cleanup paths.

Using all CPU cores continuously is not a performance target. Native libraries/OS scheduling can use hardware where supported; work remains bounded to avoid memory spikes, contention and unnecessary battery use. No high-memory manifest override, forced garbage collection, synthetic speed claims or always-running background task was added.

## Validation and remaining measurements

TypeScript, lint and Android native Kotlin compilation are the static checks. No automated tests or web builds are run. iOS compilation requires macOS and has not been verified here.

Static review and compilation cannot prove zero memory leaks or unchanged frame times on every device. Manually profile a release/development build on both platforms: repeat open/zoom/edit/cancel/save/close cycles, type rapidly on a complex page, navigate between viewer/tools/help, background/restore, simulate memory pressure and use a large image batch. Observe allocations after returning Home and allowing work to settle; memory should level off across repeated cycles instead of rising continually. Also verify rapid cancellation and closing during import, rotated pages, theme persistence, VoiceOver/TalkBack, large text and narrow screens. Record peak memory, opening time and frame timing before making performance guarantees.

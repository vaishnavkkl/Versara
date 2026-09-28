# Search and Settings

Search offers icon-labelled extension shortcuts, recently used PDF/image tools, suggested tools, recent submitted searches, and shortcuts to Files and Edited files. All / Tools / Files filters narrow results. Available tools open a file picker and then the selected tool directly. Cancelling the picker does not record a tool use. Upcoming tools and tools requiring a newer native build are visibly disabled.

PDF tool routes and image actions from the file preview also record launches, so recent tools are not limited to launches from Search. History begins with this update; no previous activity is fabricated. At most eight tool identifiers and six queries are kept in the existing local preference storage. Queries are recorded on submission, quick-search selection or opening a result, never on each keystroke. Individual queries can be removed. Settings can clear both histories or disable and clear history entirely.

File searches debounce for 250 ms, display only results belonging to the current query, and pause scheduling off-screen/backgrounded. The native API has no cancellation method, so the queue permits one running scan and only the newest pending query. Superseded requests cannot update the screen. File permission errors remain visible alongside tool results and offer a permission action; other errors offer retry. Lists are virtualized and file results remain capped at 80.

Settings refreshes permission status on foreground return and releases the focus-scoped AppState listener and cache-reading timer. Clear unused previews replaces the previous whole-cache deletion: it only deletes unreferenced thumbnail files, excluding active thumbnail jobs and all editor/session inputs. The recent-file confirmation explicitly describes removal of imported copies. File sharing from search now waits for the asynchronous export copy before opening the share sheet.

## Validation

Lint and TypeScript checking passed. No automated tests or web builds per project preference. Device checks still needed: both themes and large text; rapid query edits and tab switches; permission denial and retry; direct PDF/image tool opening and picker cancellation; relaunch persistence; history disabling and clearing; thumbnail regeneration after cleanup; image and archive sharing. Native processing and dependencies are unchanged.

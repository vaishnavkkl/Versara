# Inline search in PDF text tools

Edit Text and Remove Text now replace the page toolbar with an inline search
field when Search is tapped, following the reader's search layout. Close clears
the query/results, dismisses the keyboard, and restores the page toolbar.
Their search bottom sheet is no longer mounted.

Submit with the keyboard Search action or the adjacent search button. The
existing native editable-text search is retained, including its 500-piece cap
and exclusion of scans, protected text, and words split across text pieces.
The first match opens its page; previous/next arrows cycle through matches.
The native canvas focuses the matching text box. Tap the inline result to open
it for editing or select it for removal. One result is rendered at a time.
Closing search during a request prevents that request from restoring results.

The dedicated Find and Replace tool retains its replacement form and sheet.
No native APIs or dependencies changed. Reload JavaScript to use this update.

Verification uses lint and TypeScript checks. Device testing remains manual,
including narrow screens, landscape, keyboard dismissal, multiple-page matches,
no matches, selecting a result, and closing during a search.

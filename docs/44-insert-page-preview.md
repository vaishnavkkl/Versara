# Insert Pages preview and picker fixes

Insert Pages now previews the proposed output sequence. Page navigation counts
the inserted blank page or all pages from the selected PDF. Choosing another
PDF or changing the insertion position jumps to the first inserted page. Only
the visible page is rendered from its source document; no complete temporary
merged PDF is generated on every settings change. Blank pages use a white page
with the neighbouring page preview's dimensions. Final page geometry remains
owned by the existing native insertion operation.

The insertion picker closes Options before opening the file manager. Selected
PDFs are inspected natively for their page count; encrypted or oversized inputs
are rejected while keeping the previous choice. Superseded sources stay in the
session directory until teardown, so an in-flight preview cannot lose its file.
The existing save operation still creates and validates the actual output.

The shared ToolButton suppresses its automatic icon for a + or minus-only title,
preventing duplicated symbols in insertion and page-number size steppers.

Verification uses lint, TypeScript, and whitespace checks. Manual checks should
cover inserting at the beginning/middle/end, blank and multi-page PDFs, changing
the chosen PDF, picker cancellation, preview navigation, and saved page order.
No automated tests or builds were run. Reload JavaScript to use the changes.

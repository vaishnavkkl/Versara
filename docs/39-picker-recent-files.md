# Recent files in the custom picker

The Files explorer previously rendered Recent files only when browsing; every
custom file selection hid that section. The picker now reuses the recent list
with a selection callback and the same selection state as folder rows.

- Image requests show recent images; PDF requests show recent PDFs. Generic
  requests keep the All/PDF/Images filters.
- Recents combine Versara's library with the existing native device queries,
  ordered by recency and bounded to 30 displayed items. List/grid and sort
  controls now use a single virtualized scroll container with visible-only
  thumbnail work; see `41-file-layout-and-pdf-consistency.md`.
- A tap returns the existing file URI to the requesting tool. Single selection
  closes the picker; multiple selection uses the route's existing count, limit,
  toggle behavior, and Use files action.
- Selected rows show checkmarks. Picker rows omit viewer navigation, long-press
  file management, and category navigation.
- Image selection does not schedule the device PDF query. Thumbnails follow the
  existing screen activity lifecycle and library revision invalidation.

This change uses existing native APIs and needs only a JavaScript reload on a
build that already supports the custom picker. Lint and TypeScript checks are
required; manual device validation is left to the user as requested. No
automated tests or builds are run.

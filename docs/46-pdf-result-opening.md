# Opening signed PDF results

PDF result navigation now protects each file URI's percent escapes from the
additional decoding in SDK 57's installed `useLocalSearchParams`. Without this,
a filename containing an encoded hash or percent sequence could reach the native
reader as a different path. Both opening a new reader and returning to an
existing PDF/file preview use the protected parameters, including display names.

Advanced tools retain the requested output URI and verify that its file exists
and is nonempty before clearing drafts or presenting the result. Open PDF checks
availability before navigating, keeping the result screen available when a file
really is missing. Device-save results continue to use the authoritative saved
URI after replacement of an original.

Validation: lint, typecheck and whitespace review. Manual Android/iOS checks
remain: sign then Save PDF and Open PDF, save as new and replace, and filenames
with spaces, Unicode, a hash and literal percent sequences. Confirm the signature
is visible and Back does not reveal the previous PDF. No automated tests or web
builds were run.

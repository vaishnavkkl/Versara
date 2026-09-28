# Recoverable PDF and image saves

Implemented 2026-09-29. The existing Save / Save as new dialogs, names, device folders, editor routes and result types remain in use. Processing and recovery stay on the device.

## Problem and resulting behavior

Previously, `saveEditedOutput` moved generated output over the app original before attempting to publish its device copy. A denied permission or failed device write could therefore report failure after changing the original. Android's existing MediaStore replacement also truncated its destination before copying, swallowed a failed replacement, and then attempted to create another file.

The save order is now:

1. Serialize app saves and recover any interrupted app replacement.
2. For a same-format app-owned original, create a recovery backup and separately staged replacement. The generated output remains intact.
3. Publish the generated output through the native device saver and verify its bytes.
4. Replace the app copy only after device publication succeeds.
5. Update Edited files / Recents, mark the recovery transaction complete, and clean up the temporary backup and redundant generated output.

A device-publication failure leaves the app original unchanged. A native replacement failure attempts to restore the previous device bytes and returns an error; it does not silently create a second device file after a partially written replacement.

Changing the output format creates a device file with the new extension rather than writing differently encoded bytes into a previously saved filename of another format.

## App replacement journal

`src/features/files/save-recovery.ts` keeps original and staged bytes beneath the app's `.save-recovery` Documents directory. Separate `prepared`, `app-replaced`, `rollback`, and `complete` phase files are published without overwriting the earlier phase. Thus an interrupted phase update does not remove the last usable recovery record. A recorded rollback takes precedence over an earlier replacement if recovery itself is interrupted.

Before app replacement, the original backup and staged output sizes are checked. A failed move attempts to restore the backup. If restoration cannot finish, the backup is retained. Once app replacement is recorded, an interrupted SQL/indexing update can be replayed on startup or before a subsequent save. Stored app paths use the existing `document://` form so iOS sandbox-prefix changes do not invalidate those records.

Recovery runs after appearance hydration without extending the splash timer or waiting for it to finish. Failure produces a nonmodal notice after the splash with Retry and Later. Navigation remains available. The next save also retries recovery, so dismissing the notice does not delete a backup or bypass recovery before another replacement.

Each original recovery copy is limited to 512 MiB, with at most four unresolved recovery directories. A file above the replacement limit reports guidance to use Save as new. Unresolved recovery blocks further replacement rather than deleting old backups to make room. Image/PDF bytes are not read into JavaScript arrays for this workflow.

## Native device publication

### Android

MediaStore replacement is limited to an existing media URI in the corresponding Versara folder. Before opening that URI for truncation, native code streams the original into app-owned no-backup storage and publishes an `AtomicFile` journal. Copying computes a SHA-256 digest with a bounded 128 KiB buffer. The written destination is read back and compared by length and digest.

If writing, verification or final metadata update fails, the native saver restores the backup and verifies the restored bytes. If permissions/storage prevent restoration, the backup and journal remain, and the error tells the user to restore access/free space and retry. A later device save first attempts native journal recovery.

New MediaStore entries remain pending while being written and verified; failed writes attempt to remove the new pending item. Legacy filesystem outputs use a staged sibling plus same-directory `Os.rename`, with recovery backups for existing files. Existing files are not streamed directly into a truncated legacy destination.

### iOS

Native saving copies output to a unique staging sibling, synchronizes it, and compares streaming SHA-256/length with the source before publication. Existing destinations receive a separate bounded recovery copy and a journal in Application Support. Replacement uses the native filesystem replacement operation, then verifies the final file. Failure restores and verifies the old bytes where possible. Staging files are removed in `defer`; unresolved recovery copies remain for a later retry.

Target names are checked for collisions instead of overwriting the 1,000th conflicting filename. Source paths must stay within the app's Documents or cache directories. Recovery destinations remain inside the native Saved folder.

Both native implementations expose `nativeDeviceSaveVersion = 2`. JavaScript refuses replacement of an existing shared-device copy using an older native implementation and offers guidance to update the app build or use Save as new.

## Boundaries and verification

App files, MediaStore/provider publication, and SQLite records do not form one atomic transaction. If device publication succeeds but a later app/indexing step fails, the user is told that the device copy exists and recovery material was retained. The journal can restore the app original or finish its index update; it does not claim to roll back an already successful device publication as part of a single distributed transaction.

Recovery is an additional local copy, not a guarantee against storage-device failure, app-data clearing/uninstallation, all OS kill/power-loss timing, or external edits made concurrently by another process. Successful filesystem publication uses native staging/rename mechanisms, but no guarantee of atomicity across storage providers is made. Native device recovery is retried on a later native save; app-file/index recovery also runs at startup. A process death during creation of a brand-new pending MediaStore item may still leave an OS-managed pending entry; existing user data is not overwritten in that case.

Source inspection, TypeScript checking and native compilation are the verification methods for this change. The coordinating implementation report records the consolidated lint/native build results. No connected-device automation, automated failure-injection tests, or web build was run. Later authorized verification should cover full storage, revoked permissions, missing destinations, interrupted writes, metadata failures, process death between phases, repeated retries, format changes and identical requested filenames on both platforms. Swift compilation and those runtime failure scenarios remain unverified in this Windows workspace.

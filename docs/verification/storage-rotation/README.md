# Recoverable desktop database key rotation

20 September 2026. Scope: ID-03-ROTATE under ID-03 and SEC-002/SEC-003. Rotation changes both the SQLite page key and the AES-GCM key protecting cached values. It preserves standalone vault envelopes, saved operations, stable identifiers, migration receipts and other database tables. No renderer receives the master key or a rotation capability.

## Ownership and recovery

The main process owns a versioned OS-protected key record. The utility process owns the encrypted databases and performs rotation before accepting application requests. A new generation uses a fresh 32-byte master key and a UUID-derived filename within the existing protected directory. SQLite page encryption retains its separate HKDF-derived key.

1. Main durably records the old active generation and a prepared replacement key.
2. Utility checkpoints and closes the source, then copies its encrypted file into the uncommitted generation. It authenticates and re-encrypts cache values in bounded batches, rekeys the copied pages, verifies the result, closes it and flushes the file and supported directory before acknowledging readiness.
3. Main atomically records the replacement as active, retaining the previous key for cleanup recovery.
4. Only after opening verified active storage does main remove the superseded encrypted database and sidecars. Main flushes the directory before retiring the old key from the protected record.

A prepared rotation resumes by rebuilding its disposable destination from the retained source. An activated rotation resumes by verifying the active database and finishing retirement; it never copies older data over the active generation. Missing initialized storage, absent keys alongside managed database files, malformed records and failed authentication stop access instead of replacing business data with an empty database. Failed bootstrap closes the utility before another attempt can start.

Previous raw-string key records are upgraded durably. The previous format did not record whether an absent database had ever been initialized; that historical ambiguity is not claimed to be recoverable. New records distinguish unpublished initialization from previously initialized storage. An initial key becomes usable only after the database and initialized record have been acknowledged.

The implementation uses the driver's private Buffer-based [key/rekey API](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/api.md). SQLite rekeying operates on an expendable encrypted copy, so interruption cannot destroy the authoritative source. This does not claim secure erasure from filesystem snapshots or backups, nor protection against a compromised operating system.

## Operator use

Quit all running instances, then launch the desktop executable with `--rotate-storage-key`. Rotation runs at the first protected-storage access, before saved data is exposed. The flag is consumed after successful bootstrap. A fresh installation creates its first key without an unnecessary extra rotation. Interrupted rotations resume on the next access without the flag. Opening a second instance is not a maintenance request to the already running instance.

Keep free disk space for another encrypted database and SQLite's journals. Copy or restore a complete, consistent device backup; do not mix a database generation with an unrelated key record. Old executables that only understand raw-string keys cannot open the upgraded record. Use a compatible current release or corrective release, rather than manually rewriting keys or renaming database generations. Cross-device backup, lost-key recovery and actual OS-provider recovery are still unfinished ID-03 work.

## Acceptance

- Focused database/retention tests first passed 21 checks, covering rotation, six publication interruption points, corrupt staged copies, wrong keys, missing storage, source authentication, metadata privacy, retained tables and legacy records. Additional batch-boundary and activated-copy preservation checks are included in the final regression.
- `/tmp/gabs-rotation-build.log` passed strict root/browser/Node/preload/worker checks, architecture/copy checks and four fresh builds. Existing bundle-size warnings remain.
- `/tmp/gabs-rotation-native.log` passed nine hidden/minimized native journeys. Three actual app journeys cover normal rotation and forced main-process termination before activation and after activation. Saved Contacts data is recovered and remains usable after another restart; the original encrypted generation is retired. Existing native PIN, biometric-envelope renewal, migration and worker-termination journeys passed.
- Native OS protection and biometric callbacks use the explicitly controlled test adapter. These runs do not establish actual Keychain/DPAPI/Secret Service or physical biometric acceptance. No foreground windows or hardware prompts are opened.

Final-source verification passed **773 tests across 113 files** in `/tmp/gabs-rotation-regression.log`. This includes 13 real encrypted-database rotation checks, batch boundaries (including empty/unicode keys), and preservation of newer active-generation work during retirement recovery. `/tmp/gabs-rotation-final-types.log` passed every strict environment check after the final worker test update.

`/tmp/gabs-rotation-package.log` produced the unsigned macOS arm64 app. `/tmp/gabs-rotation-packaged-native.log` passed the actual ASAR utility worker with the packaged native SQLite binding: acknowledged corporate pending work and standalone vault data survived forced utility termination, a new master/page key and authenticated reopening. The development harness stays hidden while launching the packaged worker; this is native-driver/package evidence, not signed installer or full packaged-main acceptance. All disposable PostgreSQL databases were removed.

Changed-source formatting, diff whitespace, documentation links and all 29 original requirement mappings pass. No UI source or styles changed. Overall parity, backup/lost-key recovery and signed cross-platform acceptance remain open.

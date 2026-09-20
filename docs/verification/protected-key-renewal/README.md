# Protected-file durability and provider-key renewal

20 September 2026. Scope: ID-03-WRAP under ID-03 and SEC-002/SEC-003. This is automatic renewal of OS-protected file envelopes, including the SQLite master-key envelope. It does not rotate the SQLite master key or page key itself and does not implement lost-key recovery.

## Implementation

`apps/desktop/src/main/identity/protected-files.ts` owns protected file persistence. Electron main supplies its existing safeStorage provider; renderers receive no new method or key material. Credentials, remembered identity, saved corporate profiles, corporate unlock policy and the database master-key file use the same owner.

- A read validates decrypted JSON before renewing an envelope when the provider returns `shouldReEncrypt`. The logical record and database key remain unchanged.
- Reads, renewal, writes and deletion serialize per file. A delayed renewal cannot overwrite a later write or resurrect a credential after removal. Writes snapshot input before yielding.
- Replacement writes ciphertext to an exclusive 0600 temporary file, flushes it, closes it, atomically renames it and flushes the containing directory on supported platforms. Recursively created directory entries are flushed as well. No success is acknowledged before those steps complete. Deletion also flushes its directory.
- Provider unavailability, malformed decrypted content and pre-publication failures retain the previous protected file. A failure after rename may leave the complete replacement; it is reported as a failed acknowledgement and the next read can recover that complete value. Temporary cleanup does not select an older value for rollback.
- Legacy scoped files remain read-only fallback because workspace retirement owns their directories. Renewal must not recreate those files during deletion. New scoped data already uses the encrypted utility database.

Electron's [safeStorage contract](https://www.electronjs.org/docs/latest/api/safe-storage) describes its renewal signal. The pinned [Electron 44.3.0 implementation](https://github.com/electron/electron/blob/v44.3.0/shell/browser/api/electron_api_safe_storage.cc) returns decrypted plaintext and `shouldReEncrypt` from the provider; this implementation re-encrypts that plaintext before publishing the replacement.

## Verification scope and remaining work

Filesystem tests use actual temporary files and AES-GCM ciphertext with a controlled two-key provider. Injected failures cover file flush, rename and directory flush. They do not reproduce power loss or validate an actual OS key provider. Windows does not expose directory fsync through this Node API; signed target-platform filesystem acceptance remains required.

The minimized desktop journey uses the real main/utility/database paths and a controlled provider. It creates business data, renews the master-key envelope after a provider-key change, then reopens with the old provider key removed. This is not physical Keychain, DPAPI, secret-service or biometric acceptance.

Remaining ID-03 work includes transactional database master/page-key rotation, renewal of standalone quick-unlock envelopes stored inside vault records, verified backup/lost-key recovery, actual provider failure/rotation acceptance and signed platform installation/update acceptance. No entire original requirement, full parity or final UI-design gate is closed by this milestone.

## Acceptance results

- Eighteen focused storage/credential tests passed in `/tmp/gabs-protected-files-tests-final.log`. Real temporary files and controlled AES-GCM providers cover renewal, provider retirement, delayed write/removal ordering, malformed content, unavailable protection, file/rename/directory failures, legacy read-only fallback and retrying an already-unlinked credential's directory flush.
- Strict root/browser/Node/preload/worker checks, boundary/copy checks and all four fresh builds passed in `/tmp/gabs-protected-files-build-reviewed.log`. Existing bundle-size warnings remain.
- Four minimized native journeys passed in `/tmp/gabs-protected-files-native.log`: protected-storage refusal, utility-owned PIN/restart/crash behavior, migration/cancelled enrollment and database-key-envelope renewal across three app processes. A contact saved before renewal remained readable after the controlled old provider key was retired. No foreground window or physical OS prompt was opened; the disposable database was removed.
- No UI source or style changed. Existing native vault settings captures remain regression evidence; no new visual-design acceptance is claimed.
- Final isolated unit/PostgreSQL regression passed **753 tests across 112 files** in `/tmp/gabs-protected-files-regression-final.log`, including the final deletion-flush retry correction. The earlier 752-test run preceded that additional case. Both disposable databases were removed.
- Changed-source formatting, `git diff --check`, documentation links and preservation of all 29 original requirement IDs pass. No package publication, deployment, live provider operation or interactive acceptance was performed.

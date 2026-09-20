# Retained-original local-profile recovery

Scope: ID-03-BACKUP-RECOVER, the in-place recovery engineering slice of ID-03-BACKUP-RESTORE. Actual OS-provider, physical biometric and signed-platform acceptance remain required. Corporate saved-work recovery is separate. Company-only devices can use [empty-store preparation](../corporate-device-recovery/README.md) without a standalone archive, followed by fresh sign-in and explicit corporate archive import.

## Operator procedure

Use additive `--restore-local-profiles=<archive>` for fresh or readable stores. When the existing protected store cannot be opened, quit Common and run its executable with `--recover-local-profiles=/absolute/path/local-profiles.commonbackup`. Supply the archive passphrase through standard input from the operator's existing password manager, as in the [additive procedure](../local-profile-restore/README.md#operator-procedure). The current OS protection provider must be available to protect the new store. Maintenance opens no application window and refuses a running application instance.

Recovery creates a new independently keyed store containing the archived standalone profiles. It retains the **entire original encrypted directory** as `secure-cache.retained-<recovery-id>` beside the active `secure-cache`. Do not remove that directory: it can contain corporate pending work and other data absent from the standalone archive. It is preserved encrypted; this command cannot decrypt it without its original key. Sufficient space is required for the retained original, archive extraction and new database.

Launch Common and unlock restored profiles using their original profile passphrases. The archive passphrase does not replace them. Device grants and native quick-unlock enrollment require renewal; uncertain device effects retain their original identities. Corporate credentials, cache rows and offline leases are not restored into the new active store.

Ordinary retries of the same archive preserve newer recovered work. If the provider key is lost a second time, a normal retry refuses to replace the inaccessible current store. Add `--new-local-recovery` only when deliberately requesting another recovery from that archive; it retains the current directory separately and activates the archived state again. The option is valid only with `--recover-local-profiles`.

If activation is interrupted, a subsequent normal startup or recovery command completes the pending authorized recovery before admitting credentials or opening the UI. A recovery command that finishes an existing activation exits after that completion. A failure message asks the operator to retain all recovery files; unexpected paths, missing candidates and unavailable protection fail closed.

## Implementation and review

- Main owns maintenance and protected keys; encrypted SQLite and archive validation remain in the utility. No renderer capability, UI layout or network authority is added.
- A bounded private journal is published before staging creation. A `preparing` record permits cleanup only while the original directory still matches and no retained directory exists. UUID-derived paths, ordinary-directory checks and filesystem identity checks prevent cleanup from following links or arbitrary paths.
- Authentication, schema validation, independent-key preparation and current-provider verification finish before the journal becomes `ready`. The archive fingerprint is calculated from the same authenticated file descriptor as extraction.
- Activation moves the original to its retained path, then moves the verified candidate into place. An active marker identifies completed activation; retry never replaces that new root with an older snapshot. Journal changes and directory transitions are flushed where supported.
- Additive imports also register staging before creation. Startup and retries clean only that registered disposable staging. Unknown legacy/unregistered directories are preserved.
- Review covered each transition, interrupted directory moves, replay after newer edits, unavailable providers, malformed records, symlinks and ambiguous active paths. Original bytes remain unchanged in the tested retention paths.

## Verification, 20 September 2026

| Check | Result |
| --- | --- |
| Full isolated unit/PostgreSQL regression | 823 passed across 119 files; `/tmp/gabs-root-recovery-regression.log` |
| Strict environment checks, boundaries/copy checks and four fresh application builds | Passed; `/tmp/gabs-root-recovery-build.log` |
| Final source cleanup: focused recovery/staging checks and fresh strict builds | 16 passed; four uncached builds; `/tmp/gabs-root-recovery-final-focused.log`, `/tmp/gabs-root-recovery-final-build.log` |
| Development-main native restore/recovery journeys | Six passed; `/tmp/gabs-root-recovery-native.log` |
| Fresh unsigned macOS arm64 packaging | Passed; `/tmp/gabs-root-recovery-package.log` |
| Packaged-main restore/recovery acceptance | Six passed; `/tmp/gabs-root-recovery-packaged.log` |

The new integration cases use actual encrypted SQLite and archives with controlled protection. Native cases execute the real stdin-fed maintenance commands, kill main with SIGKILL during preparation and either activation move, and recover actual Contacts records through the existing profile UI. They verify byte-preserved originals, automatic pre-UI resumption, newer-edit preservation and registered-stage cleanup. The final packaged run also exercises a second provider-key loss and explicit new recovery retaining both previous stores.

`SUITE_ACCEPT_RECOVERY_ENTRY` selects the freshly packaged ASAR main/utility for recovery commands and application launches. `SUITE_ACCEPT_BACKUP_ENTRY` selects that packaged main/utility for additive commands; additive UI launches use the development entry. Electron protection is supplied by an explicit controlled test adapter before main is loaded. Maintenance forbids window creation; interactive test windows remain hidden/minimized and unfocused. Each isolated test database is removed afterward.

These are macOS arm64 process-crash and packaged-code checks, not real Keychain/DPAPI/libsecret, physical biometric, signed installed release, reboot/remount or power-loss acceptance. Directory identity and durability require target-platform acceptance; directory flush is not performed on Windows. Small unpublished metadata temporary files may survive abrupt termination; unknown older staging is not deleted. Backup-creation staging is outside this cleanup scope. Archive validation materializes profile envelopes in memory; these tests do not establish unlimited archive scale. Broader ID-03, corporate recovery and overall parity remain open.

# Additive local-profile restore

Scope: ID-03-BACKUP-RESTORE, additive import into a fresh or readable device store. Full in-place lost-key recovery and corporate saved-work recovery remain open.

## Behavior

- `--restore-local-profiles=<archive>` runs before credentials, network-backed identity and renderer admission. It requires the application to be closed, reads the archive passphrase through standard input, opens no window, and rejects combined backup/restore/rotation flags.
- Main authenticates the archive and asks the utility to validate its SQLite schema and create independently keyed staging storage before opening the live database. Staging contains encrypted pages only. Wrong passphrases or unsupported archive contents cannot initialize live storage.
- One utility transaction adds profiles, retained migration receipts and the archive identity. Existing profiles are never overwritten. A profile-ID collision fails the whole import; importing an already accepted archive preserves later local edits.
- Corporate cache rows, existing personal profiles and their keys remain in place. The portable archive never contains corporate caches, saved online credentials or native unlock wrappers.
- First passphrase unlock clears copied device grants, marks pending/running device requests uncertain and preserves original request/attempt identities and completed results. Native PIN/biometric enrollment must be established again on the recovered device.
- Recovery persistence precedes issuance of an unlocked grant. It does not send a spurious external profile-change notification that would cancel that same unlock. Revision checks reject competing first unlocks.
- A lost response after the transaction commits is safe to retry with the same archive. Cancellation before opening the live store does not initialize a destination. An interrupted process can leave encrypted staging files; automatic orphan-staging cleanup remains a follow-up for the complete recovery lifecycle.

## Operator procedure

Quit Common. Supply the archive passphrase through a pipe; do not put it in command-line arguments or environment variables. For example, with an existing password-manager CLI entry:

```sh
password-manager read common-local-backup | \
  /Applications/Common.app/Contents/MacOS/Common \
  --restore-local-profiles=/absolute/path/local-profiles.commonbackup
```

`password-manager` is illustrative: use the equivalent command from the operator's existing password manager. After success, launch Common and unlock each restored profile with its original profile passphrase. The archive passphrase authenticates the archive; it does not replace profile passphrases.

The command adds profiles to the current device store. A second import of the identical archive reports that it was already restored. An independently existing profile with the same ID is retained and the import fails. Preserve both stores for deliberate recovery; do not delete current storage to force import.

A fresh recovery location can be selected with Electron's `--user-data-dir=/absolute/path/new-profile` on both the maintenance and subsequent application launch. This supports a new device/provider without copying the old provider key. If the current store's protected key is unavailable, the command fails closed and retains it. Automated in-place replacement with retained original storage is not implemented yet.

## Acceptance and limits

The integration suite uses actual encrypted SQLite, archive authentication and protected-file persistence with a controlled provider. The native suite exercises actual main/utility commands and the existing user interface, with OS protection supplied by its explicitly controlled adapter. These checks do not establish real Keychain/DPAPI/libsecret or physical biometric acceptance.

The complete restore gate still requires recoverable in-place activation for an unreadable original store, interruption coverage for that activation, staging cleanup policy and platform/provider acceptance. Corporate archives require current account/workspace authorization and remain ID-03-BACKUP-CORPORATE. Full parity and later UI refinement remain open.

## Verification, 20 September 2026

| Check | Result |
| --- | --- |
| Unit/PostgreSQL regression in an isolated database | 807 passed across 117 files; `/tmp/gabs-restore-command-regression.log` |
| Strict TypeScript/environment checks, dependency/copy checks and fresh builds | Passed; four uncached application builds; `/tmp/gabs-restore-command-build.log` |
| Actual development-main restore and interruption journeys | Two passed; `/tmp/gabs-restore-command-native.log` |
| Fresh unsigned macOS arm64 packaging | Passed; `/tmp/gabs-restore-command-package.log` |
| Packaged-main/utility restore journeys plus native vault regression | Four passed; `/tmp/gabs-restore-command-packaged.log` |

The two restore journeys execute a real stdin-fed child command with window creation forbidden. They cover wrong archive passphrase, conflicting maintenance flags, ID collision, fresh-provider import, repeated import, original-passphrase unlock, absent quick-unlock enrollment, cleared device grants, uncertain pending effects, edited-contact preservation, restart and running-instance refusal without focusing its window. One journey kills main with SIGKILL after the utility's actual merge commit but before its response reaches main; replay detects the durable receipt and does not duplicate or overwrite the imported profile.

Packaged-code acceptance sets `SUITE_ACCEPT_BACKUP_ENTRY` to the freshly built `app.asar/dist/main.cjs`; its real utility and native driver run from that package. The controlled Electron harness still supplies OS protection and the interactive application uses the development entry. This is not signed/installed full-platform or actual OS-provider acceptance. All desktop windows remain hidden/minimized and unfocused. Test databases are removed after each isolated run. Shell, renderer, UI kit, styles and theme sources are unchanged.

Native testing caught and corrected self-cancellation during first-unlock recovery and a malformed device-journal fixture that exposed missing validation. The final regression includes concurrent first-unlock fencing and rejection of a missing device-call description while retaining the original removed profile. Existing web bundle-size warnings remain.

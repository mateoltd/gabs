# Corporate recovery after device storage becomes unreadable

Scope: **ID-03-BACKUP-DEVICE**, under ID-03-BACKUP-CORPORATE. Status: **verified within the scoped evidence below**. This is an explicit operator recovery path for an existing protected store. It does not decrypt an old database whose key is unavailable.

## Operator procedure

1. Keep the original corporate saved-work archive and its passphrase. Quit Common. First try unlocking the OS protection provider if the key is merely locked rather than lost.
2. Run the installed Common executable with `--prepare-device-recovery`. The operation opens no application window and refuses another running instance using the same user-data directory. It needs a working current OS protection provider. No archive passphrase is required for this preparation step.
3. Keep the reported `secure-cache.retained-<id>` directory. It holds the entire original encrypted store, including credentials, pending corporate input and local profiles. The command activates a new independently keyed, empty protected store; it does not restore any work or corporate authority. Allow space for both stores.
4. Launch Common, authenticate normally and select the original company. Enable permitted offline storage if required. In Settings, open **Saved-work archives**, select the original archive, enter its passphrase, select the authorized copies and import them for review. Each restoration still checks current permissions, module contracts and authoritative original outcomes. Server-accepted work can be downloaded normally.
5. If standalone profiles also need recovery, use their separate backup and additive `--restore-local-profiles=<archive>` procedure. Corporate saved-work archives contain neither local-profile vaults nor their keys.

Ordinary repetition of `--prepare-device-recovery` verifies the active prepared store and preserves newer work. If that store becomes unreadable after a second key loss, the ordinary retry refuses replacement. Add `--new-device-recovery` only to explicitly retain that current directory separately and prepare another empty store. The switch is valid only with `--prepare-device-recovery`; recovery cannot be combined with backup, restore or key rotation.

A crash during preparation leaves the original active store in place. Startup clears only the registered, uncommitted candidate. A crash after the verified activation intent is published is resumed before credentials or the application window are admitted. Unexpected paths, malformed journals, unavailable current protection and ambiguous active/staged directories fail closed; retain all files for diagnosis.

Without an independently usable archive or the original decryption key, pending input in the old store remains unavailable. Retaining ciphertext preserves a later recovery opportunity; preparing an empty store does not recover those bytes. No automatic deletion or upload of retained stores occurs.

## Implementation

Main owns the maintenance command, single-instance exclusion and OS-protected key pointer. The existing recovery journal and directory-identity checks handle both standalone archive restoration and empty-store preparation. The utility creates and verifies the actual encrypted SQLite database. Existing archive fingerprints and marker filenames remain compatible with interrupted standalone recoveries. A ready record identifies exactly one source: a local archive fingerprint or an empty store.

The active store receives no old credentials, account identity, leases, cached corporate pages or local profiles. Chromium preferences outside the protected directory may remain; they grant no corporate access. Corporate archive decryption and admission remain in the existing scoped client workflow rather than the maintenance command.

## Acceptance

Five real desktop journeys export actual Contacts requests/drafts offline, then reopen the same user-data directory after losing its controlled OS wrapper or corrupting the encrypted database. Maintenance first demonstrates that the old store cannot be opened. With a still-readable wrapper, this failed preflight may renew its metadata; the damaged database remains unchanged. Recovery retains the exact directory captured after that preflight.

The new command refuses a running instance and an unmatched second-recovery switch. Three journeys kill main with SIGKILL after staging-directory creation, after retaining the original, or after activating the candidate. Normal startup completes a committed recovery before showing sign-in; interrupted preparation is retried explicitly. No credentials, identity or lease files appear in the empty store before authentication.

Each journey then completes normal Settings archive unlock, current denial/regrant, duplicate-safe selected import, original server cancellation and one independent draft effect. After another quit and repeated maintenance command, a fresh sign-in confirms the same journal, drafts and imported-copy map. The original retained directory is byte-for-byte unchanged. Maintenance creates no browser window; application windows remain hidden/minimized and unfocused.

- Final native run: **13 passed**, including five new device-recovery cases, four standalone recovery regressions and four archive-admission crash regressions. `/tmp/gabs-device-recovery-native-regression.log`.
- Strict root/browser/Node/preload/worker type checks, dependency/copy checks and a fresh desktop build passed. `/tmp/gabs-device-recovery-types.log`, `/tmp/gabs-device-recovery-lint.log`, `/tmp/gabs-device-recovery-build.log`. The existing bundle-size advisory remains. No new web/server build or signed package is claimed.
- All **20** new wide/narrow captures were inspected; dialog Axe A/AA and overflow checks passed. Existing UI source/styles are unchanged. These captures establish continuity and usable archive controls, not design approval or whole-product accessibility conformance.
- Final full isolated unit/PostgreSQL regression: **968 passed across 123 files**, `/tmp/gabs-device-recovery-regression.log`. This includes 20 root-recovery checks covering interrupted preparation/activation, exact retained originals, newer-work preservation, unavailable providers, second key loss, ambiguous source records and existing local-profile recovery. An initial test fixture used a non-JSON cache sentinel and correctly failed database verification; the final test uses valid serialized input.
- Disposable databases/profiles were removed. Historical rerun screenshots were restored. Scoped formatting and documentation links/requirement mappings were checked.

| Recovery condition | Source export | Fresh-authority import |
| --- | --- | --- |
| Lost key | [Wide](../corporate-work-archives/native-key-recovery-none-export.png), [narrow](../corporate-work-archives/native-key-recovery-none-export-narrow.png) | [Wide](../corporate-work-archives/native-key-recovery-none-import.png), [narrow](../corporate-work-archives/native-key-recovery-none-import-narrow.png) |
| Interrupted preparation | [Wide](../corporate-work-archives/native-key-recovery-preparing-export.png), [narrow](../corporate-work-archives/native-key-recovery-preparing-export-narrow.png) | [Wide](../corporate-work-archives/native-key-recovery-preparing-import.png), [narrow](../corporate-work-archives/native-key-recovery-preparing-import-narrow.png) |
| Interrupted original retention | [Wide](../corporate-work-archives/native-key-recovery-retained-export.png), [narrow](../corporate-work-archives/native-key-recovery-retained-export-narrow.png) | [Wide](../corporate-work-archives/native-key-recovery-retained-import.png), [narrow](../corporate-work-archives/native-key-recovery-retained-import-narrow.png) |
| Interrupted activation | [Wide](../corporate-work-archives/native-key-recovery-activated-export.png), [narrow](../corporate-work-archives/native-key-recovery-activated-export-narrow.png) | [Wide](../corporate-work-archives/native-key-recovery-activated-import.png), [narrow](../corporate-work-archives/native-key-recovery-activated-import-narrow.png) |
| Damaged encrypted database | [Wide](../corporate-work-archives/native-key-recovery-damaged-database-export.png), [narrow](../corporate-work-archives/native-key-recovery-damaged-database-export-narrow.png) | [Wide](../corporate-work-archives/native-key-recovery-damaged-database-import.png), [narrow](../corporate-work-archives/native-key-recovery-damaged-database-import-narrow.png) |


Actual Keychain/DPAPI/libsecret recovery, provider/MFA credentials, signed installed releases, Windows/Linux directory semantics and physical power-loss/reboot durability remain parent gates. Development authentication and controlled native protection do not establish them. Overall parity and later UI refinement remain open.

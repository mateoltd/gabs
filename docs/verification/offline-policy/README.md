# Offline policy recovery

19 September 2026. Tracker: **OFF-02-LEASES-POLICY**, within active **OFF-02-LEASES/OFF-02**. Coverage: **CORE-003/SHELL-001**. This milestone establishes the browser policy-edit/recovery behavior; full working-set authority and native acceptance remain open.

## Behavior

Administrators can select any integer window from 1 to 24 hours, or disable corporate offline access. The server already accepted those values; Settings previously exposed only disabled and 24 hours. A shorter window expires relative to server authorization time, not the time a cache write finishes.

Disabling corporate offline access immediately expires the received local lease and clears legacy snapshot records without deleting pending work or changing the device's opt-in preference. Current, authorized online inspection and synchronization remain available. New public SDK queued commands/resource writes have a separate capture gate, checked again under the storage lock. Existing receipts remain readable through the authorized recovery path. Explicit device-data removal refuses unresolved changes and drafts.

Snapshot writes and received policy reconciliation use the same account/workspace lock. Reconciliation reads the latest policy after waiting for storage; writes also honor a newer persisted policy from another tab. This covers an in-flight first snapshot, a disable received before React has loaded that snapshot, and a later stale writer. Policy observation alone never creates a snapshot on a device without an existing opt-in. Foreign workspace policy is rejected. Null snapshot removal is preserved.

Server authority, original request identity, dependencies and inputs remain unchanged. This does not grant new access to a revoked member, recover a removed profile, or establish cross-process native locking.

## Verification

- `tests/unit/policy-ordering.test.ts`: delayed first persistence, received withdrawal, older-tab writes, shortening, no implicit device opt-in and account/workspace isolation.
- `tests/unit/queued-resources.test.ts`: capture withdrawal leaves original command/resource receipts intact; policy changes during storage waits reject both capture paths without mutation.
- Focused response-storage/queue/policy checks passed **108 tests**, `/tmp/gabs-offline-policy-focused.log`.
- Final isolated unit/PostgreSQL regression passed **639 tests in 94 files**, `/tmp/gabs-offline-policy-regression-final.log`. The helper removed its database.
- Strict root/environment types, boundary/copy checks and **four fresh production builds** passed, `/tmp/gabs-offline-policy-build-final.log`.
- **Five headless journeys passed**, `/tmp/gabs-offline-policy-web-final.log`: the two new policy cases, selected offline lists, custom SDK resource reads and bounded reference downloads. Their isolated database was removed.
- Disabled-policy acceptance creates a real pending Contacts edit, changes the same field on the server, disables offline access, reconnects and observes a real conflict. The inspector shows the original saved field; removal is refused; offline restart locks access while preserving the exact journal; reconnecting restores online recovery.
- Shortening acceptance uses the actual Settings control, asserts the persisted one-hour deadline, captures an offline change, advances the browser clock beyond expiry, verifies locked access and an unchanged journal, then restores the clock/reconnects and observes authoritative acceptance.
- Scoped dialog Axe and narrow-overflow checks passed. Inspected [recovery wide](recovery-wide.png), [recovery narrow](recovery-narrow.png), [Settings wide](settings-wide.png) and [Settings narrow](settings-narrow.png). This preserves existing presentation; it is not final UI approval or whole-product accessibility certification.

The initial shortened-window test failed because the one-hour option did not exist. During verification, the conflicting-edit fixture was corrected to send a complete valid resource update, a Settings selector was scoped to Preferences, and redundant authorization calls were removed to retain the existing capture-check ordering. Final results above are the acceptance evidence.

## Remaining work

The macOS console still reports `screen_locked: true`. The native policy-disable/shortening journey and protected SQLite/IPC/restart acceptance remain required. No protected-storage bypass, unlock attempt or foreground window was used.

Membership-wide revocation (including writes queued around denial), delayed account/workspace/module-release transitions and remaining profile/sign-out recovery must still be implemented or independently verified. Deterministic storage tests do not prove every browser/network race. These gates remain in OFF-02-LEASES and OFF-03; no entire original requirement or the parity goal is complete.

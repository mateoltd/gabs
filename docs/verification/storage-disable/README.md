# Atomic offline-storage disable

19 September 2026. **OFF-02-LEASES-STORAGE**, within active **OFF-02-LEASES**. Original mappings: **CORE-003, SHELL-001**. Browser acceptance and storage-worker checks pass; corporate protected native acceptance remains required.

## Behavior

The former separate pending-work check and workspace purge could delete a change captured between those operations. IndexedDB and the encrypted SQLite worker now inspect current drafts, uncertain requests, reviews and installation attempts in the same transaction that deletes the workspace cache and writes a new disabled authority generation. Unresolved journal chains, unreadable saved work and native relay receipts also prevent deletion. Refusal leaves the original saved work and authorization intact.

Workspace policy coordinates snapshot, module and legacy-draft writers. The durable disabled marker rejects late business-cache writes and survives reauthentication. Explicit enabling requires current online policy. Browser tabs receive disable and close offline access. Online retry identities and executable metadata remain writable for their existing safety/lifecycle purposes. A successful retry clears the previous Settings error; the button is disabled during execution. No stylesheet changed.

## Verification

- `/tmp/gabs-storage-disable-regression.log`: **665 tests across 98 files** pass against an isolated PostgreSQL database, subsequently removed. This ran before the final Settings busy/error cleanup; the final build and browser run cover that cleanup.
- `/tmp/gabs-storage-disable-focused.log`: **13 tests** cover policy generations and the actual SQLite worker. Two integration cases bundle the production worker, run its real AES-GCM/SQLite implementation and test retained inputs, transaction refusal, settled-chain deletion, workspace isolation, durable opt-out, late-write rejection and unknown actions. The test transport adapts Electron's parentPort shape; it does not exercise Keychain or the packaged desktop UI.
- `/tmp/gabs-storage-disable-final-build.log`: strict root/browser/Node/preload/worker checks, architecture/copy checks and **four fresh builds** pass. Existing bundle-size warnings remain.
- `/tmp/gabs-storage-disable-acceptance-final.log`: **six headless browser journeys** pass. The new two-tab journey holds the actual snapshot lock request, captures a real Contact change, verifies refusal preserves the exact envelope, synchronizes it, disables both tabs, restarts without offline access, and explicitly enables storage again. The backend journey verifies legacy retry/review retention and rejection of late writes. Existing policy-revocation and capability-storage journeys also pass.
- The earlier final-fixture attempts exposed an unfinished background installation after reconnect. Deletion correctly refused it. The fixture now waits for all four official installations to finish before introducing its offline race; it does not erase installation state or weaken retention.
- [Refused deletion](retained-work.png) and [successful disable](disabled-storage.png) were inspected for the Settings state, legible feedback and unchanged layout. This is functional continuity evidence, not final UI design approval.

## Remaining acceptance

macOS reports `CGSSessionScreenIsLocked = Yes`. Corporate protected-storage disable/restart, volatile/native IPC ordering and retained legacy-file behavior still require a real minimized desktop journey after protected storage is available. No OS unlock or storage bypass was used. The SQLite checks alone do not close that gate.

Live disable is broadcast; an already-open sibling tab learns later explicit enabling through its policy refresh/reload. Broader workspace/profile/release transitions, full parity and the separate later UI refinement goal remain open.

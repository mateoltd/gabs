# Received-draft lifecycle and capacity

18 September 2026. **SDK-05-LAN-LIFE is locally verified for the same-account administrator workflow below. SDK-05, OPS-01 and full parity remain open.**

## Delivered workflow

- [Recovery management](../../../apps/desktop/src/main/lan/recovery.ts) now archives the exact envelope before clearing its inbox copy and restores the inbox copy before removing the archive entry. Interrupted moves can leave duplicate copies but cannot silently lose the source; exact retries reconcile them. Original request IDs and protected pending/accepted/rejected/conflict outcomes survive the move and process restart.
- [Receipt storage rules](../../../apps/desktop/src/main/lan/receipts.ts) bound the inbox at ten envelopes and the archive at 100 copies/16 MiB of serialized content. Capacity failures retain existing work. The archive does not automatically evict old pending drafts. Separate small outcome records remain to preserve uncertain retries and accepted dependencies.
- Transport retries for an exact archived receipt are acknowledged without reopening the inbox entry. Changed content under that archived ID is rejected. Explicit recovery can restore the original receipt even while LAN is disabled.
- Native recovery files use a versioned, scoped, digest-checked envelope. Owned invalid draft schemas can be exported and retained for recovery; foreign/unknown ownership cannot be exported. Files do not carry authoritative accepted outcomes. Import requires the same account/workspace and explicit subsequent submission unless protected local history already confirms the exact receipt.
- [Narrow recovery IPC](../../../apps/desktop/src/main/lan/ipc.ts) owns file pickers and bounded filesystem I/O. Renderers supply receipt selections, never paths or exported bytes. Authorization is rechecked after dialogs. Structured failure replies keep internal IPC method names out of product messages.
- [The existing recovery UI](../../../packages/shell/src/features/administration/received-drafts.tsx) adds inbox/archive capacity, export/import, restoration and a separate archived-copy deletion confirmation. It preserves the host modal, table, buttons and styles. Pending outcomes remain visibly uncertain; deletion does not undo server effects or erase protected retry history. Busy state is exposed accessibly.

[User-facing behavior and limits](../../lan-draft-recovery.md) describe retention, file privacy, ownership checks and recovery semantics.

## Verification

| Check | Evidence |
| --- | --- |
| Full regression | 365 unit/PostgreSQL tests across 72 files passed on an isolated migrated/seeded database. Includes interrupted moves in both directions, reconstruction/retry without duplicate server effects, invalid owned files, untrusted acceptance claims, corrupt/foreign files, cancellation, revoked/stale dialog authority, explicit deletion, count/byte capacity and full-inbox preservation. `/tmp/gabs-lan-life-full.log`. The only subsequent product change exposes the existing busy state as `aria-busy`; final native/build checks cover it. |
| Focused transport/recovery | 24 focused checks passed during implementation; the final full regression includes them and final restore-interruption coverage. `/tmp/gabs-lan-life-unit.log`. |
| Strict checks and builds | Final root/browser/node/preload/worker type checks, boundaries/copy checks and all four builds passed. `/tmp/gabs-lan-life-build-complete.log`. |
| Hidden native recovery | Real TLS receipt, real API commit with lost response, archive before process shutdown, reauthentication, restore, same-ID retry, exactly three records and three creation audits, dependency order, conflicts and permission denial. Real main-process file writes/reads verify export ownership, mode 0600, foreign-file rejection, delete/cancel/import and preservation of a protected rejected outcome. Full inbox rejects overflow; archiving frees a slot; restore into a full inbox preserves the archived copy. Final affected rerun passed. `/tmp/gabs-lan-life-native-complete.log`. |
| Native regressions | Scoped SDK relay/revocation and independent executable package transfer/restart/installation both passed with the recovery journey in the prior combined run. `/tmp/gabs-lan-life-native2.log`. |
| Browser regression | Headless Settings keyboard selection, dismissal/focus restoration and narrow layout passed. `/tmp/gabs-lan-life-browser.log`. |
| UI review | Scoped Axe passed for the recovery dialog. Inspected [wide detail](native.png), [narrow detail](narrow.png), [receipt list](receipts.png), [deletion confirmation](delete.png) and [full-inbox error](full.png). Narrow overflow assertion passed. Keyboard-triggered export and hidden/unfocused window assertions passed. |

All desktop windows stayed hidden/minimized and unfocused. Save/open dialogs were controlled by the test; IPC, permission checks, filesystem I/O, encrypted storage, TLS and server effects were real. Development identity and loopback certificates are not production-provider or deployment-network acceptance. Existing historical native-LAN captures were restored instead of being overwritten.

Review found and corrected an internal IPC prefix in the capacity error. Two native runs also exposed test synchronization assumptions: a peer retry occurred before the archive move completed, and a review helper waited for a busy Back button that was about to be removed. Tests now wait for actual capacity and the accessible idle state. Budgets were not relaxed; final affected acceptance passed.

## Remaining required gates

- Dependencies already accepted on another device and reconciliation when the authoring module release is inactive.
- Broader employee/delegated authority and offline recovery/relay authorization.
- Peer-list exchange, bounded distributed scan coordination and deployment/partition/platform acceptance.
- Explicit sign-out/profile-removal retention and recovery under OFF-03/identity work. This milestone covers restart plus reauthentication, not that broader lifecycle.
- Production identity, certificate lifecycle and whole-product UI/accessibility acceptance.

These remain required, not silently deferred. The separate UI-refinement goal is still queued until full parity.

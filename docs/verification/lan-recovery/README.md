# Received LAN draft recovery

18 September 2026. **SDK-05-LAN-REC is locally verified within the scope below. SDK-05, OPS-01 and full parity remain open.**

## Implemented workflow

An administrator signed into the receiving account can open **Settings → Local network → Received drafts**, review a draft and explicitly submit it. Transport receipt alone never submits anything. The list distinguishes received, pending, accepted, rejected, conflict and invalid data; rejected/conflicting work does not prevent another available draft from being submitted.

- [`pendingRelay`](../../../packages/sdk/src/contracts/relay.ts) provides a public SDK helper and shared runtime schema for durable journal entries. It preserves request identity, account, workspace, exact module version, dependencies and base versions, while removing claimed outcomes and resetting transport attempt metadata. Superseded/non-pending entries, self-dependencies, invalid retry IDs, excessive nesting and oversized payloads are rejected. Independent client builds allow this portable SDK import.
- [Main-owned recovery](../../../apps/desktop/src/main/lan/recovery.ts) reads protected quarantine. It verifies current administrator authority, account/workspace ownership, digest-bound selection, dependency receipts and the currently authorized signed module release. Only declared `queued` resource mutations or operations may be submitted. Schema checks precede dispatch; server permissions and business rules remain authoritative.
- An encrypted pending receipt is persisted before dispatch. The original idempotency key is reused after an uncertain response or process restart. Only a successful, schema-valid server response records acceptance. Known server denials and version conflicts remain visible. No received claim of prior acceptance is trusted.
- Accepted receipts can be dismissed without deleting business data or dependency acknowledgements. Unconfirmed receipts are retained. Authentication transitions cancel stale recovery contexts.
- [The review UI](../../../packages/shell/src/features/administration/received-drafts.tsx) uses the existing modal, table and button components. List and detail views are separate, draft previews distinguish records, and the detail view exposes values before submission. No global styles or existing visual design were changed.

## Executed checks

| Check | Result and evidence |
| --- | --- |
| Full regression before final input-bound review | 351 unit/PostgreSQL tests across 71 files passed in an isolated migrated database. `/tmp/gabs-lan-recovery-unit-full.log`. |
| Final focused checks | 12 transport/session/recovery tests passed after input-depth hardening. Includes uncertain-response retry after reconstruction, dependency order, unrelated progress, corrupt signatures, foreign ownership, claimed acceptance, online-only policy denial, queued custom operations, stale profiles and malformed-input isolation. `/tmp/gabs-lan-recovery-guard.log`. |
| Final strict checks and builds | Root and browser/node/preload/worker types, boundaries, copy checks and all four builds passed. `/tmp/gabs-lan-recovery-build-complete.log`. |
| Hidden Electron recovery | Signed independent module; real mutual TLS; encrypted receipts; keyboard submission; loss of the real API response after commit; process restart and reauthentication; idempotent retry; prerequisite order; conflict/rejection visibility; unrelated progress; current permission revocation; accepted-receipt dismissal. Final reviewed rerun passed. `/tmp/gabs-lan-recovery-native-complete.log`. |
| Native LAN regression | The existing scoped transport/relay journey passed with the public helper used in its independently built view. `/tmp/gabs-lan-recovery-native-reviewed.log`. |
| Headless browser regression | Existing public host export and undeclared/revoked/foreign-request rejection passed. `/tmp/gabs-lan-recovery-browser.log`. |
| UI and accessibility | Scoped Axe passed. [Wide review](native.png), [narrow review](narrow.png) and [receipt list](receipts.png) were inspected. The narrow dialog has no horizontal overflow. Hidden/unfocused assertions passed; no foreground windows or OS notifications were used. |

The native test verifies three business records and exactly three creation audit entries despite the lost-response retry. The transport is real loopback TLS and persistence is the native encrypted utility store. Development identity and a controlled response-loss hook are test harnesses, not real-provider or deployment-network acceptance.

The first native run exposed a harness assumption: this development profile requires sign-in after restart. The test now reauthenticates rather than assuming an existing session. A later fixture build caught the missing public-client allowlist entry for the new SDK helper; the allowlist was corrected and actual independent builds passed. Visual review then replaced a crowded combined list/detail layout. Final input-bound review added the nested-data regression and another strict build/native run. Unrelated historical regression screenshots were restored.

## Remaining required work

- Verified received-package reuse by the normal installation path; artifacts currently remain quarantined.
- Full receipt lifecycle: safe recovery/export/discard of invalid and unconfirmed work, capacity/retention management, dependencies already accepted on another device, and reconciliation after the active module version changes. Current submission requires the exact authoring version to be active; absent dependency receipts wait explicitly.
- Broader employee/delegated LAN authority. This acceptance covers the currently implemented same-account administrator recovery path.
- Offline enablement/relay authority, peer-list exchange, distributed scan coordination, partition behavior and supported-platform/deployment certificate acceptance.
- Sign-out/profile-removal retention and recovery remain OFF-03/ID work. This milestone proves process restart plus reauthentication, not preservation through explicit sign-out, which still purges workspace cache.

No requirement above is deferred or treated as configuration-only. The separately authorized UI-refinement goal remains queued until full parity.

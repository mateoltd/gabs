# Role editing concurrency and retry recovery

Scope: **GOV-01**, **ORG-003** and **PERM-001/PERM-002**. This verifies authoritative direct role edits in People and the central matrix. Invitation pagination, broader employee administration and actual provider/platform acceptance remain open.

## Contract and ownership

The canonical `RoleCreateSchema`, `RoleEditSchema` and `RoleDetailsSchema` live in platform contracts. Role reads and creation/edit responses include an opaque revision. Member summaries retain their existing basic role shape. The SDK platform-state role used by the matrix also carries the revision. Generated API declarations and all repository role-edit callers are updated.

Role PUT requires the displayed revision and an idempotency key. Older calls without these preconditions fail instead of overwriting newer permissions. Creation keeps its existing input schema and retry-key requirement. Revisions hash workspace/role identity, name, protected status and sorted distinct direct permission identifiers. They describe editable state, not authorization or a monotonic event sequence; returning to identical fields returns the same revision. Inheritance and organization policy retain their independent versions and current-server validation.

`server/governance/roles.ts` owns listing, revision construction, creation and editing. It replaces role SQL in the API and the broad workspace service. Current authorization is checked under the workspace lock; role edits also lock the target row. Related role state, audit and idempotency receipt commit atomically. Replayed creation/edit receipts wait behind writers and reauthorize after the receipt lock. Protected roles, reserved names, registered business permissions and workspace isolation remain enforced.

## User behavior

People keeps its unsaved name and permission choices on conflict. Reload current permissions explicitly replaces them with the server state and restores focus to Role name after the fields are enabled. An unchanged uncertain submission retains its original retry key; inputs are disabled while saving. Plain retry guidance distinguishes an unconfirmed result from a server rejection.

The central matrix keeps an uncertain attempt with its exact body and key. Its review region offers an unchanged retry or fresh role reload; a stale revision requires reload and deliberate review. It never silently reapplies a toggle to a newer role or reports a rejected change as accepted. Reload returns focus to the matrix after its controls are ready. Platform-only permission controls remain read-only, matching the server rule that custom roles grant business permissions only. Organization drafts remain owned by the existing dirty-state guard while role data refreshes.

## Verification

Five new PostgreSQL cases cover true competing writes, exact replay after later changes, mismatched retry input, missing/forged/foreign preconditions, protected roles and invalid grants, changes by another writer, canonical ordering and current authority after reads/create/edit/replay waits. Receipt tests cover both receipt-lock and workspace-lock waiting. Privileged membership changes isolate revocation timing; they do not prove an end-user ability to remove the final administrator.

The browser/native journey exercises a real concurrent API edit against the open People draft, deliberate reload/focus, actual committed-response loss and exact retry, a conflicting matrix edit, matrix response loss/retry and persisted state after reload. Audit counts remain singular. Scoped Axe A/AA, narrow-page overflow and native hidden/minimized/unfocused checks accompany the journeys.

The initial browser run caught focus restoration happening while the input was disabled. Focus is now restored after the busy state is committed. The rerun passes. This is an observed UI defect and correction, not a relaxed test expectation.

These local development-authentication checks do not establish actual identity providers, signed releases, whole-product accessibility, final UI polish or full parity.

## Verification results

- **17 focused tests** across role, member and invitation editing passed: `/tmp/gabs-role-focused.log`.
- **1,034 regression tests across 136 files** passed before the final matrix focus/read-only-control adjustment: `/tmp/gabs-role-regression.log`.
- Final strict root/browser/Node/preload/worker checks, dependency/copy checks and **all four fresh builds** passed: `/tmp/gabs-role-final-build.log`. Existing bundle-size warnings remain.
- **Six distinct affected browser-suite cases** passed on the final production source, comprising five headless browser cases and one hidden/minimized desktop restoration case. The combined run passed five of six; its role case used an obsolete role-name selector after an authorized live refresh. The corrected selector passed separately without weakening permission or conflict assertions. Logs: `/tmp/gabs-role-final-browser.log` and `/tmp/gabs-role-final-role-browser.log`.
- **Three final hidden/minimized native cases** passed: role editing, capability review and combined 500-role organization scale. `/tmp/gabs-role-final-native.log`.
- All **eight role-edit captures** were inspected. Scoped Axe, narrow-page overflow, People/matrix focus recovery and native window-state assertions pass. Historical captures were restored and isolated test databases removed.
- Source formatting, diff whitespace and local documentation links pass. The ledger retains all 29 original requirement IDs and the tracker all 106 IDs. No database migration or visual style change is introduced.

## Captures

| Client  | People conflict                         | Narrow retry                             | Matrix conflict                         | Accepted matrix                         |
| ------- | --------------------------------------- | ---------------------------------------- | --------------------------------------- | --------------------------------------- |
| Web     | [Conflict](web-people-conflict.png)     | [Retry](web-people-retry-narrow.png)     | [Conflict](web-matrix-conflict.png)     | [Accepted](web-matrix-accepted.png)     |
| Desktop | [Conflict](desktop-people-conflict.png) | [Retry](desktop-people-retry-narrow.png) | [Conflict](desktop-matrix-conflict.png) | [Accepted](desktop-matrix-accepted.png) |

# Invitation authority and retry recovery

Scope: **GOV-01**, **ORG-001/ORG-003** and supporting **PERM-001**. Invitation creation, acceptance, decline and revocation retain authoritative server validation. Broader role editing, invitation-list pagination and provider/platform acceptance remain open.

## Checkpoint and ownership

Checkpoint `99f6309` and annotated tag `checkpoint/invitation-architecture-2026-09-21` preserve the unfinished implementation before the requested Sol xhigh delegation and independent parent review. The physical `sdk`, `client`, `server`, `shell`, `ui/web`, `ui/tokens` and outer `composition` hierarchy already exists and remains intact.

Invitation rules now live together in `packages/server/src/governance/invitations.ts`, extracted from the broad workspace service and inline API revocation handler. The API owns HTTP and transaction orchestration; governance owns invitation authority and state changes; the shell owns form state and retry guidance. Existing public root exports and wire schemas remain compatible. No additional package, database migration or UI style change is introduced.

## Behavior

Acceptance, decline and revocation share the workspace transaction lock. Competing acceptance and revocation cannot both succeed. Creation and revocation recheck current administrator authority after waiting; creation receipts also recheck current authority after their receipt lock, including the Owner restriction for ownership invitations. State, membership, policy assignment and audit effects stay atomic.

Repeated revocation or decline acknowledges the already applied transition without duplicate audit. Retrying an old revoked invitation never revokes a newly created invitation for the same email. Acceptance replay still checks active membership. Ownership restrictions, workspace scope, verified email and account matching remain enforced.

The invitation form preserves its details and retry key after an uncertain reply. Inputs remain disabled while saving. Transport failures show an uncertain-result explanation and retry instructions; they do not claim rejection or expose Electron IPC internals. Server business errors retain their explanations.

## Verification

The failing-before PostgreSQL reproduction returned success from both acceptance and revocation; duplicate revocation also failed instead of acknowledging its original result. `/tmp/gabs-invitation-before.log` records both failures. The initial implementation then passed 31 focused integration tests across invitation transitions, module policies and existing platform behavior (`/tmp/gabs-invitation-transitions-integration.log`).

The shared web/native journey loses an actual successful server response after creation and revocation, retries through the interface, verifies exact creation keys and singular audit records, reloads persisted state, creates a replacement invitation and proves the old ID cannot affect it. It includes scoped Axe A/AA and narrow-viewport checks. Native checks assert all windows are hidden/minimized and unfocused. No invitation email is sent.

The delegate added and the parent reviewed a typed replay callback for operation-specific authority. The shared service validator requires a fresh authorized context under the workspace lock. Its root export is additive; existing public exports and wire contracts remain compatible. The new owner-demotion regression covers both receipt-lock and workspace-lock waits. Controlled privileged SQL demotion isolates the concurrency case; it does not establish an end-user ability to remove the final owner.

These are local development-authentication checks, not actual identity/provider, signed-release, whole-product accessibility or final UI-polish acceptance.

## Final review verification

Verified locally on 21 September 2026:

- **26 focused tests** across invitation transitions, member access and architecture boundaries passed. `/tmp/gabs-invitation-review-focused.log`.
- **1,029 regression tests across 135 files** passed on the reviewed source. `/tmp/gabs-invitation-review-regression.log`. The isolated database was removed.
- Strict root/browser/Node/preload/worker checks, dependency/copy checks and **all four fresh build targets** passed. `/tmp/gabs-invitation-review-build.log`. Existing bundle-size warnings remain.
- The six invitation cases cover racing acceptance/revocation in both orders, duplicate revoke/decline, replacement identity, create/revoke/replay authority after waits, ownership demotion after both receipt/workspace waits, unverified accept/decline and foreign workspace/account refusal.
- **Two final headless browser and two final hidden/minimized native journeys** passed after the server review: invitation retries and the shared member-edit retry regression. Logs: `/tmp/gabs-invitation-review-browser.log` and `/tmp/gabs-invitation-review-desktop.log`.
- All **six final invitation captures** were inspected. Scoped Axe and narrow-page overflow assertions pass; the narrow status column is verified reachable inside the existing horizontal table. Native windows remain unfocused and hidden/minimized. Historical member captures are unchanged.
- Source formatting, whitespace and documentation links pass. All 29 original ledger requirements and 106 tracker IDs are preserved. Test databases were removed.
- Parent reviewed all production changes and the delegate's authority correction. No style declarations, signed artifacts, wire schemas or database migrations changed.

## Captures

| Client  | Creation retry             | Narrow revoked state                 | Replacement invitation                 |
| ------- | -------------------------- | ------------------------------------ | -------------------------------------- |
| Web     | [Retry](web-retry.png)     | [Narrow](web-revoked-narrow.png)     | [Replacement](web-replacement.png)     |
| Desktop | [Retry](desktop-retry.png) | [Narrow](desktop-revoked-narrow.png) | [Replacement](desktop-replacement.png) |

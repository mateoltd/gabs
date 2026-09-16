# Explicit client release policies

16 September 2026. EXT-05 remains active; this is a local engineering milestone, not complete rollout or release acceptance.

## Implemented behavior

Administrators can require the selected release or explicitly accept up to ten additional signed releases in the existing module configuration dialog. The server validates stored-schema compatibility, current configuration, selected dependencies, declared service contracts and the exact staged backend before accepting a policy. Configuration, pin and migration changes roll back when they would invalidate an active, explicitly supported client contract.

Identified clients dispatch through their exact accepted contract. Current workspace authorization and permissions still apply before execution or saved receipt replay. Mandatory policies reject old and unidentified generic callers; changing the release on an existing operation key does not create a valid retry. Legacy host-owned business routes check their actual compiled contract, irrespective of a caller-supplied version header. Historical pin settings without an explicit accepted-version list retain the legacy request protocol.

An optional update preserves a verified older installation only while the policy explicitly accepts it. The administrator can request an update through the existing device installation controls. Opening a newly installed module immediately refreshes its administration receipt, without waiting for the rest of the background catalog. Generated views use the verified installed definition; query and durable page/reference caches are release-specific. Same-module reference lookups use that installed version, and cross-module lookups identify the current workspace-selected provider.

Queued requests retain the original release and request identity. Rejection after a mandatory update is visible and survives reload. Explicit review creates a new request under the current contract and records which original entry it supersedes; it does not relabel or silently discard the old request. Existing offline leases bound disconnected access. These controls do not promise immediate revocation on an unreachable device.

## Acceptance evidence

- `tests/module-rollout.test.ts`: mixed Inventory 1.1/1.2 dispatch, missing operations in the older contract, invalid policies, receipt replay, mandatory rejection, attempted version relabeling, actual host-route contract checks and suspension.
- `tests/module-migrations.test.ts`: a forward migration rolls back while an accepted old client cannot read the target schema; a compatible accepted client allows the migration.
- `tests/e2e/module-rollout.spec.ts`: real signed two-release fixture, optional-policy controls, old installed form retention, durable offline capture, mandatory rejection after reconnect, reload, explicit review and exactly one server record. The original journal identity remains intact.
- `tests/e2e/platform.spec.ts`: generated Contacts and Projects under explicit mandatory policies, including cross-module contact references, same-module project references and member selection.
- Browser screenshots: [optional policy](optional-policy.png), [narrow policy](narrow-policy.png), [preserved conflict](preserved-conflict.png), [narrow conflict](narrow-conflict.png). Visual inspection checks the existing components and layout; it does not establish final UI approval.

All 76 unit/PostgreSQL tests, type/boundary/copy checks, four builds, formatting and 16 focused Chromium journeys passed. The final browser run includes independent executable loading, activation, migration, interrupted installation, generated business forms, references, offline edits, uncertain ordinary retries, structured addresses, notifications and all high-contrast archetypes. The new policy dialog has zero detected Axe WCAG A/AA violations, and its wide/narrow policy and queued-conflict screenshots were visually inspected.

Verification found and corrected two product issues: reference calls omitted release identity under strict policies, and administration could show stale installation receipts until an entire growing catalog completed. Final browser coverage also explicitly sets the cross-module grant needed by the new Contacts/Projects assertion, and waits for durable offline snapshot storage before reloading. Existing test assertions for permissions, receipts, data preservation and effects were retained.

All six existing Electron journeys passed against the rebuilt desktop: capability boundaries, production authentication configuration, independently signed executable modules, shared lists, full-process installation recovery and reconciled screens. These are desktop regressions, not the still-open native mixed-version rollout acceptance.

## Still open

Device-wide rollout progress, partial-failure telemetry, connected emergency suspension delivery and native mixed-version update acceptance remain EXT-05 work. Safe handoff for an arbitrary active unsaved editor also needs explicit verification: installation changes remount views, and existing durable draft recovery depends on offline storage being enabled. This journey verifies a saved queued edit, not every unsaved editor state. Recovery of an old request that the server already accepted but whose reply was lost before a mandatory update also remains to be verified (OFF-03); the current proof covers an old request rejected before any effect. Hosted registry trust rotation, signed installed releases and provider-backed production acceptance remain separate gates.

OPS-07 remains open. Remote runs `35087408586` and `35087635112` missed the unchanged read budget at 678 ms and 689 ms, respectively; the latter passed confirmation at 698 ms and restore. The new legacy rollout boundary performs an additional policy lookup; this milestone makes no performance-acceptance claim.

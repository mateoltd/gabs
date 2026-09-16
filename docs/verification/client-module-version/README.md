# Module request release identity

16 September 2026. EXT-05 foundation only; mixed-version rollout acceptance remains open.

## Behavior

- `createModuleClient` carries its signed definition version on resource and operation calls. Generated forms do the same. HTTP and bounded Electron transport send `X-Module-Version`; OpenAPI documents it.
- The persistent journal retains the original version and idempotency key across offline capture, reload and reconnect. Retrying does not silently relabel old work with a newly installed contract.
- Current server dispatch requires supplied versions to equal the workspace-selected release. Current authentication, permissions, entitlements, schema checks and module readiness remain authoritative. Mismatches return module-specific `409 MODULE_UPDATE_REQUIRED` before business writes or receipt replay; they do not trigger Electron's whole-application update lock.
- Versioned mutation hashes include the contract version. Legacy unversioned requests keep their original hash so existing uncertain retries remain valid. Unversioned requests still use the workspace contract; this compatibility path is not a mandatory-update enforcement policy.
- Resource execution within a scoped module operation uses that operation's resolved contract. Cross-module calls still require existing explicit grants and matching public contracts.

## Verification

- 72 unit/PostgreSQL tests in 14 files passed, plus type, boundary and copy checks. Coverage includes inferred client calls, malformed native envelopes, stale resource/operation requests, authorization, exact receipt replay and rejecting version changes on an existing key.
- The member-directory route also checks release identity; its focused PostgreSQL suite verifies current success and stale rejection.
- All 14 selected Chromium journeys passed: generated resources, persistent offline capture/reload/reconnect, independent signed client/server modules, migration, installation recovery and related platform flows. The journal test asserts the actual persisted version and the actual retried network header/key.
- All six distinct Electron journeys passed, including a focused rerun after replacing shared mutable workspace state with a fresh provisioned company in the boundary fixture. Native stale requests fail, current requests succeed and the application remains unlocked.
- All four application builds and formatting passed. This change does not redesign the interface; historical visual evidence remains preserved.

## Remaining

Explicit accepted-client release sets, safe mixed-version dispatch, mandatory/optional rollout policy, administrator controls, per-device partial-failure visibility and connected emergency-suspension delivery remain unfinished. Schema/backend compatibility, current authorization and offline lease limits must govern these policies. Queued stale work must remain recoverable without silently changing its original contract.

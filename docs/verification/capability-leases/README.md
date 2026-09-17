# Corporate capability lease authority

17 September 2026. SDK-05 remains active. The authority milestone has scoped local acceptance; offline client integration remains unfinished.

## Implemented

- [Typed contracts and browser-compatible signature verifier](../../../packages/sdk/src/contracts/capability-leases.ts), explicit signed offline declarations and generated capability reference documentation.
- [Separate online lease signing authority](../../../packages/server/src/identity/capability-leases.ts), configured by `CAPABILITY_LEASE_PRIVATE_KEY` rather than the module-publication private key.
- Authenticated issuance and public-key endpoints, current actor/module/version/permission/allowance checks, repeatable-read policy snapshots, idempotent audited issuance and rejection of stale-policy/time/key receipt reuse.
- [Unit verifier coverage](../../../tests/unit/capability-leases.test.ts) and [PostgreSQL/API acceptance](../../../tests/integration/capability-leases.test.ts) for scope, signature, expiry, authority, replay, audit count, shortened/disabled access and key rotation.

## Evidence and pending verification

- Initial verifier and PostgreSQL/API tests passed: 2 tests across 2 files. This precedes the final rejection of stale-policy/time/key receipt reuse and the added rotation assertions. Log: `/tmp/gabs-capability-leases-tests-final.log`.
- The first attempt exposed unsupported UUID format registration in the shared TypeBox validator; explicit UUID patterns fixed the contract without changing shared validation behavior.
- Strict TypeScript checks, environment/architecture/copy checks and all four builds pass on the hardened source. Log: `/tmp/gabs-capability-leases-build-accepted.log`.
- A first attempt at the final PostgreSQL regression could not start. Its runner was waiting before database creation; a three-second direct PostgreSQL readiness probe timed out, and Docker status also timed out although OrbStack reported running. The waiting runner and its diagnostic process were stopped. No test success or database cleanup is inferred from that interruption.
- PostgreSQL subsequently recovered without an assistant-initiated OrbStack restart. The final hardened verifier/API/host/workspace-policy regression passed **7 tests across 4 files** on a fresh migrated/seeded database, including stale policy and signing-key rotation. Log: `/tmp/gabs-capability-leases-regression-final.log`.
- The database-independent signature/host/local-grant/simulator/documentation suite passed **14 tests across 5 files**. Log: `/tmp/gabs-capability-leases-unit-complete.log`. Counts overlap and are not additive.
- OpenAPI and typed API client declarations were regenerated successfully on a separate fresh database, which was removed afterward. Log: `/tmp/gabs-capability-leases-api-generation-final.log`.

Final combined acceptance after the asynchronous-expiry guard passed **17 tests across 7 files** on a fresh migrated/seeded database. It includes the hardened API, key rotation, workspace policy and SDK declaration/documentation regressions. Log: `/tmp/gabs-capability-leases-acceptance-final.log`. The database was removed after completion. Earlier counts are historical, not additive.

## Remaining implementation

The subsequent [client guard and browser persistence milestone](../client-capability-leases/README.md) verifies account/workspace-scoped storage, grant validation, policy races and clock handling. The later [browser integration](../browser-capability-leases/README.md) now verifies real acquisition/renewal, cached custom views, policy delivery and file exports. Issuer-wide trust propagation across cached workspaces/accounts, then native main-process authority and offline effect verification, remain next. Invalidate on connected policy updates, release/profile changes and expiry. Verify delayed-dialog expiry/revocation, clock handling, profile restart, workspace isolation and read-only offline effects in real web and hidden native journeys. Desktop corporate custom-view actions remain online-only until native integration passes.

The [design contract](../../corporate-capability-leases.md), [SDK-05 map](../../sdk-05-acceptance.md) and parity tracker retain the full scope. Simulation and cryptographic unit tests do not substitute for client/device acceptance.

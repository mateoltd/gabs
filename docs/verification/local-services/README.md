# SDK-05: standalone service transactions

17 September 2026. Explicit local service grants and atomic multi-module execution. SDK-05 remains active for device capabilities, corporate offline host leases and the remaining [acceptance map](../../sdk-05-acceptance.md).

## Behavior

- Existing public `serviceReference` contracts now compose inside local handlers through inferred `service` and `serviceAttempt`. Only public local operations are eligible; invalid aliases, inputs, outputs and corporate service calls fail compilation. The provider receives its installed configuration, the profile and root request identifiers, its immediate caller and its own standalone resource client.
- Profile-owner consent is encrypted and defaults to denied. Grants bind the consumer, alias, provider and both exact releases. Either update requires renewed consent; removal clears related grants while retaining data and historical receipts. Resource-reference access remains separate.
- The worker verifies every participating provider's signed or bundled contract and reviewed local implementation. Execution validates dependency compatibility, copied operation contracts, declared provider permission and the exact grant. Providers cannot access foreign resources directly or acquire corporate/device authority.
- Nested and parallel service calls share one transaction; calls are serialized within each invocation. All participating records and the root receipt commit together. Child receipts are not independently persisted. Caught or detached failures poison the transaction; translated errors retain the consuming module's declared error contract. Recursion, depth above 16 and more than 1000 calls are rejected.
- Authorized reference snapshots observe provider records created by earlier service calls. Mismatched reference/service provider releases are rejected. The host accepts returned records only for participating standalone resources.
- Cancellation, locked/removed profiles and competing revisions prevent partial or stale commits. Recovery uses the saved attempt ID; accepted retry returns the original result without repeating provider writes. New requests recheck current grants. Already accepted historical records/receipts remain available according to existing local profile rules.

## Verification

- Strict TypeScript, boundary/copy checks and all four builds passed (`/tmp/gabs-local-services-build2.log`); final TypeScript checks include the independently typed fixture and nested service proof (`/tmp/gabs-local-services-finaltype.log`).
- **250 unit/PostgreSQL tests across 54 files passed in 69.99 seconds** on a temporary migrated/seeded database (`/tmp/gabs-local-services-full.log`). Six new tests cover serial shared-provider updates, root-only receipts, context propagation, caught/detached failures, translated errors, denied/foreign/stale grants, recursive calls, nested three-module composition and same-transaction reference visibility. Compile-time negative examples reject corporate services and invalid contracts.
- The focused signed browser run passed both new journeys in 31.4 seconds (`/tmp/gabs-local-services-browser2.log`). The worker proof covers interrupted execution, encrypted unlock/retry, exact replay, a rejected root after provider writes, concurrent-window revocation, both update paths, corrupt provider signatures and data-preserving uninstall/reinstall. Broader browser and native regressions are pending.

During test authoring, a recovery fixture incorrectly passed a request key to `retry` instead of locating its saved attempt ID; that was corrected. Pure snapshot comparisons were changed to compare serialized contract data because structured cloning deliberately strips TypeBox symbols. No production validation was weakened.

## Limits

This adds local resource service transactions. Corporate authority, server audit/outbox behavior, standalone device capability brokering, broader identity encryption/recovery, native LAN and release acceptance retain their separate requirements. Worker code is reviewed and trusted; scoped snapshots do not constitute a hostile-publisher sandbox. No production deployment, billing or external messages are part of this milestone. Final UI refinement remains separately queued after feature parity.

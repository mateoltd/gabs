# Simulated queue scheduling

Verified 19 September 2026. Tracker: **OFF-01-SIM**. Requirement mapping: **CORE-003**, typed SDK developer experience and offline correctness.

## Change and ownership

The development simulator previously recorded only explicit prerequisites. Unlike the host, it could submit a later edit after a conflicting earlier edit or submit work referring to a failed provisional create. Exact retries also rejected the same prerequisite set in a different order.

Portable ordering now lives in `packages/sdk/src/runtime/journal/ordering.ts`, exported through `@suite/module-sdk/sync/order`. The client retains a forwarding module for existing host imports. Comparison against the previous client implementation confirms the function bodies are unchanged; only imports and the equivalent account/workspace scope type changed. Both typed simulated capture and offline preview submission use the shared rules before mutating the in-memory journal.

New captures derive same-record and nested schema-reference prerequisites, reject cycles atomically and preserve the originally requested prerequisite list. Exact retry comparison ignores prerequisite order. A blocked dependent stays pending while unrelated work can synchronize. Corporate server validation and durable host storage remain authoritative; simulated captures are development data.

## Verification

- Five focused cases failed on the original implementation after the fixture schema was corrected: same-record conflict ordering, nested references for resource/command capture, atomic cycle rejection, reordered exact retries and preview/typed-queue ordering. Log: `/tmp/gabs-simulation-order-before.log`.
- All five then passed with the existing queue/storage/simulator checks: **109 tests in four files**, `/tmp/gabs-simulation-order-unit.log`.
- Full isolated unit/PostgreSQL regression: **605 tests in 90 files**, `/tmp/gabs-simulation-order-regression.log`. The helper removed its database afterward.
- Strict root/browser/Node/preload/worker type checks, boundary/copy checks and **four fresh production bundles** passed. Logs: `/tmp/gabs-simulation-order-types.log`, `/tmp/gabs-simulation-order-lint.log`, `/tmp/gabs-simulation-order-build.log`. Existing web bundle-size warnings remain.
- **Two headless development-preview journeys** passed: typed command/resource capture and permission rechecks, with resource updates and archive held behind a conflict while an independent record is accepted. Log: `/tmp/gabs-simulation-order-preview.log`.
- **Two headless host journeys** passed for new and legacy same-record ordering, explicit conflict recovery and reload against the real API/PostgreSQL. Log: `/tmp/gabs-simulation-order-host.log`. Historical screenshot artifacts were retained separately from this behavioral regression.

Review verified that imports remain portable, no client-to-SDK dependency cycle was introduced, retry metadata stays immutable and cycle validation runs before journal mutation. The production host uses the same implementation as before; no UI styling or layout changed.

## Limits

This verifies capture scheduling, not complete simulation of historical journals, signed releases, profile recovery or corporate authority. The simulator is still in-memory and is not evidence of crash durability or server correctness. Native collision-outcome acceptance remains separately blocked by unavailable protected storage while the Mac is locked; it was not rerun or bypassed for this change. OFF-01 and overall feature parity remain open.

# SDK-03 cross-module development acceptance

Verified locally: 17 September 2026. This completes SDK-03's development workflow criteria. It does not complete SDK-04/05, the fifth-module release lifecycle or the broader parity goal.

## Observable behavior

- `module dev` and `module test` accept repeatable provider directories without catalog/host edits. Typed `module.simulation.ts` files declare configuration, resource/private-store fixtures and explicit service grants. Every scenario and source rebuild receives fresh state.
- Scoped handlers use namespaced private stores and declared public services. Version/contract mismatches, missing grants and revoked provider permissions fail. Actor, workspace and request IDs propagate across modules; all namespaces, emitted events and simulated audits roll back together on dependent failure. Typed translated business errors remain usable through `client.attempt`.
- Caught and detached failures cannot turn failed transactions into success. Read-only handlers cannot write resources/stores, lock records, emit events/audits or call command services. Retained capabilities close with the operation.
- Store fixtures support UUIDs, versions, archive state, active uniqueness, literal search, containment/ranges, stable sorting/keysets and aggregate limits. Basic/query command schemas are shared with the PostgreSQL host. Simulator cursors are bounded process-local tokens, not server cursors.
- The React preview exposes explicit service grants, provider permissions, provider/private records, events and simulated audit entries. Provider fixture edits rebuild the graph. Tables retain readable identifiers inside named keyboard-focusable horizontal scroll regions.

## Current checks

1. Strict TypeScript, boundary/copy checks, changed-file formatting and `git diff --check` passed. Negative type assertions reject unknown service aliases, grants on modules without services and wrong fixture/inspection field types.
2. **54 tests across eight files passed:** `simulation-services`, `simulation-stores`, `module-simulator`, `module-scenarios`, `module-cli`, `module-stores`, `module-queries`, and `business-sdk`. This includes real PostgreSQL store/query/business regression checks after sharing command schemas. After extending query denial and fixture type coverage, the affected two files passed again with nine tests.
3. Real Orders/Inventory scoped handlers execute drafting, confirmation and fulfillment against provider fixtures; retry receipts do not duplicate effects, insufficient stock rejects, provider state remains isolated and failures roll back. This is development-simulator coverage; actual concurrent database correctness remains the PostgreSQL suite's responsibility.
4. **Three headless Chromium journeys passed**: custom preview/reload, stateful preview/rejection/recovery, and the new provider/grant/fixture journey. The new journey passed again after the table correction, with whole-development-page Axe checks for WCAG A/AA and no horizontal document overflow at 390 pixels. This is not whole-product accessibility certification.
5. The actual `pnpm module dev tests/fixtures/service-preview --dependency tests/fixtures/service-preview/provider` command was launched on an ephemeral loopback port. Its HTTP interface confirmed ready provider fixtures and accepted a granted cross-module write. The owned process was stopped afterward. The automated CLI test runs both module-owned provider scenarios successfully.
6. [Wide](wide.png) and [narrow](narrow.png) captures were visually inspected after the table correction. Historical preview captures were restored. No production application layout or native window behavior changed; no desktop acceptance was required for this developer-only UI.

Local logs: `/tmp/gabs-cross-sim-types.log`, `-lint.log`, `-tests.log`, `-query-tests.log`, `-browser.log`, `-final-browser.log`, and `-format-check.log` share the `/tmp/gabs-cross-sim` prefix.

## SDK-03 acceptance map

| Criterion                                                                        | Evidence                                                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Module-owned scenarios, independent-directory checks and useful type diagnostics | [Scenario milestone](../module-scenarios/README.md), current CLI/provider tests         |
| Custom React preview, public SDK/UI contract and source/fixture reload           | [Preview milestone](../module-preview/README.md), all three current headless journeys   |
| Cross-module fixtures and scoped service/private-store execution                 | Current CLI, simulator, real handler and provider-preview checks above                  |
| Offline and permission simulation remain usable                                  | Current offline preview journey, scenario tests and root/provider revocation assertions |

## Boundaries

The simulator uses trusted author code, in-memory serialized transactions, synthetic identities and development permissions. It is not a security sandbox or proof of real authorization, SQL isolation/collation/decimal behavior, durable offline recovery, leases, migrations, corporate audit retention or native worker execution. Rebuilds intentionally discard simulation state. The main application remains an unapproved engineering UI; its later refinement goal is still queued.

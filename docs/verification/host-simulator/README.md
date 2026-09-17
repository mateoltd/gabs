# SDK-05: typed host capability simulation

17 September 2026. Corporate host capability simulation has local acceptance. SDK-05 remains active for standalone/offline grants, cross-module local access and the remaining [acceptance map](../../sdk-05-acceptance.md).

## Behavior

- `defineSimulationModule` and module-owned scenarios accept inferred `hostResults` for declared aliases. Invalid aliases/results fail compilation and runtime validation. A simulator exposes the same typed `host.call` contract as an installed view and a typed result setter.
- Calls recheck the simulated module/version, declaration, permission and connectivity. Offline corporate host calls reject without entering the business journal. Personal host grants remain explicitly unavailable pending their real contract.
- Fixtures return cloned outcomes without invoking filesystem, notifications or LAN adapters. Results and snapshots are isolated from caller mutations. The latest 100 simulated/rejected observations are retained separately from business records, events and audits; inputs and payloads are omitted.
- The development inspector lets authors configure validated result JSON, reset defaults, review errors and change permissions/connectivity. Invalid edits preserve prior fixtures. Error responses carry current simulation observations without allowing older responses to restore stale permissions. Typed fixture source changes rebuild and reset the simulation.
- Host-only modules show explicit empty contract/resource states. The preview respects `hidden` even when form-control display rules apply. Narrow result tables remain readable in their existing scroll container.

## Verification

- Strict compilation, dependency/copy checks and all four bundles passed (`/tmp/gabs-host-simulator-build2.log`). Five focused host/simulator tests passed before the complete suite.
- **240 unit/PostgreSQL tests across 52 files passed in 55.93 seconds** on a temporary migrated/seeded database (`/tmp/gabs-host-simulator-full.log`). Coverage includes negative inferred fixture contracts, runtime validation, release mismatch, permission revocation, offline rejection, explicit relay outcomes, cloned results, bounded logs and unchanged business effects. Later changes only add the authored CLI scenarios and correct preview empty-state CSS.
- The actual `pnpm module test tests/fixtures/host-capabilities` command checked the independent module's TypeScript/dependencies/fixtures/client bundle and passed **two module-owned scenarios** (`/tmp/gabs-host-simulator-scenarios.log`). Outcomes reset between scenarios; revoked and offline calls reject.
- **Five headless browser journeys passed in 59.3 seconds** (`/tmp/gabs-host-simulator-browser.log`): new host simulation, existing preview rebuild/offline behavior, two public resource-query journeys and actual corporate capability export. After visual corrections, **both affected preview journeys passed in 40.4 seconds** (`/tmp/gabs-host-simulator-browser-final2.log`).
- The new preview journey configures cancellation, rejects an invalid result while preserving the prior fixture, revokes export permission, rejects offline host calls without journaling, simulates peers and rejects undeclared calls. Adding a typed simulation file triggers source reload and supplies a notification outcome. It observes no download and no business audit/event effects. Scoped Axe found no violations in the tested preview.
- Inspected final [wide](wide.png) and [390-pixel](narrow.png) captures. The narrow document has no horizontal overflow; the result table uses its scroll container. The first visual follow-up correctly failed because the preview's existing `display: block` rule overrode the new `hidden` selector. Explicit hidden styling corrected it and the final two journeys passed.

The five hidden/unfocused native journeys in the preceding [corporate capability milestone](../host-capabilities/README.md) verify real native adapters. This simulator milestone changes no native adapter, and its simulated results do not substitute for native/OS acceptance. Browser runs remained headless; temporary databases/development directories were removed, historical captures restored and existing preview/data preserved.

Remaining standalone grants, real LAN receipt/discovery, actual OS notification presentation, corporate offline/profile recovery and full parity retain their original gates. No production deployment, provider action or external message was performed.

Source checkpoint `e2379a1c6e7f665a463c4c9077dcd2b4e1fde22a` / [CI 35194471793](https://github.com/mateoltd/gabs/actions/runs/35194471793) started no jobs. All four ended with zero steps; the verified annotation states that the Actions budget prevents further use. The local results above remain valid, while remote acceptance requires restored account capacity.

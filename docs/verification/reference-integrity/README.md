# Local and simulated reference integrity

17 September 2026. SDK-04 follow-up to [public reference clients](../reference-client/README.md). Node 24.19.0, PostgreSQL 18.6 and macOS arm64.

## Behavior

Local and simulated resource creates/updates previously validated schema shape without checking referenced records. They now validate every present annotated link before changing data, using the same target-access checks as their lookup adapters.

- Local writes resolve active same-module standalone records from the current transaction snapshot. Corporate-only targets, corporate members and cross-module local targets fail explicitly. No corporate or other-profile fallback exists.
- Simulated corporate writes require active records/members, declared compatible providers, explicit read grants and current target read permission. Missing or archived targets fail. Member and user inactivity both reject writes.
- Nested arrays, map values and matching union branches are traversed. Repeated IDs and case variants resolve against one active-ID set per target for each write. Unmatched free-text branches are not treated as links.
- Targets created earlier within an operation can be referenced by later writes. A rejected reference rolls back preceding writes even when a handler catches the error. Local failures return no new snapshot/receipt for the host to commit; simulated failures restore records and audit effects.
- Failed edits preserve the previous record/version. A failed request does not consume its retry key. An exact retry of a previously accepted request returns its saved result even if a target has since been archived; no duplicate record or audit effect is created.
- Offline simulation captures provisional work. Reconnection rejects invalid references and accepts unrelated queued records. A lookup result cannot authorize a later write after access changes.

## Verification

- Full unit/PostgreSQL suite: **201 tests, 41 files**, 91.74 seconds.
- Focused reference, simulator and actual local-worker checks: **18 tests, four files**, 946 ms.
- Strict TypeScript, dependency/copy checks and all four production builds passed.
- **Three headless browser journeys passed**, 35.6 seconds including setup: independent installed custom/local forms, development reference denial and existing provider-service preview.
- **One minimized/unfocused Electron journey passed**, seven seconds including setup, exercising a real worker save, encrypted profile storage and restart recovery.
- The development browser journey revokes the provider read grant after a successful lookup/save, submits again, observes the actual write rejection and verifies retained records are unchanged. [The rejection capture](development-rejection.png) was inspected. Historical screenshots were restored.

Tests: `tests/reference-integrity.test.ts`, `tests/local-worker.test.ts`, `tests/e2e/reference-client-dev.spec.ts`, `tests/e2e/reference-client.spec.ts`, `tests/e2e/module-dev-services.spec.ts`.

Logs: `/tmp/gabs-reference-integrity-tests.log`, `/tmp/gabs-reference-integrity-full.log`, `/tmp/gabs-reference-integrity-build.log`, `/tmp/gabs-reference-integrity-browser.log`, `/tmp/gabs-reference-integrity-native.log`.

## Boundaries

Ordinary edits validate all present references. If a target has been archived, the user must remove or replace that link before editing the record. Archiving a target preserves historical referencing records. Reviewed corporate migrations retain their separate historical-link reconciliation; standalone migration reference reconciliation remains open.

Fixture loading may deliberately seed historical or invalid data for recovery scenarios. It does not count as an accepted business write. Simulator in-memory checks do not establish PostgreSQL authorization, isolation, concurrency, installation state or corporate release acceptance. This change does not add reference semantics to operation inputs or private stores.

Cross-module local capabilities remain SDK-05 work. Tuple/map picker UI, nested/off-page table labels, richer query controls and complete SDK composition remain open. The screenshot is regression evidence, not final UI approval or whole-product accessibility certification. SDK-04 and overall parity remain active.

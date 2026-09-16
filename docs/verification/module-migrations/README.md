# Module storage migration acceptance

16 September 2026. Local PostgreSQL 18.6, Node 24.19.0, macOS arm64. This evidence covers EXT-03's scoped SDK resource migration manager, not full platform parity.

## Verified behavior

`tests/module-migrations.test.ts` publishes signed, reviewed versions 1.0.0, 1.1.0 and 2.0.0 with different stored-schema compatibility ranges. It verifies:

- Resolution keeps compatible code available before migration and switches only after successful schema commit.
- Handler rejection, invalid new references, invalid membership assignments and undeclared cross-module references roll back earlier writes.
- Catching an error inside an outer transaction does not accidentally commit partial migration effects.
- PostgreSQL backend termination after the first write rolls back changes. A concurrent release reader waits for the migration lock and then sees the previous compatible release.
- Concurrent retries apply a step once; pagination transforms more than 100 records. Empty namespaces initialize directly without invented migration history.
- Moving a legacy resource creates validated replacement records and archives, preserves and versions the originals.
- Another workspace and another module remain untouched. Existing historical references to archived records survive.
- Incompatible executable rollback/pins are rejected; compatible old code can run but cannot write data violating the current stored schema.
- A previously authorized context cannot bypass revoked migration permission.

The SDK checks declaration validity and compile-time rejection of missing/unknown migration handlers. Migration 017 enables forced tenant RLS and grants no update/delete privilege on applied-step history. Stored schema versions cannot decrease.

## Real interface

`tests/e2e/module-migration.spec.ts` stages and publishes a resource-only module's signed migration backend. Identity, entitlement, assignment and legacy data are explicit local fixtures; the actual migration and retry use **Modules > Configure** against the compiled API.

The administrator sees the current schema and target release, applies a deliberately failing migration, sees an error with schema 1 retained, retries after fixture correction, and sees schema 2 with the action disabled. Opening the generated module displays the transformed record. The test checks that only one step was recorded, runs Axe on the dialog, and captures wide and 390px layouts. The screenshots were visually inspected.

- [Before migration](before.png)
- [Failure with old schema retained](failure.png)
- [Successful migration](after.png)
- [Narrow layout](narrow.png)

This adds controls within the existing host modal and components. It does not declare the broader UI accepted or begin the later UI-refinement goal.

## Scope and remaining gates

The manager is atomic per workspace migration transaction; it restarts after interruption rather than resuming partial commits. Public capabilities expose only the current module's JSON resource namespace. They do not migrate the existing Orders/Inventory raw SQL bridges, execute arbitrary DDL, delete business data or weaken corporate authority.

Full interrupted installation/update and per-device pinned-client recovery remain EXT-04; mandatory rollout and failure dashboards remain EXT-05/OPS-02. Hosted and signed/notarized target-platform acceptance remain open. The preceding remote CI run at `e5be7b0` passed packaging jobs but failed the unchanged 500 ms read target at 925 ms; confirmation was 699 ms against 1000 ms. Its restore step was skipped after that failure. Local tests do not close that remote gate.

## Final checks

- `pnpm check`: 66 tests in 12 files; TypeScript and boundary/copy checks passed.
- `pnpm test:e2e`: all 58 Chromium journeys passed against the rebuilt API.
- `pnpm test:desktop`: all 5 native Electron journeys passed.
- All four builds and repository formatting passed.
- [Local logical restore](restore.json): business invariants, schema-history consistency and unscoped tenant isolation passed.
- [Local load](load.json): p95 reads 150 ms, confirmation 233 ms, unchanged targets 500/1000 ms. This single local run does not resolve the remote CI failure.

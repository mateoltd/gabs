# Installation and update recovery acceptance

16 September 2026. Local PostgreSQL 18.6, Node 24.19.0, Chromium and native Electron on macOS arm64. This evidence is scoped to EXT-04, not full platform parity.

## Implementation

[Protocol and operator behavior](../../module-lifecycle-recovery.md). Migration 018 adds server receipt identities. Installation/removal attempts and exact release selections persist in the existing account/workspace local store. Downloads verify before staging; server selection, audit and idempotency commit atomically; the local release set switches only after confirmation. Uncertain retries keep their request ID. Removal preserves business data and pending work.

## Failure and correctness evidence

`tests/module-lifecycle.test.ts` runs the real browser-facing installer and `SuiteClient` against the real Fastify/PostgreSQL server with signed reviewed module releases. Its test transport injects delivery failures; a scoped in-memory Platform adapter injects a local save failure. Those faults do not replace server validation or database writes.

It verifies concurrent installer calls, dependency download reuse, interrupted download, a dropped response after server commit, a failed local commit, stable request identity and a single audit effect across retries. It rejects corrupted artifacts and policy changes during repair, checks compatible downgrade, suspension on receipt replay, pending-removal runtime denial, data-preserving removal/reinstall and superseded install/removal receipts. Dependency removal uses the installed older manifest even after a new dependency-free version is published.

Existing resolver/distribution/server-release tests cover incompatible host/backend/dependency ranges, invalid signatures, unavailable releases and reviewed backend staging. The [migration evidence](../module-migrations/README.md) covers failed/interrupted schema migration and safe old executables. The migration browser journey now also attempts an incompatible pin after schema upgrade, verifies the visible rejection and confirms no invalid setting committed: [rejected pin](../module-migrations/incompatible-pin.png).

`tests/module-artifact-storage.test.ts` reproduces the former 2 MiB desktop-record ceiling with four 900 KB executable fixtures. It verifies bounded writes, shared installed/download bytes, migration from an inline record, failed chunk writes, failed metadata commits, orphan collection, corrupt/missing artifact recovery, workspace isolation and retained drafts. The native boundary journey rejects traversal keys, business-data keys in artifact pruning, another profile’s scope and oversized writes.

Acceptance initially exposed the actual native catalog-size failure, a stale recovery click issuing a second repair, and duplicate global/card errors. The implementation was corrected rather than weakening the one-effect or visible-error assertions. Concurrent removal resumption and a dependency’s uncertain receipt surviving installation of a dependent are also covered by the lifecycle integration test.

## Actual interfaces and persistence

`tests/e2e/module-recovery.spec.ts` creates a contact through the generated interface, drops an actual repair response after server commit, reloads the page, observes the persisted request, and resumes through Modules. It verifies one audit effect, dependency-removal rejection, removal/reinstall and the retained contact. The recovery card passes its scoped Axe scan. Wide/narrow screenshots were inspected, and successful recovery leaves no stale error banner.

- [Pending confirmation](pending.png)
- [390px recovery controls](pending-narrow.png)
- [Recovered business record](recovered.png)

`tests/desktop/module-recovery.spec.ts` injects connection loss in the real Electron main process after server acceptance. The renderer continues to use the production bounded IPC and utility-process persistence. The test closes Electron completely, launches it again with the same temporary profile, verifies the retained request ID, resumes, and checks that the server recorded one effect. [Recovered native interface](electron-recovered.png).

## Verification discipline

One intermediate browser run passed 58 journeys and failed its background-install inventory assertion because unit integration tests were run concurrently against the same local database. Those tests publish and then remove temporary releases; the browser had observed their assignments before removal. The final acceptance run uses unit checks first, then a fresh API process, then browser, desktop, restore and load sequentially. The inventory assertion remains unchanged.

## Final local checks

- `pnpm check`: 68 tests in 14 files passed, with type and boundary/copy checks.
- `pnpm build`: all four builds passed. `pnpm format:check` passed.
- `pnpm test:e2e`: all 59 Chromium journeys passed in the isolated run.
- `pnpm test:desktop`: all 6 native Electron journeys passed, including the new IPC limits and full-process installation recovery.
- `pnpm test:restore`: [local logical restore](restore.json) passed its stock, reservation, ledger, module-schema history and tenant-isolation checks.
- `pnpm test:load`: [local p95](load.json) was 162 ms for reads and 183 ms for confirmation, below the unchanged 500/1,000 ms budgets.

Visual inspection also corrected misleading cancellation copy: background query cancellation can pause an installation without the user switching workspaces. The final recovery message says the installation paused and identifies the resume action. The focused recovery journey was rerun after that text correction.

## Remaining acceptance

Mandatory/optional rollout, complete mixed pinned-client compatibility, pushed suspension and aggregate lifecycle dashboards remain EXT-05/GOV-04/OPS-02. There is no permanent business-data purge UI in this milestone; uninstall only preserves data. That separate administrator action remains tracked. The native fixture with many assigned modules also reinforces the existing UI-03 need for scalable named navigation; the current icon rail is not accepted as the final visual design. Trust rotation and hosted delivery remain EXT-06. Signed/notarized packaged installation/update across supported target machines remains OPS-04. Record payload encryption remains the current desktop implementation; full-file encryption is still ID-03.

Remote CI at `101ff85` completed but failed the unchanged read-latency gate at 952 ms against 500 ms. Confirmation was 720 ms against 1000 ms; restore was skipped after load failed. Local recovery evidence does not close that remote performance gate or establish overall UI acceptance.

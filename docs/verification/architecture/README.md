# Architecture reconciliation verification

Status: locally accepted on 17 September 2026.

## Scope

This evidence covers ARCH-01 through ARCH-06 in the [architecture reconciliation](../../architecture-reconciliation.md). It verifies physical ownership, dependency direction, environment separation, generated-contract continuity and unchanged visual sources. It does not claim full product parity, production release acceptance or final UI approval.

## Static evidence

- Reusable contracts, SDK, client, server and shell sources do not import product composition or concrete bundled modules.
- Host assembly injects explicit catalog, runtime and shell composition objects. Server consumers use the read-only catalog capability; registration remains in application composition.
- The only direct Orders-to-Inventory implementation edge is the exact legacy adapter retained for version-1 signed compatibility.
- The generalized checker covers workspace discovery, public exports, declared dependencies, relative and package imports, type-only imports, CSS imports, cycles, layer direction and transitive browser/worker/Node environments.
- Six integration fixtures cover negative and positive boundary cases. Seven independent adversarial probes also passed; their bounded local log is `/tmp/gabs-boundary-review.log`.
- OpenAPI JSON, generated API declarations and generated token values are byte-identical to checkpoint `69aa1a3` after regeneration.
- Eight baseline CSS files are byte-identical at their new paths. The ninth changes only four import URLs in their original order. No geometry, color, motion or typography declaration changed.
- All 16 named component function bodies extracted from the former UI index are TypeScript-AST equivalent to the checkpoint implementations. The UI package index is now an export surface.
- Desktop external output paths remain `dist/main.cjs`, `dist/preload.cjs`, `dist/cache-worker.cjs` and `dist/renderer`.
- Frozen installation discovers 17 workspaces from the lockfile. Obsolete generated `node_modules` trees at the former `packages/api-client` and `packages/platform` paths were removed after verifying they contained no authored or untracked files.

## Commands and results

| Check                                                                    | Result                                                                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                             | Passed strict TypeScript, browser/Node/preload/worker environments, generalized boundaries, copy checks and all four production bundles.                    |
| `pnpm exec vitest run tests/integration/architecture-boundaries.test.ts` | 6/6 passed. Seven independent adversarial checker probes also passed.                                                                                       |
| Fresh migrated/seeded PostgreSQL full unit run                           | 257/257 passed across 56 files.                                                                                                                             |
| Focused module CLI, discovery, distribution and review run               | 5/5 passed across four files, including generated-dependency add/remove reconciliation.                                                                     |
| External module without a `tsconfig.json`                                | Passed direct `checkModuleSources` proof using the repository fallback configuration; log `/tmp/gabs-external-module-tsconfig-fallback.log`.                |
| Headless Chromium broad run                                              | 99/111 passed; all 12 failures were stale worker-entry routes in test harnesses. The repaired 12 cases passed in the next focused run.                      |
| Headless Chromium focused and repeated runs                              | 31/32 passed after route repair; the remaining intermittent closed-Select Axe failure was corrected, then 36/36 passed across three repeated affected runs. |
| Minimized Electron selected run                                          | 10/13 passed initially. The three migrated fixture/worker-name failures were corrected; the focused rerun passed 4/4, including both boundary cases.        |
| `pnpm install --frozen-lockfile`                                         | Passed against all 17 workspace projects with no lockfile update.                                                                                           |
| `pnpm generate:api && pnpm generate:tokens`                              | Passed; OpenAPI JSON, generated API declarations and token values match checkpoint `69aa1a3` byte-for-byte.                                                 |

The browser and native results are cumulative repair evidence. They do not claim a later uninterrupted 111-case browser run or 13-case native run. All failures in those broad runs were reproduced, diagnosed and covered by passing affected reruns. No additional remote CI rerun was requested for this migration, and no successful remote verification is claimed; the pushed checkpoint's jobs remain subject to the known Actions budget and artifact-quota blockers.

## Visual continuity

The [architecture screenshots](screenshots/) preserve light, dark, 390-pixel and 768-pixel People/Inventory states, wide/narrow local-service consent, the minimized native consent flow and restored native suspension. Review found consistent shell structure, typography, controls and bounded responsive tables, with no architecture-induced clipping or structural regression. This is continuity evidence, not approval of the interface as final design polish. Historical screenshot artifacts were restored to their checkpoint bytes after the acceptance runs.

The only UI behavior correction in this pass applies `aria-hidden` and `inert` to a closed Select popup while Base UI retains it for exit animation. It keeps the existing rendering and motion props. Repeated Axe, keyboard selection, Escape and focus-restoration coverage passed.

## Follow-up architecture review, 18 September 2026

The user-requested Sol review ran at xhigh effort against `88f45f7`, preserved by the local tag `checkpoint/architecture-review-2026-09-18`. The earlier restructuring was already committed in `92fd5fb`; this pass reviewed its current state instead of repeating directory moves. Parent review accepted the existing ownership layout and two focused checker corrections:

- Every SDK and platform-contract source file is now a portable runtime entry for dependency analysis, even when no application currently imports it. Node/server and DOM/UI runtime edges are rejected; type-only React contracts remain legal. Explicit SDK Node entry points remain outside the portable tree.
- Conditional wildcard exports substitute the matched path after selecting the export target. Fixtures prove that a declared application import resolves while an illegal cross-module implementation import still fails.

Nine architecture fixtures passed. The initial run passed eight and exposed an incorrect new fixture expectation: the forbidden module import produces both a layer violation and a cross-module violation. Parent review corrected the exact expected diagnostics; no checker rule was weakened. `pnpm build` passed strict TypeScript, all four environment checks, dependency/copy checks and all four application builds. The existing web chunk-size warning remains. Logs: `/tmp/gabs-architecture-review-tests-final.log` and `/tmp/gabs-architecture-review-build.log`.

The architecture overview now describes independently distributed executable modules and the still-open hosted trust/fifth-module acceptance accurately. No application, UI, style, public package identity, or signed release changed in this follow-up. No browser or desktop was launched; the earlier visual acceptance above is historical evidence, not a new UI run. SDK-05 and full parity remain open.

## Current checkout audit, 18 September 2026

The latest requested checkpoint preserves all unfinished employee-recovery work at `4160ff07133ab9b589a8499704a7d1a74e0b3082`, on local branch `checkpoint/architecture-current-review-2026-09-18`. It is a recovery snapshot, not a feature-acceptance commit. The working tree and index were preserved when creating it.

A newly delegated `gpt-5.6-sol` subagent at `xhigh` independently reviewed the current ownership, depth, export surfaces and dependency enforcement. Parent review separately checked workspace discovery, environment configurations, CI paths, generated composition and public exports. Both reviews found no concrete additional structural correction: the requested migration is already in `92fd5fb`, with enforcement fixes in `2c306be`. No extra directory moves, public identifier changes or UI edits were made.

Fresh validation on the current checkout passed all nine architecture fixtures and `pnpm build`: strict TypeScript, four environment checks, boundary/copy checks and all four production builds. Logs: `/tmp/gabs-architecture-current-tests.log` and `/tmp/gabs-architecture-current-build.log`. The existing web chunk-size warning remains. No browser or Electron window was launched.

This audit does not accept the unfinished employee receipt-recovery implementation included in the checkpoint. Its observable behavior still requires the SDK-05-LAN-EMP-REC tests and journeys; that item remains active. Full parity and final UI refinement remain open.

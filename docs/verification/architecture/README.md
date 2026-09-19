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

## Collision-work checkpoint audit, 18 September 2026

The user-requested checkpoint is `c219fc00a958d62cb67cd84963c3c13d8c7cd4ba` on local branch `checkpoint/architecture-collision-review-2026-09-18`. It preserves five unfinished collision-recovery files without staging them or accepting their behavior. Parent comparison confirmed those files remain byte-identical to the checkpoint.

A fresh `gpt-5.6-sol` subagent at `xhigh` independently audited the current checkout at `063e1ce` plus that work. Parent review checked ownership, public exports, environment configurations, legacy exceptions and the larger orchestration files. The requested structural migration remains implemented by `92fd5fb`, with enforcement fixes in `2c306be`; neither review found a concrete additional architecture correction. No source, UI, signed artifact or public identifier changed in this audit.

The structure is accepted for continued feature work, not declared free of maintainability debt. `local-profiles.ts` retains the session/lifecycle state machine after extraction of vault, access and capability owners. `workspace.tsx` and module `views/view.tsx` remain large orchestration files. The client index retains legacy commerce cache/command contracts. Extract further responsibilities when a behavioral seam or compatibility retirement justifies it; do not add directory layers solely to reduce line counts.

Fresh parent validation passed all nine architecture fixtures and `pnpm build`, including strict root/browser/Node/preload/worker checks, dependency/copy checks and all four production builds. Logs: `/tmp/gabs-architecture-collision-audit-tests.log` and `/tmp/gabs-architecture-collision-audit-build.log`. Existing bundle-size warnings remain. No browser or Electron window was launched. This verifies the architecture and compilation of the checkout, not collision-recovery behavior or full parity. OFF-01 remains active; its collision implementation still needs server/UI integration and observable acceptance.


## Queued-foundation checkpoint review, 18 September 2026

Checkpoint branch `checkpoint/architecture-queued-foundation-badb5bb` preserves the clean checkout at `badb5bb1c0d32a10fbadeefbfbce15505b4ab5a1`. The user-requested independent `gpt-5.6-sol` review at `xhigh` and parent review found no further structural correction justified. The original migration remains in `92fd5fb`, with boundary enforcement corrections in `2c306be`; this review did not repeat those moves.

The new queued-command contracts remain portable in `sdk/src/client`; durable storage, response verification and the host queue adapter belong to `client/src/modules`. The SDK defines the interface and the client implements it. Parent inspection also checked public exports, environment configurations, workspace discovery, CI/build paths and the absence of obsolete physical package paths. No source, style, public package identity or signed artifact changed.

Fresh validation passed all nine architecture fixtures and `pnpm build`: strict root/browser/Node/preload/worker checks, dependency/copy checks, and four successful build tasks reused from the valid Turbo cache. Logs: `/tmp/gabs-architecture-queued-review-tests.log` and `/tmp/gabs-architecture-queued-review-build.log`. Existing bundle-size warnings remain. No browser or desktop window was launched. This confirms structural acceptance; custom-view queue integration, full parity and the later UI-refinement goal remain open.

## Saved-work checkpoint review, 18 September 2026

Checkpoint `168834e9c671dfe72d85979ae1b8a73fe4646e28`, retained on `checkpoint/architecture-work-export-review`, preserves the unfinished OFF-01 saved-work export implementation and captures. It is a recovery snapshot, not feature acceptance.

The user-requested `gpt-5.6-sol` subagent at `xhigh` independently audited the current checkout while the parent reviewed public exports, dependency enforcement, environment configurations and current recovery ownership. Both found no additional structural correction justified. The requested physical migration is already implemented in `92fd5fb`, with boundary improvements in `2c306be`.

Saved-work wire schemas belong to the portable SDK, validation and snapshot construction to the client, recovery presentation to the shell, and privileged save authorization to Electron main. The explicit client export resolves through declared dependencies. Runtime, tooling and CI contain no obsolete physical package paths; retained public package identifiers remain compatibility contracts. No product source, style or signed artifact changed during this review.

Fresh parent verification passed all nine architecture fixtures and `pnpm build`: root/browser/Node/preload/worker TypeScript checks, dependency/copy checks and four successful build tasks using valid Turbo cache entries. Logs: `/tmp/gabs-architecture-work-export-tests.log` and `/tmp/gabs-architecture-work-export-build.log`. Existing bundle-size warnings remain. No browser or desktop window was launched.

Eighteen historical PNGs overwritten during the preceding export tests were restored from `c1ae747`; the eight new export captures remain separate. [The subsequent saved-work acceptance record](../work-recovery-export/README.md) now documents final-source browser/native, regression and visual verification, superseding the partial evidence available at this checkpoint. OFF-01 and full parity remain active; UI refinement remains a later goal.


## Synchronization ownership review, 19 September 2026

Checkpoint `546837c` preserves the native recovery metadata-ordering work before the user-requested `gpt-5.6-sol` review at `xhigh`. The original physical migration remains in `92fd5fb`; this review found one subsequent ownership regression in workspace synchronization.

The durable journal/network runner moves from the shell to `packages/client/src/modules/synchronization.ts`, exposed through `@suite/client/module-synchronization`. The shell retains its React scheduler and a small typed adapter binding connected saved-work access and installed dependency-graph verification. Automatic scheduling and explicit resource/command retries share that adapter. Scope, policy revision, cancellation, original contracts, lock-time verification, retry identities and authentication-error handling remain intact.

Parent review checked the complete runner and the actual installed-module verifier. The verification binding returns the verified signature and must validate the exact stored release and complete dependency graph without mutating storage. Physical package names, signed/public compatibility identifiers and UI behavior/styles remain unchanged; the view files only change their synchronization import.

Final-source parent verification passed:

- Strict root/browser/Node/preload/worker checks, dependency/copy enforcement and four fresh production builds: `/tmp/gabs-architecture-sync-build.log`.
- All 540 unit/PostgreSQL tests across 88 files, including nine architecture fixtures: `/tmp/gabs-architecture-sync-regression.log`.
- Three headless browser journeys and five hidden/minimized, unfocused native journeys: `/tmp/gabs-architecture-sync-web.log` and `/tmp/gabs-architecture-sync-native.log`. These cover queued capture/retry/revocation, route-independent synchronization, cross-module continuation and native export restoration/stale metadata.
- Four fresh wide/narrow web/native Settings captures were inspected under `screenshots/sync-*`; changed-source formatting and diff checks passed. Historical captures overwritten by tests were restored.

The checkpointed [native recovery ordering fix](../recovery-metadata-ordering/README.md) separately closes OFF-01-EXPORT. Full OFF-01, product parity and final UI refinement remain open.


## Queued-resource checkpoint review, 19 September 2026

Checkpoint `c43e7de` preserves queued-resource work before the user-requested `gpt-5.6-sol` review at `xhigh`. The physical package migration was already complete. Independent and parent review confirmed the current ownership: portable public capture contracts in `sdk/src/client`, durable capture in `client/src/modules`, simulation in `sdk/src/testing`, development transport in tooling and React/view authorization in the shell. Additional package moves or nesting were not justified by these responsibilities.

The review found duplicated request-key validation. The durable client adapter now reuses the existing platform `RequestKeySchema`; SDK simulation reuses SDK queue key/dependency schemas for both resources and commands. This rejects NUL-containing keys/prerequisites before journal mutation and avoids adding a forbidden SDK dependency on platform contracts. Parent review also corrected the structural capture-error guard: identities containing both command and resource fields cannot be narrowed into a valid retry identity. These guards communicate request identity, never authority.

Parent review inspected all changed production files and the regressions. Final verification passed:

- Strict root/browser/Node/preload/worker checks, dependency/copy checks and four fresh builds: `/tmp/gabs-resource-architecture-final-build.log`.
- 41 affected tests across six files, including nine architecture fixtures, fourteen resource tests, command host/integration, simulation and host compatibility: `/tmp/gabs-resource-architecture-final-tests.log`.
- Both command/resource development-preview journeys headless: `/tmp/gabs-resource-architecture-final-preview.log`.
- The complete unit/PostgreSQL suite passed 550 tests across 89 files immediately before the schema-reuse correction; the affected final-source run above covers that correction. This is not a claim that the entire suite was rerun afterward.
- The checkpointed resource milestone separately passed six browser and five hidden/minimized, unfocused native cases before these validation-only corrections. Its [evidence](../resource-continuation/README.md) records the exact sequence and twelve inspected captures. No production stylesheet or signed historical artifact changed.

Physical paths, public package identifiers, module permissions and corporate authority remain intact. OFF-01-RESOURCE has scoped local acceptance; OFF-01, full product parity and final UI refinement remain incomplete. The paused goal stays paused during this requested architecture task.


## Archive recovery checkpoint review, 19 September 2026

Checkpoint `222ac15` preserves the archive-recovery implementation before the explicitly requested `gpt-5.6-sol` review at `xhigh`. The physical migration remains implemented in `92fd5fb`: `sdk`, `client`, `server`, `shell` and nested `ui/web` and `ui/tokens`. Public package identifiers remain compatibility contracts.

The independent audit and parent review found no further structural correction justified. Durable archive settlement, cancellation, replacement and dependency rewiring belong in `client/src/modules/archive-recovery.ts`, exposed through an explicit package export. The shell owns React state, the current server snapshot and live authorization binding. `ui/web` owns only the generic opt-in expansion of `ResourceValue`; existing callers retain their behavior. No styling or signed historical artifact changed.

Both reviews examined the scope-specific synchronization lock across settlement and enqueue, the separate storage transactions, current permission/release checks, immutable original calls and retained response validation. Submitted or uncertain direct children are rejected before settlement and in the subsequent storage transaction. The synchronization lock remains held through enqueue; concurrent captures can only add unsent children, which are rewired atomically. Cancellation remains durable if local replacement fails. A spot-check since `703b3ab` also confirmed that shared request-key validation and SDK boundaries remain intact.

The parent corrected an acceptance selector to identify the exact independently published release when several fixture modules share a display name. The subagent made no source changes and ran no duplicate verification. [Archive acceptance](../archive-review/README.md) owns the fresh build, full regression, browser/native and visual results, including initial failures and scope limits. This review does not close full OFF-01, product parity or the later UI-refinement goal.


## Collision recovery checkpoint review, 19 September 2026

Annotated tag `checkpoint/architecture-review-d3ffbb6` preserves the clean checkout at `d3ffbb6ab7e68c4a8dfa8825ee600c2b4c36aa61`. The user-requested `gpt-5.6-sol` subagent at `xhigh` audited the architecture independently; the parent reviewed the current source and verification before committing this record. The physical migration is already implemented in ancestor `92fd5fb`. Neither review found a further structural change justified, so this checkpoint adds no production-source edits.

The review covered the changes since `3fc7481`: collision graph preparation, archive/command recovery, settlement, durable storage, portable recovery schemas, generated resource views and the saved-command inbox. Durable graph changes and settlement stay under `packages/client/src/modules`; portable metadata stays under `packages/sdk/src/contracts`; React state, live host authorization bindings and presentation stay under `packages/shell/src/features/modules`. Public imports resolve through declared exports. The parent also inspected environment-specific TypeScript configurations, package manifests, the dependency checker and its adversarial fixtures, and confirmed that runtime, tooling and CI contain no obsolete physical package paths.

The current layout retains `apps/web`, `packages/sdk`, `packages/client`, `packages/server`, `packages/shell`, `packages/ui/web` and `packages/ui/tokens`, with subsystem folders and outermost product assembly in `composition`. Existing public identifiers such as `@suite/module-sdk` remain compatibility contracts. This review does not rename signed releases or add nesting without a concrete ownership boundary. The large generated resource-view orchestrator remains maintainability debt; this review found no new misplaced responsibility in its recent additions and does not claim that every file is ideally sized.

Fresh verification on unchanged product source passed:

- 91 tests across architecture boundaries, module response/storage and saved-work recovery: `/tmp/gabs-architecture-collision-review-tests.log`.
- Strict root/browser/Node/preload/worker type checks, dependency/copy checks and four successful production build targets, all reusing valid Turbo cache entries: `/tmp/gabs-architecture-collision-review-build.log`. Existing bundle-size warnings remain.

No browser or desktop process was launched. This is structural and focused regression evidence, not a fresh full-suite or visual acceptance run. The preceding [collision-command acceptance](../collision-commands/README.md) records the existing web/native and visual evidence. Already-submitted collision descendants remain open under OFF-01-COLLISION-OUTCOME; full parity and the later UI-refinement goal remain incomplete.


## Resource recovery checkpoint review, 19 September 2026

Checkpoint `2b282c1` and the pushed annotated tag `checkpoint/architecture-recovery-2b282c1` preserve the unfinished recovery edits present when the user requested delegation. The explicitly requested `gpt-5.6-sol` subagent at `xhigh` reviewed the layout and completed a bounded correction; the parent independently reviewed the full diff before acceptance.

The physical migration was already present: `sdk`, `client`, `server`, `shell`, `ui/web` and `ui/tokens`, with subsystem directories and outermost product composition. No additional directory move or public identifier change was justified. SDK contracts remain portable; durable recovery and transaction guards stay in the client; React state and review presentation stay in the shell. One shared `CreateRecoveryNotice` now serves command, resource and archive reviews. No stylesheet or signed historical release changed. The large generated resource-view orchestrator remains maintainability debt; this review is not a claim that every file is ideally sized.

The checkpoint enabled cancelled resource descendants without completing the editor contract. The subagent connected exact recovery snapshots to draft persistence, enqueue and archive replacement. Parent review caught an unsafe first draft of resume behavior: copying current metadata while keeping a stale target/comparison. Resumption now reloads the selected record online after prerequisites settle, rebuilds the comparison from original provenance and saved input, and persists the new context before use. Stale open editors fail the durable context check. Parent regression coverage also verifies that an unknown child blocks replacement and an accepted child remains byte-exact through a resource correction.

Final verification:

- 99 focused architecture/storage/export tests passed in `/tmp/gabs-architecture-recovery-parent-tests.log`; the subagent separately passed 90 storage/export tests. Initial fixture assertions were corrected for an additional legitimate same-record dependency, and a parent test's missing UUID qualifier was fixed.
- The isolated full unit/PostgreSQL suite passed 600 tests across 89 files in `/tmp/gabs-architecture-recovery-regression.log`.
- Strict root/browser/Node/preload/worker checks, dependency/copy checks and four fresh production builds passed in `/tmp/gabs-architecture-recovery-final-build.log`. Existing bundle-size warnings remain.
- Seven distinct headless browser journeys passed: four command cases in `/tmp/gabs-architecture-recovery-web.log` and three archive cases in `/tmp/gabs-architecture-recovery-web-archives.log`. The first run's archive failures were a screenshot-helper selector incorrectly requiring a modal class on the navigation drawer, after the business assertions had passed. The corrected helper targets actual modals. The cancelled archive passed again with narrow review accessibility/overflow checks in `/tmp/gabs-architecture-recovery-web-narrow.log`.
- All seven hidden/minimized, unfocused native journeys passed in `/tmp/gabs-architecture-recovery-native.log`. New wide/narrow archive choice/review, accepted-table and navigation captures were inspected under [archive-cancelled](../collision-outcomes/archive-cancelled/). Historical captures overwritten by regressions were restored.

Changed-source formatting, the final fixture TypeScript check and diff checks passed. All local links in the six changed documents resolve, and all 29 original requirement IDs remain present. Forty-three overwritten historical captures were restored.

[The outcome record](../collision-outcomes/README.md#cancelled-resource-review-follow-up) describes the real server fence and scoped archive acceptance. Cancelled create/update and broader mixed-resource UI acceptance, repeated-collision saved-review UI recovery, full OFF-01 and overall parity remain open. The later UI-refinement goal has not started.

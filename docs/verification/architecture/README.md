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


## Profile lifecycle checkpoint review, 19 September 2026

Checkpoint `8602fbd0bf99c03cee8329eac697e43232aa5f2a` on `checkpoint/architecture-profile-review-d82129a` preserves the unfinished checkout without changing its index. The explicitly requested `gpt-5.6-sol` subagent at `xhigh` and parent review confirmed the existing package/subsystem layout; no repeat directory migration or public package rename was justified.

The bounded correction makes session ownership explicit: encrypted storage and transactional revisions remain in the client identity layer; the shell owns the displayed session and closes late unlocks after navigation. Parent review additionally fenced an older unlock racing a newly restored profile. No style or signed release changed. [The profile recovery record](../profile-removal/README.md) contains the concrete findings, failing-before/passing-after regression, nine architecture fixtures, strict builds, full tests and real headless/hidden-native evidence. This does not accept the unrelated collision work or complete overall parity or final UI refinement.

## Saved online profile checkpoint review, 19 September 2026

Checkpoint `1522b55`, pushed with tag `checkpoint/architecture-review-2026-09-19`, preserves the unfinished profile and collision checkout. The explicitly requested `gpt-5.6-sol` subagent at `xhigh` audited the current physical architecture and implemented the scoped boundary-checker correction. Parent review inspected its diff and requested additional matching edge cases before validation.

The existing `sdk`, `shell`, `client`, `server`, `ui/web` and `ui/tokens` paths already implement the intended responsibility-based organization. Profile metadata persistence belongs to the client identity layer; native protected adapters belong to Electron main; account-selection state and UI belong to the shell. No further directory move or public package rename was justified.

The checker previously chose the first matching wildcard export in manifest order. It now selects the most-specific static prefix and then longest key, preserves exact and null exclusions, and rejects empty, overlapping or multiple-star captures. Standalone Node resolution probes confirmed the expected behavior. Five additional adversarial fixtures bring the architecture suite to 14 cases.

Parent review also added the missing identity-generation check to native profile metadata writes. The checkpoint's new browser acceptance fixture now waits for either the automatic chooser or its trigger, uses the actual close-button name, and verifies the accepted contact's authoritative version. Screenshot inspection found touching sign-in links and cramped dialog controls; existing form-stack layout classes correct these without changing styles or the visual system. [Saved-profile evidence](../online-profiles/README.md) records the behavior and limits.

Verification on the final source:

- Focused architecture/profile-directory tests: 18 passed.
- Strict root, browser, Node, preload and worker type checks; boundary/copy checks; all four application builds passed with no cached builds.
- Isolated unit/PostgreSQL regression: 688 tests across 101 files passed; the disposable database was removed.
- Browser acceptance: eight existing sign-out/profile-authority journeys passed; both new saved-profile journeys passed again on the final build with authoritative version-2 readback. Final 1440 × 1000 and 390 × 844 captures were visually inspected; no horizontal overflow. The initial new-fixture failures and their correction are recorded separately.

Package identities, signed artifacts, API schemas, tokens and styles are unchanged. The checkpoint's unrelated collision source and captures are preserved. macOS still reports the screen locked; native/provider acceptance remains required, and no foreground desktop test or protected-storage bypass was attempted. This review does not complete ID-01, overall functionality parity or later UI refinement.


## Native unlock checkpoint review, 19 September 2026

Checkpoint `be100d1`, with pushed tag `checkpoint/architecture-unlock-be100d1`, preserves the unfinished checkout. The user-requested `gpt-5.6-sol` agent at `xhigh` reviewed and corrected the implementation; the parent independently reviewed its diff and added adversarial acceptance coverage.

The existing physical migration remains appropriate. Portable unlock types now live in `client/src/identity/profile-lock.ts`, composed into the root bridge with compatible exports. Privileged policy and durable state remain in Electron main; React state and presentation remain in shell identity. Corporate feedback is owned by the preserved account surface, while recovery/local profiles have separate providers. There is no directory churn, stylesheet change, public package rename or signed-artifact rewrite.

Parent review reproduced a policy-write/lock race, checked durable retry-delay retention and corrected the journal classification of a withheld native response: local locking cannot establish server rejection. The native read wrapper also checks both identity and lock generations, and locking cancels the whole pending sign-in attempt. The [native unlock evidence](../profile-unlock/README.md) records the focused tests, builds, broad regression, headless browser and minimized native acceptance, inspected captures and external limits. This is acceptance of the scoped architecture/correctness pass, not completion of ID-02, feature parity or the later UI-refinement goal.


## Local vault checkpoint review, 20 September 2026

Checkpoint `5d7ee8a` and pushed tag `checkpoint/architecture-local-vault-2026-09-20` preserve the unfinished local-vault split. The explicitly requested `gpt-5.6-sol` subagent at `xhigh` completed a focused structural cleanup; the parent independently reviewed every changed source file against pre-refactor `de9f520` before acceptance.

The existing responsibility-based package migration remains in place. The local vault now separates lifecycle orchestration (`index.ts`), typed IndexedDB access and change notification (`store.ts`), and WebCrypto (`crypto.ts`). Storage uses an `idb` schema instead of unchecked read casts. Public profile exports, encryption parameters, revision checks, cancellation and removal/restoration behavior remain compatible. The checkpoint's premature version-2 database, unused unlock store/pointer and extractable-key options were removed: standalone PIN support remains unimplemented under ID-02-LOCAL and must introduce its migration with the actual feature. The unfinished version-2 code was not built or tested; this review does not provide a downgrade path for anyone who independently ran that checkpoint.

Both E2E bundler entry paths were updated. Parent review added a real-browser assertion that creation and recovered keys remain nonextractable. The worker journey initially expected `PROFILE_CHANGED` after removal. A headless comparison using the exact pre-refactor vault source and the reviewed source returned `PROFILE_LOCKED`, locked sessions and no active profiles for both; the stale expectation was corrected without changing application behavior.

Verification:

- 37 architecture and local-runtime tests across six files passed in `/tmp/gabs-architecture-vault-focused.log`.
- Strict root/browser/Node/preload/worker checks, boundary/copy checks and four fresh builds passed in `/tmp/gabs-architecture-vault-build.log`. Existing bundle-size warnings remain.
- Seven selected headless browser journeys passed: six in `/tmp/gabs-architecture-vault-web.log`, followed by the corrected worker journey in `/tmp/gabs-architecture-vault-web-worker.log`. The initial stale-expectation failure is retained in the first log; `/tmp/gabs-architecture-vault-baseline.log` records the old/new comparison. Coverage includes delayed-session cleanup, cross-tab removal, concurrent restoration, original ciphertext preservation, offline worker receipts, stale writers and device consent. Existing consent journeys include scoped Axe and narrow overflow checks.
- Both hidden/minimized native restart journeys passed in `/tmp/gabs-architecture-vault-native.log`, exercising encrypted worker records and removed-profile recovery. No interactive biometric or protected-storage unlock was attempted.
- Browser wide/narrow consent, recovery and native worker captures were inspected. Overwritten historical captures were restored. No UI source, styles, public package identity, signed release or generated contract changed.

Disposable acceptance databases were removed. This is scoped architecture and regression acceptance, not a new full-suite/remote CI run, standalone PIN implementation, overall parity or final UI approval. Continue ID-02-LOCAL from the preserved passphrase vault; do not repeat the completed directory migration.


## Native vault checkpoint review, 20 September 2026

Checkpoint `f40229a` and pushed tag `checkpoint/architecture-native-vault-2026-09-20` preserve the unfinished native vault slice. The user-requested `gpt-5.6-sol` subagent at `xhigh` reviewed implementation ownership and corrected session ordering. The parent independently reviewed the changed boundaries, fixed a narrow constructor type annotation and added adversarial migration/session and actual utility-crash acceptance.

The existing physical layout already implements `apps/web`, `packages/sdk`, `packages/ui/web` and concern-specific source directories. Portable vault behavior belongs in client identity, storage/session custody in the desktop utility, OS protection in main and presentation in shell. No additional directory moves or public package renames were justified. The typed protocol now identifies each utility session, remembers observed revocations and rejects late responses from retired sessions. Worker callbacks cannot affect a newer worker after termination.

[Native vault evidence](../native-vaults/README.md) records 28 focused checks, 744 full regression tests, strict environment/boundary checks, four fresh builds, eight browser journeys and six minimized native passes, plus packaging evidence and explicit limits. Inspected browser/native captures preserve the existing visual system; no CSS or design-token change was made. This completes the scoped architecture checkpoint/review, not full parity, physical OS-provider acceptance or final UI refinement.

## Local restore foundation review, 20 September 2026

Checkpoint `889aceb4ea47d99990a740fee52ef6b63af4d090` and pushed tag `checkpoint/local-restore-architecture-889aceb` preserve the unfinished restore foundation. The requested `gpt-5.6-sol` review at `xhigh` and independent parent review retain the existing ownership layout: portable vault lifecycle and recovery safeguards in client identity, SQLite archive validation and import in the desktop utility, and privileged activation reserved for Electron main. No additional package renames or presentation changes were justified.

The delegated correction reads an encrypted private copy of the closed source database, validates the archive schema and rows, and materializes one snapshot for both identity calculation and copying. Repeated imports cannot create source sidecars or overwrite newer work. Unexpected schema, corporate cache rows, profile identity mismatches and malformed migration receipts fail before destination activation. Copied device grants are removed and pending/running device effects become uncertain at the first successful passphrase unlock.

The first strict environment build caught a type-only dependency from the utility recovery code into browser profile orchestration. Parent review removed that dependency: the recovery guard now validates and narrows only its own required data fields, without claiming to validate the entire business-data schema. Browser APIs remain outside the utility dependency graph.

Parent review additionally found that restoring a removed profile could activate it before recovery validation completed. Recovery validation and encryption now precede one atomic activation. Malformed recovery data and cancellation leave the original removed profile unchanged. The focused tests verify durable safeguards after reopening and preservation of completed outcomes and attempt identities.

This is foundation acceptance, not complete product restoration. ID-03-BACKUP-RESTORE still requires the maintenance entry point, recoverable storage-root activation, interrupted activation acceptance and real operator/user recovery journeys. ID-03-BACKUP-CORPORATE remains separate and requires current account/workspace authorization. Archive validation materializes encrypted vault envelopes in memory proportional to archive size; a bounded product import policy remains a restore-integration consideration. Real OS-provider, signed platform and overall parity gates remain open. UI refinement has not started.

### Verification for this review

| Check | Result |
| --- | --- |
| Full unit/PostgreSQL regression | 799 passed across 116 files in an isolated database; `/tmp/gabs-restore-review-regression.log` |
| Final focused checks after removing the browser type dependency | 27 passed: 13 restore cases and 14 architecture fixtures; `/tmp/gabs-restore-review-final-focused.log` |
| Strict root/browser/Node/preload/worker checks, boundary/copy checks and fresh builds | Passed, four application builds without cache reuse; `/tmp/gabs-restore-review-build.log` |
| Hidden/minimized Electron regression | Four passed: portable backup, utility-owned vault/PIN restart, IndexedDB migration/cancelled enrollment, and utility process-death/key-rotation recovery; `/tmp/gabs-restore-review-native.log` |
| Patch/source review | `git diff --check` passed; shell, renderer, UI kit, CSS and theme sources unchanged |

The native tests use controlled protection adapters where noted in their fixtures. They verify real Electron/main/utility execution without asserting actual OS-provider or physical biometric acceptance. The backup portability fixture still stages recovery through its test harness; it does not establish a product restore command. Existing web bundle-size warnings remain. Test databases were removed after both isolated runs.

## Corporate-import checkpoint review, 20 September 2026

Checkpoint `225390c` preserves the current saved-work import/restoration slice. A requested `gpt-5.6-sol` subagent at `xhigh` reviewed ownership, depth, public exports, authority and exact-request promotion. The physical migration remains complete; public package identifiers stay compatible. The current split places format validation, authority, stored-copy operations and promotion under `packages/client/src/recovery/import`, while the shell owns interaction through the existing UI kit.

The delegate fixed policy delivery before rejection, respected the host-returned policy and tightened async guards. Parent review corrected the test's contract typing and verified the patch independently. Native acceptance then exposed a React timing race: applying a new policy revision cancelled the same refresh. The scoped correction preserves scope/consent/offline cancellation and revision/permission visibility guards, while clearing only stale confirmations on a revision change.

[Product evidence](../corporate-work-import/README.md) records 853 tests across 121 files before the final UI-only race correction, followed by final strict checks, four fresh builds, one headless browser journey and one hidden/minimized native journey. Final screenshots and keyboard/Axe checks passed within the dialog's scope. No styles or package names changed. Desktop protection and development authentication are controlled fixtures; actual providers, signed platforms and broader corporate recovery remain required. This review does not complete parity or start UI refinement.

## Imported dependency checkpoint review, 20 September 2026

Checkpoint `bd44cdb` preserves the unfinished imported-command continuation slice. The requested `gpt-5.6-sol` subagent at `xhigh` reviewed the current implementation; the parent independently reviewed the continuation transaction, provenance rules, acceptance fixtures and final source changes. The existing physical package layout is retained. No further directory migration, public package rename or stylesheet change was justified.

Session timing is now owned by private client recovery `import/session.ts`, separate from permission and signed-contract orchestration. It uses the existing authoritative database clock with a nondecreasing elapsed-time budget and exact session-proof equality. Parent adversarial tests exposed and corrected local account-fence loss, wall-clock rollback and monotonic reset handling in the first review draft. Actual desktop acceptance then exposed a second actor-acknowledgement guard in Electron main; the parent corrected it, and Sol reviewed the final identity and lock lifecycle. Only the successful public clock's absent actor header is exempt; current account, lock, generation and mismatched-actor checks remain enforced.

[Imported dependency evidence](../imported-command-dependencies/README.md) records the original failures, focused and full regression, strict builds, actual browser/native file interchange, inspected captures and external limits. Final verification passed 880 regression cases, strict checks/four fresh builds, eight browser/cross-surface journeys and four hidden/minimized native journeys. This completes only the scoped checkpoint/review. Corporate backup, real providers, signed platform acceptance, whole-product parity and later UI refinement remain open.


## Command snapshot checkpoint review, 20 September 2026

Checkpoint `179beb8` preserves the command exported-file acceptance increment and was pushed before review. The requested `gpt-5.6-sol` subagent at `xhigh` audited current recovery ownership and the checkpoint changes; the parent independently reviewed original-call identity, atomic retention, authority guards, acceptance assertions and the resulting diff.

No new production restructuring was justified. Client recovery owns parsing, current authority, retained copies and authoritative settlement followed by atomic promotion. The shell owns presentation and explicit choices through public client contracts. The previously accepted responsibility-based layout, public package identifiers and UI remain unchanged.

The delegate replaced two independent optional test-helper fields with a `draft`/`command` discriminated union. Each scenario now requires its own fields; callers declare their mode and branches narrow it explicitly. This is confined to three shared acceptance-helper files. It adds no package, runtime abstraction, public API or stylesheet change.

Parent verification after the cleanup passed strict TypeScript environment checks, boundary/copy checks, three headless browser journeys and three hidden/minimized desktop journeys. Scoped helper formatting, local documentation links, all 29 original requirement IDs and 104 cycle-free tracker dependencies were checked. The [command acceptance record](../imported-snapshots/README.md#command-exported-file-acceptance) records logs and controlled native/provider limits. This closes the scoped architecture checkpoint/review only; full parity, encrypted corporate archives, actual provider/platform acceptance and later UI refinement remain open.


## Encrypted archive checkpoint review, 20 September 2026

Checkpoint `0733512` preserves the current checkout, including three unfinished archive-capacity acceptance files, and was pushed before the requested `gpt-5.6-sol` review at `xhigh`. The earlier physical migration remains in place: `sdk`, `client`, `server`, `shell`, `ui/web` and `ui/tokens`. No further package move or published identifier rename was justified.

The delegate moved source enumeration, snapshot collection, digest deduplication, unavailable counting and per-copy authorization orchestration into client recovery `archive/collect.ts`, exposed through the existing work-archive entry. The shell reads one storage snapshot and owns React lifecycle, live host authority bindings, labels and selection. The parent independently reviewed the diff and verified cancellation propagation and final authority rechecks before presentation. The focused test exercises partial denial, cancellation, expired earlier authority, exact deduplication and source preservation.

Final parent verification:

- Strict TypeScript checks across all environments and dependency/copy checks passed: `/tmp/gabs-archive-architecture-final-types.log` and `/tmp/gabs-archive-architecture-final-lint.log`.
- 133 focused tests across archive cryptography/collection, native publication, recovery authority and saved-work import passed: `/tmp/gabs-archive-architecture-final-unit.log`.
- Fresh web and desktop builds passed: `/tmp/gabs-archive-architecture-build.log`.
- Three headless browser/cross-surface journeys and one hidden/minimized native journey passed, covering all four web/desktop file-transfer directions: `/tmp/gabs-archive-architecture-web.log` and `/tmp/gabs-archive-architecture-native.log`. Both disposable databases were removed.
- Scoped Axe and narrow overflow assertions passed. Parent inspected wide export and narrow import captures on web and desktop. Nineteen recorded source hashes confirm unchanged generated contracts, tokens/styles, dialog markup, encryption format, admission transaction and native publication implementation. Historical rerun captures were restored after inspection.

This accepts the scoped ownership refactor, not whole-product parity or final UI design. Native acceptance uses development authentication and controlled OS keys; actual provider and signed-platform gates remain open. The checkpointed capacity fixture is unverified: its 560,000-character text exceeds the SDK text field's default 500-character limit, so it fails before exercising large archive admission. Correct that fixture without weakening product limits; capacity, lease/scope transitions and process-failure gates remain in ID-03-BACKUP-ARCHIVE.


## Session ownership checkpoint review, 20 September 2026

Annotated tag `checkpoint/architecture-review-08e09fe` preserves the clean checkout at `08e09fe` and was pushed before the explicitly requested `gpt-5.6-sol` review at `xhigh`. The delegate audited every non-document source change since the previous archive architecture review, alongside the adjacent desktop storage, utility, preload and shell boundaries. The parent independently reviewed the diff, package manifests, environment configurations, build/CI paths and dependency checker.

The requested physical layout is already implemented: `sdk`, `client`, `server`, `shell`, `ui/web` and `ui/tokens`, with subsystem directories and outermost product composition. Recovery validation and promotion stay in the client; interaction stays in the shell; retained-root replacement and OS-key handling stay in desktop main/utility. Existing public package identifiers remain compatible. Further moves or generic test abstractions were not justified.

The delegate corrected one ownership defect: an old, unmounted shell session could remove `suite-workspace` after a fresh session selected its company workspace. Workspace cleanup now shares the existing mounted-session guard with query and React state cleanup. The parent reproduced the defect in real minimized Electron before accepting the fix. A test-only bootstrap holds the actual logout IPC acknowledgement after native cleanup has completed, permits normal UI sign-in and company selection, then releases the old continuation. Before the fix the stored workspace became null; afterward it survives the acknowledgement and a renderer reload. No renderer bridge, production test hook, stylesheet or signed artifact changed.

Verification:

- 34 focused architecture-boundary and retained-root recovery tests passed: `/tmp/gabs-architecture-08e09fe-tests.log`. These precede the shell-only correction; that correction is covered by native acceptance below.
- Final strict root/browser/Node/preload/worker checks, dependency/copy checks and four fresh builds passed: `/tmp/gabs-architecture-08e09fe-final-build.log`. Existing bundle-size warnings remain.
- The pre-fix native regression failed at the expected persisted-workspace assertion: `/tmp/gabs-session-completion-before.log`.
- Two native journeys passed on the fixed product: delayed logout acknowledgement and existing archive profile isolation/recovery, `/tmp/gabs-architecture-08e09fe-final-native.log`. Both remained hidden/minimized and unfocused. The archive journey's scoped accessibility/overflow checks passed; four regenerated captures were inspected and their incidental byte changes discarded.
- After review tightened the new fixture's launch/close cleanup, root type checking and its final native rerun passed: `/tmp/gabs-session-completion-final-types.log` and `/tmp/gabs-session-completion-final.log`. All disposable test databases were removed. Scoped source formatting and local documentation links passed; the ledger retains 29 unique requirements and the tracker 106 unique IDs.

The regression uses development authentication and deliberately unavailable OS storage; the archive journey uses its recorded controlled protection adapter. Neither establishes actual identity/OS-provider, platform signing or physical durability acceptance. The reviewed maintenance orchestration in Electron `main.ts` remains a candidate for extraction if another maintenance workflow introduces a distinct responsibility; its current size alone does not justify a new layer. The shared corporate-portability callback surface is a maintainability watchpoint.

ARCH-01 through ARCH-06 retain their existing scoped acceptance. ID-03-BACKUP-INTERRUPTION remains active: this logout correction does not verify locking/replacing a profile during saved-work promotion or acknowledgement of a committed promotion write. Full parity and the later UI-refinement goal remain incomplete.

## Browser recovery checkpoint review, 20 September 2026

Checkpoint `65cb7df`, preserved by pushed annotated tag `checkpoint/architecture-review-7f35c64`, records two unfinished browser restoration fixtures before the explicitly requested `gpt-5.6-sol` audit at `xhigh`. The delegate independently inspected the package hierarchy, exports, dependency checker and recent recovery/profile ownership. The parent reviewed the manifests, environment configuration, client authority/persistence boundaries, shell cancellation and browser cross-tab fixtures.

Both reviews found the requested architecture already implemented: physical `sdk`, `client`, `server`, `shell`, `ui/web` and `ui/tokens` directories, subsystem ownership and outermost composition. Portable recovery validation, settlement and atomic storage remain in the client; React interaction remains in the shell; browser coordination stays in adapters; native keys and persistence stay in main/utility. Stable public package identifiers remain intentional compatibility contracts. No further source move, abstraction or cosmetic edit was justified. Large composition/identity façades remain watchpoints, not evidence of a current boundary failure.

The delegate made no edits. Parent acceptance passed **14 architecture fixtures**, fresh strict root/browser/Node/preload/worker and dependency/copy checks, and **four cached build targets**. Logs: `/tmp/gabs-architecture-65cb7df-tests.log` and `/tmp/gabs-architecture-65cb7df-build.log`. Cached outputs are reported as such; no fresh compilation or native launch is claimed. Existing bundle-size warnings remain.

The checkpointed [browser restoration fixtures](../corporate-promotion-interruption/README.md#browser-cross-tab-profile-transitions) passed both real cross-tab cases, followed by six existing browser profile/archive regressions. Parent review corrected the shared capture label to web-to-web; both affected journeys passed again afterward. Four new wide/narrow captures were inspected, and scoped Axe/overflow checks passed. All test databases were removed. Incidental regenerated historical captures were discarded. No production source, UI style, signed artifact or public API changed.

This closes the requested checkpoint/delegation/review scope. ARCH-01 through ARCH-06 retain their existing acceptance. ID-03-BACKUP-INTERRUPTION still requires matrix reconciliation; full parity and the separately authorized later UI-refinement goal remain incomplete.

## Schema recovery checkpoint review, 20 September 2026

The requested checkpoint is `80fe063`, pushed on `main` and preserved by annotated tag `checkpoint/architecture-schema-review-2026-09-20`. It contains the previously unfinished schema/target recovery fixtures and evidence; it is a recovery snapshot, not a claim of whole-product acceptance.

The explicitly delegated `gpt-5.6-sol` subagent at `xhigh` independently inspected current ownership, directory depth, manifests/exports, dependency enforcement and the exact retained legacy bridges. Parent review separately checked workspace discovery, all environment configurations, build/CI/generated paths, absence of stale physical package paths and the checkpointed acceptance fixtures. Both found the requested hierarchy already implemented and no further structural correction justified. Public package identifiers remain compatibility contracts; physical directories retain `sdk`, `client`, `server`, `shell`, `ui/web`, `ui/tokens` and outer `composition`. Large orchestration files remain review watchpoints, not a reason to add arbitrary layers. The delegate made no edits.

Fresh acceptance passed **14 architecture boundary fixtures**, strict root/browser/Node/preload/worker checks, dependency/copy checks and all **four cached build targets**. Logs: `/tmp/gabs-schema-architecture-tests.log` and `/tmp/gabs-schema-architecture-build.log`. No fresh bundling, new full regression, browser launch or desktop launch is claimed for this review. Existing chunk-size warnings remain. Production/package/configuration sources are unchanged from the previous accepted review at `deea1cb`.

Parent review also finished inspecting the final wide schema-recovery captures and reconciled their [local acceptance and provider limits](../corporate-recovery/README.md) with the tracker and ledger. The recorded two product journeys and 104 focused tests ran before this architecture checkpoint; they are not presented as new architecture runs. No UI source, style, signed release or wire contract changed. Full parity remains active; ID-04 is next independent implementation work, while identity/OS-provider, signed-platform and physical durability gates remain required.

## Integrity checkpoint review, 20 September 2026

Checkpoint `77264f3` and pushed annotated tag `checkpoint/architecture-integrity-review-2026-09-20` preserve the unfinished integrity support extraction before the explicitly requested `gpt-5.6-sol` review at `xhigh`. The parent independently reviewed the diff, package hierarchy, workspace discovery, public exports, environment configurations, build/generator paths and dependency fixtures.

The earlier physical migration remains complete: `sdk`, `client`, `server`, `shell`, `ui/web`, `ui/tokens` and outermost `composition`. No further package move or public identifier rename was justified. Within desktop main, `integrity/format.ts` owns typed record validation, `files.ts` owns bounded reads and durable replacement, and `journal.ts` owns incident/recovery sequencing. Startup and runtime import the canonical failure type directly.

The review fixed a checkpoint regression rejecting valid release versions containing both prerelease and build metadata. Validation now uses the existing SemVer dependency and retains the original version string. Failures are validated before persistence, manifest asset names respect the audit format limit, and symlinked audit directories are refused without changing their targets or business data. The unused future repair format was removed. Report export and explicit unreadable-audit recovery remain unfinished ID-04 work; this extraction does not claim them complete.

Final parent verification:

- **29 focused tests passed** across architecture boundaries, desktop integrity and runtime admission: `/tmp/gabs-integrity-architecture-final-unit.log`. Coverage includes prerelease recovery after interrupted publication, invalid failure rejection before writing, long manifest names and symlink target preservation.
- Strict root/browser/Node/preload/worker checks, dependency/copy checks and all four build targets passed: `/tmp/gabs-integrity-architecture-final-build.log`. Desktop rebuilt; three other targets used cache. Existing bundle-size warnings remain.
- **Four hidden/minimized native journeys passed in one run:** startup corruption/repair, runtime IPC/held-reply fencing, offline saved-work recovery and already-server-committed work recovery: `/tmp/gabs-integrity-architecture-final-native.log`. The disposable database was removed.
- Scoped Axe and narrow overflow assertions passed. The parent inspected all four regenerated wide/narrow recovery captures and restored incidental screenshot differences. Renderer, shell, UI kit and styles are unchanged. This is continuity evidence, not final UI approval.
- Scoped source formatting, whitespace checks and documentation links passed; the ledger retains 29 original requirement IDs and the tracker 106 stable IDs.

Native acceptance uses the existing development identity and controlled OS-protection fixtures described in [runtime integrity evidence](../integrity-runtime/README.md). Real provider, signed-platform, physical durability and operational acceptance remain open. This completes the requested checkpoint/delegation/review only; parity remains active and the later UI-refinement goal has not begun.


## Integrity delivery checkpoint review, 20 September 2026

Checkpoint `24fcbc2`, preserved by pushed annotated tag `checkpoint/architecture-delivery-review-2026-09-20`, captures the unfinished diagnostic-delivery slice before the explicitly requested `gpt-5.6-sol` review at `xhigh`. The delegate inspected directory depth, public exports, dependency enforcement and desktop/server ownership. The parent independently reviewed workspace discovery, environment/CI configurations, server transactions, migration privileges and acceptance fixtures.

Both reviews retain the existing `sdk`, `client`, `server`, `shell`, `ui/web`, `ui/tokens` and outer `composition` hierarchy. Public package names remain stable contracts. Diagnostic schemas belong to contracts, retained-event delivery to desktop integrity, and receipt/audit transactions to server identity/persistence. Main retains orchestration coupled to request freshness, identity epochs and profile locking; wrapping those guards in another callback layer would not clarify ownership.

The delegate added the missing root-owned `@suite/contracts` test dependency and fixed a parent-reproduced starvation defect after 50 rejected diagnostic events. A process-local per-scope cursor rotates subsequent bounded passes. Authorization/transport failures and obsolete-profile responses retain exact retry behavior. Original records and durable acknowledgements are unchanged. The parent accepted the source diff and added the failing-before/passing-after regression.

Frozen offline installation, **45 focused tests**, strict environment/boundary/copy checks and **four fresh build targets** passed. **All ten hidden/minimized native cases passed together** after the Mac woke; the earlier four sleep-interrupted timeouts are retained in the [delivery acceptance record](../integrity-delivery/README.md). Real server-received observations retry without duplicate audit effects after process termination; accepted business work and unrelated drafts survive. Recovery and Audit history captures were inspected, with historical incidental differences discarded. No UI source or style changed.

This completes the bounded architecture review and local diagnostic-delivery acceptance. ID-04 is at **verify** for actual identity/OS providers, signed target-platform/physical durability and foreground native support-dialog acceptance. Hosted monitoring acceptance remains an operational gate. GOV-01 is the next ready independent engineering item. Full parity remains active and the later UI-refinement goal has not begun.

# Imported command dependencies

Scope: **ID-03-BACKUP-DEPENDENCIES**, within ID-03-BACKUP-CORPORATE. Locally verified on 20 September 2026.

## Behavior

Imported requests are reconciled with the authoritative server before entering the journal. An uncommitted original is permanently stopped, including when its prerequisite has not yet been imported. Recovering the parent later does not revive that original.

A command correction can now explicitly select direct dependents whose original requests have been stopped. This changes only their scheduling prerequisite. Their original input, record identity, retry identity, cancellation and capture metadata remain intact. Legacy commands without explicit capture metadata retain the prerequisite list used for their retry identity before either scheduling view changes. Legacy resource entries without explicit capture arguments keep those arguments unknown; inferred scheduling edges are not relabeled as original capture arguments. Their exact recapture still finds the stopped original. Each stopped child still needs its own reviewed correction with a new retry identity before execution. Unselected children retain the original prerequisite.

The existing client recovery transaction owns this behavior in `packages/client/src/modules/command-recovery.ts`; no new importer-specific execution path or journal state is introduced. Selection requires current original/installed contracts, permissions and module availability, including across modules. Changed input, accepted outcomes or lost authority invalidate a selection before commit. File-supplied continuation choices are retained in the imported source but are not applied as current approval.

The correction UI explains that stopped children remain held for their own review. It uses the existing host components and styles.

## Verification scope

The new product journey independently builds, reviews, stages, publishes and installs two local SDK fixture modules. The fixture provisions workspace entitlements and grants; package execution and business requests use actual host paths. Source forms capture a parent and two cross-module dependents offline. After the parent is rejected, the source saves corrected input and a dependent selection, then exports the three requests through the actual product UI.

An independently authenticated destination receives only those unchanged files. It imports a child before the parent, verifies the child remains stopped with its original prerequisite, then imports the remaining requests. The parent's saved input returns, but its copied selections are unchecked. A fresh keyboard choice is saved and survives a renderer reload. Correcting the parent reconnects only that selected child. The parent correction is accepted while both child originals remain stopped. Explicitly correcting the selected child then creates its intended effect. Late sends of all three originals are refused; exact retries of both accepted corrections preserve two records and two audit entries.

Native tests use actual Electron/main/IPC/utility storage with independently keyed controlled OS protection and controlled native save-dialog selection. They are not physical-device, live MFA or actual OS-provider acceptance. Browser tests run headless and desktop tests hidden/minimized and unfocused.

## Checkpoint failure and correction

The checkpoint regression failed three fresh-session import checks (865 passed, 3 failed across 121 files). PostgreSQL was measured 4–5 milliseconds ahead of the client wall clock; the strict client timestamp comparison rejected valid authoritative sessions. The latest-source review regression now passes 880 tests across 121 files, including a deterministic one-hour client clock skew against the real database. All final product journeys pass on the corrected source, as recorded below.

## Architecture and authentication review

Checkpoint `bd44cdb` preserves the unfinished implementation and its failing final regression. The requested Sol (`gpt-5.6-sol`, `xhigh`) review retained the existing responsibility-based package layout. Parent review confirmed command continuation uses the existing journal transaction and current contract/permission checks. No public package identifier or stylesheet was changed.

Import session timing now belongs in the private `packages/client/src/recovery/import/session.ts` helper; policy and signed-contract orchestration remain in `authority.ts`. One live database clock observation anchors the original five-minute session lifetime. Request latency and the greater of wall/monotonic elapsed time consume that lifetime; the elapsed maximum never decreases, and an invalid/reset monotonic clock is rejected. Refresh must still return the exact original proof. In both the shared API client and Electron main transport, the public clock response is exempt only from the missing actor-header check: scoped account checks, host access guards, session generation checks and request headers remain intact.

Parent tests reproduced four defects in the first review draft: lost local account/scope checks on the public clock, restored lifetime after wall-clock rollback, and acceptance of a reset monotonic clock. The final implementation corrects these without extending authentication or restoring authority from an imported file. Cross-surface acceptance then found the same missing-header rule in Electron main: two native-destination cases signed out during import. Parent corrected that transport rule and Sol independently reviewed its identity/lock lifecycle. The failing run is retained at `/tmp/gabs-dependency-review-native-clock-failure.log`; six other cases in that run passed. The original regression failure log is retained at `/tmp/gabs-import-continuation-checkpoint-regression.log`; the first parent review run is `/tmp/gabs-dependency-parent-review-tests.log`.

## Product acceptance

- Final headless browser/cross-surface suite: **8 passed**, `/tmp/gabs-dependency-final-web.log`.
- Final hidden/minimized Electron suite: **4 passed**, `/tmp/gabs-dependency-final-native.log`.
- These 12 journeys cover the new stopped-command graph on both clients, ordinary and linked-review exports through all four browser/desktop directions, and Settings import/restoration with native protected-store restart.
- Final focused continuation, import and API identity tests: **65 passed**, `/tmp/gabs-dependency-review-focused.log`.
- Final isolated unit/PostgreSQL regression: **880 tests across 121 files passed**, `/tmp/gabs-dependency-final-regression.log`.
- Strict root/browser/Node/preload/worker types, boundary/copy checks and **four fresh builds** passed: `/tmp/gabs-dependency-final-build.log`.
- Earlier four headless command/resource journeys passed before the final legacy-resource refinement and clock correction: `/tmp/gabs-import-continuation-existing-web.log`. These are historical regression evidence, not final-source acceptance.

Scoped dialog Axe A/AA checks and 390-pixel overflow checks pass. The final [browser review](web-review.png), [browser narrow actions](web-narrow.png), [native review](native-review.png) and [native narrow actions](native-narrow.png) were inspected. Selection labels, stopped-request explanations and lower actions remain readable and reachable in the existing scroll area. No stylesheet changed. This is scoped continuity evidence, not whole-product accessibility or final UI approval.

Fixture corrections wait for durable installation before going offline, use Settings for export and module views for corrections, reopen recovery after connectivity changes, scope navigation links and use the host's actual dialog markup for Axe. The first fixture run was deliberately interrupted after confirming the missing installation state; later failures ended normally. Final cases preserve the original behavioral assertions. Isolated databases and device profiles were removed. Historical captures rewritten by existing regression fixtures were restored; this milestone retains its four new captures.

## Remaining requirements

Imported record reassignment/collision choices, reconciliation of multiple saved snapshots, broader schema/target transitions, delayed identity/failure transitions, encrypted corporate archives and unreadable corporate-store recovery remain required. This milestone does not restore an arbitrary recovery graph from one file, trust copied remappings or complete the parent corporate backup requirement. Actual providers and signed target-platform acceptance remain separate gates. Overall parity and later UI refinement remain open.

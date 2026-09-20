# Imported command dependencies

Scope: **ID-03-BACKUP-DEPENDENCIES**, within ID-03-BACKUP-CORPORATE. Verification pending on 20 September 2026.

## Behavior

Imported requests are reconciled with the authoritative server before entering the journal. An uncommitted original is permanently stopped, including when its prerequisite has not yet been imported. Recovering the parent later does not revive that original.

A command correction can now explicitly select direct dependents whose original requests have been stopped. This changes only their scheduling prerequisite. Their original input, record identity, retry identity, cancellation and capture metadata remain intact. Legacy commands without explicit capture metadata retain the prerequisite list used for their retry identity before either scheduling view changes. Legacy resource entries without explicit capture arguments keep those arguments unknown; inferred scheduling edges are not relabeled as original capture arguments. Their exact recapture still finds the stopped original. Each stopped child still needs its own reviewed correction with a new retry identity before execution. Unselected children retain the original prerequisite.

The existing client recovery transaction owns this behavior in `packages/client/src/modules/command-recovery.ts`; no new importer-specific execution path or journal state is introduced. Selection requires current original/installed contracts, permissions and module availability, including across modules. Changed input, accepted outcomes or lost authority invalidate a selection before commit. File-supplied continuation choices are retained in the imported source but are not applied as current approval.

The correction UI explains that stopped children remain held for their own review. It uses the existing host components and styles.

## Verification scope

The new product journey independently builds, reviews, stages, publishes and installs two local SDK fixture modules. The fixture provisions workspace entitlements and grants; package execution and business requests use actual host paths. Source forms capture a parent and two cross-module dependents offline. After the parent is rejected, the source saves corrected input and a dependent selection, then exports the three requests through the actual product UI.

An independently authenticated destination receives only those unchanged files. It imports a child before the parent, verifies the child remains stopped with its original prerequisite, then imports the remaining requests. The parent's saved input returns, but its copied selections are unchecked. A fresh keyboard choice is saved and survives a renderer reload. Correcting the parent reconnects only that selected child. The parent correction is accepted while both child originals remain stopped. Explicitly correcting the selected child then creates its intended effect. Late sends of all three originals are refused; exact retries of both accepted corrections preserve two records and two audit entries.

Native tests use actual Electron/main/IPC/utility storage with independently keyed controlled OS protection and controlled native save-dialog selection. They are not physical-device, live MFA or actual OS-provider acceptance. Browser tests run headless and desktop tests hidden/minimized and unfocused.

## Checkpoint status

The final regression on the latest source failed three fresh-session import checks (865 passed, 3 failed across 121 files). PostgreSQL was measured 4–5 milliseconds ahead of the client wall clock; the strict client timestamp comparison can reject a valid authoritative session. This must be resolved before acceptance. The latest 17 focused continuation cases and four fresh builds passed. The browser/native and 867-case results below preceded the final legacy-resource metadata refinement and do not verify the checkpoint as a whole.

## Earlier product acceptance

- Actual headless browser, fresh source/destination storage: **1 passed**, `/tmp/gabs-import-continuation-web.log`.
- Actual hidden/minimized Electron, independently keyed source/destination stores: **1 passed**, `/tmp/gabs-import-continuation-native.log`.
- Full isolated unit/PostgreSQL regression: **867 tests across 121 files passed**, `/tmp/gabs-import-continuation-regression.log`.
- Four existing headless command/resource journeys passed, covering cross-module selection, a submitted/cancelled descendant and update/archive descendants: `/tmp/gabs-import-continuation-existing-web.log`.
- Focused continuation tests: **17 passed**, `/tmp/gabs-import-continuation-unit.log`. New cases cover cancelled command/create/update/archive prerequisites, separately corrected child ordering, unselected preservation, legacy capture metadata and permission/accepted-outcome/input changes during settlement.
- Strict checks and four fresh builds passed on final product source: `/tmp/gabs-import-continuation-build.log`. Later changes were confined to acceptance fixtures and documentation. Final root/browser/Node/preload/worker type checks and boundary/copy checks also passed: `/tmp/gabs-import-continuation-final-types.log` and `/tmp/gabs-import-continuation-final-lint.log`.

Scoped dialog Axe A/AA checks and 390-pixel overflow checks pass. The final [browser review](web-review.png), [browser narrow actions](web-narrow.png), [native review](native-review.png) and [native narrow actions](native-narrow.png) were inspected. Selection labels, stopped-request explanations and lower actions remain readable and reachable in the existing scroll area. No stylesheet changed. This is scoped continuity evidence, not whole-product accessibility or final UI approval.

Fixture corrections wait for durable installation before going offline, use Settings for export and module views for corrections, reopen recovery after connectivity changes, scope navigation links and use the host's actual dialog markup for Axe. The first fixture run was deliberately interrupted after confirming the missing installation state; later failures ended normally. Final cases preserve the original behavioral assertions. Isolated databases and device profiles were removed. 9 historical captures rewritten by existing regression fixtures were restored; this milestone retains its four new captures.

## Remaining requirements

Imported record reassignment/collision choices, reconciliation of multiple saved snapshots, broader schema/target transitions, delayed identity/failure transitions, encrypted corporate archives and unreadable corporate-store recovery remain required. This milestone does not restore an arbitrary recovery graph from one file, trust copied remappings or complete the parent corporate backup requirement. Actual providers and signed target-platform acceptance remain separate gates. Overall parity and later UI refinement remain open.

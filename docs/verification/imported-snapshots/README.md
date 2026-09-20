# Imported snapshot switching

Scope: **ID-03-BACKUP-SNAPSHOTS**, under ID-03-BACKUP-CORPORATE. Resource-draft and command-switching acceptance passed on 20 September 2026.

## Behavior

A user can compare another imported snapshot with the current local review and explicitly switch to it. The current draft or command review is retained as an inert imported copy in the same atomic write that restores the chosen snapshot. The original request call and current prerequisite identities stay unchanged. Displaced promotions are marked as replaced, allowing those snapshots to be restored again. Exact replay of an active promotion remains idempotent.

The comparison is bound to the current local content. Local edits before or during restoration invalidate the choice. Retention capacity is checked before original settlement and at commit; failed writes, lost authority and profile locking preserve local work and the incoming file. Already corrected originals cannot be reopened by switching snapshots. Current permissions and source contracts are checked for both incoming and displaced work.

Saved unresolved conflicts contain the user's competing input separately from the form's displayed server values. Restoration and comparison now recover those unresolved values, including field deletions, from saved review provenance. Current target reads rebuild conflicts with fresh choices. Completed choices remain desired input, not current server approval. Copied files remain unchanged.

The private client import layer owns capture, retention and atomic replacement. The shell uses existing dialogs, fields and controls; no styles changed. Native OS protection and development identity remain controlled fixtures.

## Acceptance

The new browser/native fixture exports two different drafts through Settings after actual public-SDK capture and a create collision. A fresh destination imports them, selects target and reference independently, switches from first to second, restores the automatically retained local review, and switches to second again, with a reload between switches. The current review is retained each time. Missing prerequisite receipts still block correction. Once the accepted receipt is restored, one new correction updates exactly the chosen record. Other records, stopped originals, exact-retry results and source file bytes are checked.

Focused tests additionally exercise stale choices before/during settlement, storage failure, revocation, lock, capacity exhaustion, reassigned targets and unresolved field removal. The command exported-file journeys are recorded below.

## Verification

- Focused import tests: 94 passed, `/tmp/gabs-snapshot-unit.log`.
- Initial full regression: 938 tests passed; initial broad native acceptance: 16 journeys passed, `/tmp/gabs-snapshot-regression.log` and `/tmp/gabs-snapshot-native.log`.
- Final strict environment/boundary/copy checks and **four fresh builds passed**, `/tmp/gabs-snapshot-final-build.log`.
- Final full regression: **939 tests across 121 files passed**, `/tmp/gabs-snapshot-final-regression.log`.
- Final **16 headless browser journeys passed**, `/tmp/gabs-snapshot-final-web.log`.
- Final **two hidden/minimized native journeys passed**, covering retained-copy switching and ordinary protected-storage import/restart, `/tmp/gabs-snapshot-final-native.log`.
- The final runs follow the inspection-collision fix, shortened switch label and stronger automatically retained-copy restoration assertion. Earlier counts do not verify those adjustments.
- All disposable databases and temporary device profiles were removed. Source review checked atomic retention, exact-call identity, current-authority guards and stale-selection detection.

The first browser attempt exposed the difference between displayed conflict values and saved competing input. The implementation and coverage were corrected without removing the acceptance assertion. A test fixture initially returned a removed field outside its current schema; it now uses a valid current response while checking retained historical deletion intent.

## Captures

All 12 final captures were inspected. The shortened selection fits at 390px; scoped Axe and overflow checks pass. Captures show scrolled dialog content, with the remaining content accessible by scrolling. No whole-product accessibility conformance or UI-polish approval is claimed.

| Surface | Initial import | Snapshot switch | Final correction |
| --- | --- | --- | --- |
| Browser | [Wide](web-update-original.png), [narrow](web-update-original-narrow.png) | [Wide](web-switch.png), [narrow](web-switch-narrow.png) | [Wide](web-update-original-review.png), [narrow](web-update-original-review-narrow.png) |
| Desktop | [Wide](native-update-original.png), [narrow](native-update-original-narrow.png) | [Wide](native-switch.png), [narrow](native-switch-narrow.png) | [Wide](native-update-original-review.png), [narrow](native-update-original-review-narrow.png) |

## Command exported-file acceptance

Actual public-SDK capture produces a request with a collision-reference hint. The source exports that request, saves a changed command review through the module interface, then exports the second snapshot through Settings. A fresh destination imports both exact files, switches to the second snapshot, restores the automatically retained first review, and switches back to the second after reload. Explicit keyboard selection is required each time.

Both original-record and separate-record corrections are covered in headless browser and independently keyed hidden/minimized desktop stores. Missing prerequisite receipts block correction; restoring the actual exported parent receipt requires current server verification. The command then requires an explicit reference choice. Original input, retained copies and source bytes remain intact. The final server state has exactly three records and three create audit entries, including exactly one corrected command effect. Exact correction retries do not add effects, and the original request receives `ATTEMPT_CANCELLED`.

Checkpoint `179beb8` was followed by the requested Sol xhigh architecture review. The only cleanup makes the shared helper require an explicit draft or command mode. Parent review accepted its three-file diff; production code, public contracts and UI remain unchanged. See the [architecture review](../architecture/README.md#command-snapshot-checkpoint-review-20-september-2026).

Verification for this test-only increment:

- Strict TypeScript environment checks and boundary/copy checks passed: `/tmp/gabs-command-snapshots-final-types.log`, `/tmp/gabs-command-snapshots-final-lint.log`.
- Two headless command journeys passed: `/tmp/gabs-command-snapshots-web.log`.
- Two hidden/minimized desktop command journeys passed: `/tmp/gabs-command-snapshots-native.log`.
- Three shared browser regressions passed, covering resource snapshot switching and both existing reference-hint targets: `/tmp/gabs-command-snapshots-shared-web.log`.
- After delegated cleanup, final strict checks passed (`/tmp/gabs-command-review-types.log`, `/tmp/gabs-command-review-lint.log`), followed by **three headless browser and three hidden/minimized desktop journeys** covering both command targets and resource-draft switching (`/tmp/gabs-command-review-web.log`, `/tmp/gabs-command-review-native.log`). The inspected captures from the initial acceptance pass are retained; rerun UUID-only image churn was discarded. Scoped helper formatting also passes.
- The initial browser fixture incorrectly looked for export in the module inbox. It was corrected to use the existing Settings export action; no production code changed.
- All 16 new command captures were inspected. Scoped Axe and 390px overflow checks passed. Dialog content remains scrollable; long values use ordinary input scrolling. These checks do not approve the broader UI design.
- Temporary databases and device profiles were removed. The earlier 939-test/four-build result is the unchanged production baseline, not a new run for these acceptance additions. Desktop protection and authentication are still controlled development fixtures.

| Surface and target | Snapshot comparison | Saved command review |
| --- | --- | --- |
| Browser, original | [Wide](web-command-original-switch.png), [narrow](web-command-original-switch-narrow.png) | [Wide](web-command-review-original.png), [narrow](web-command-review-original-narrow.png) |
| Browser, separate | [Wide](web-command-separate-switch.png), [narrow](web-command-separate-switch-narrow.png) | [Wide](web-command-review-separate.png), [narrow](web-command-review-separate-narrow.png) |
| Desktop, original | [Wide](native-command-original-switch.png), [narrow](native-command-original-switch-narrow.png) | [Wide](native-command-review-original.png), [narrow](native-command-review-original-narrow.png) |
| Desktop, separate | [Wide](native-command-separate-switch.png), [narrow](native-command-separate-switch-narrow.png) | [Wide](native-command-review-separate.png), [narrow](native-command-review-separate-narrow.png) |

## Remaining scope

ID-03-BACKUP-SNAPSHOTS is **verified** within the resource-draft and command evidence above. ID-03-BACKUP-ARCHIVE is the next ready item. This switches snapshots of the same exact original request while preserving current local prerequisites. It does not merge contradictory request identities or automatically remap business references. Broader mixed graphs, authority/source/failure transitions, encrypted corporate archives, corporate key loss and real provider/platform acceptance remain required. Overall parity and later UI refinement remain open.

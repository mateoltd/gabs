# Imported snapshot switching

Scope: **ID-03-BACKUP-SNAPSHOTS**, under ID-03-BACKUP-CORPORATE. Resource-draft acceptance passed on 20 September 2026. Command-switching interface acceptance remains open.

## Behavior

A user can compare another imported snapshot with the current local review and explicitly switch to it. The current draft or command review is retained as an inert imported copy in the same atomic write that restores the chosen snapshot. The original request call and current prerequisite identities stay unchanged. Displaced promotions are marked as replaced, allowing those snapshots to be restored again. Exact replay of an active promotion remains idempotent.

The comparison is bound to the current local content. Local edits before or during restoration invalidate the choice. Retention capacity is checked before original settlement and at commit; failed writes, lost authority and profile locking preserve local work and the incoming file. Already corrected originals cannot be reopened by switching snapshots. Current permissions and source contracts are checked for both incoming and displaced work.

Saved unresolved conflicts contain the user's competing input separately from the form's displayed server values. Restoration and comparison now recover those unresolved values, including field deletions, from saved review provenance. Current target reads rebuild conflicts with fresh choices. Completed choices remain desired input, not current server approval. Copied files remain unchanged.

The private client import layer owns capture, retention and atomic replacement. The shell uses existing dialogs, fields and controls; no styles changed. Native OS protection and development identity remain controlled fixtures.

## Acceptance

The new browser/native fixture exports two different drafts through Settings after actual public-SDK capture and a create collision. A fresh destination imports them, selects target and reference independently, switches from first to second, restores the automatically retained local review, and switches to second again, with a reload between switches. The current review is retained each time. Missing prerequisite receipts still block correction. Once the accepted receipt is restored, one new correction updates exactly the chosen record. Other records, stopped originals, exact-retry results and source file bytes are checked.

Focused tests additionally exercise commands, stale choices before/during settlement, storage failure, revocation, lock, capacity exhaustion, reassigned targets and unresolved field removal. Command switching has unit coverage; the new end-to-end switching path is a linked resource draft.

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

## Remaining scope

Command switching is implemented and unit-tested; its real exported-file browser/native interface journey is the next acceptance gate. ID-03-BACKUP-SNAPSHOTS remains **verify** until that passes. This switches snapshots of the same exact original request while preserving current local prerequisites. It does not merge contradictory request identities or automatically remap business references. Broader mixed graphs, authority/source/failure transitions, encrypted corporate archives, corporate key loss and real provider/platform acceptance remain required. Overall parity and later UI refinement remain open.

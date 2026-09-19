# Submitted work after create collisions

OFF-01-COLLISION-OUTCOME, 19 September 2026. The command-outcome milestone has scoped local acceptance. The tracker item remains active for broader cancelled resource and mixed-graph acceptance. The follow-up below adds cancelled-archive browser/native evidence.

## Behavior

A failed create previously refused replacement whenever any descendant had been submitted, even after the server confirmed that descendant's outcome. The client now treats a validated accepted receipt as the end of that recovery branch. It preserves the exact original request, result, identity and dependencies. Descendants depending only on that receipt stay on their existing branch; a separate direct dependency on the failed create still requires recovery. Accepted effects are never copied, retargeted or executed again.

Accepted branch results are validated using their original signed response contract. Artifact pruning retains that contract while an unresolved dependency remains. Normal cleanup still works once the dependency is retired; malformed receipts and unavailable contracts block replacement.

Attempted custom commands can join the existing explicit review flow only after authoritative cancellation. Their original calls, keys, attempt counts and capture prerequisites remain unchanged. Execution prerequisites reconnect to the new parent; the command stays held as a conflict until its own review is saved and explicitly submitted. A chain of cancelled commands requires separately selected continuation and separate review for each command. Selection never replays a cancelled request. The original cancellation remains durable if a local write fails.

The parent dialog explains accepted effects and directs uncertain work to Settings recovery. Command continuation explains when a selected command will still need its own review. Existing styling and signed historical artifacts are unchanged.

## Acceptance scope

The two new browser/native journeys use an independently signed module with a generated resource view and a custom queued command. They cover:

- A failed create with a previously attempted linked command, parent replacement blocked while the command outcome is unknown, and exact input preserved.
- Real server acceptance or cancellation, a lost settlement reply, offline restart and a second explicit outcome lookup.
- Accepted effects preserved on the existing corporate record while the separate parent is created, with duplicate-safe original-key retries and exactly three resource-create audit entries.
- Cancelled commands held after parent acceptance, saved explicit reference review, offline restart, permission revocation/regrant, a second lost settlement reply during correction, and one accepted replacement effect.
- Visible pending/accepted state, Settings recovery, generated tables and scoped accessibility checks. Desktop journeys assert that every window stays hidden or minimized and unfocused.

The fixture seeds legacy delivery metadata because the current scheduler correctly prevents a child from being submitted behind a failed create. Accepted effects and settlement receipts come from the actual API and PostgreSQL; no accepted result is fabricated. These are legacy-envelope recovery journeys, not evidence that the current scheduler produced an out-of-order send.

Unit coverage additionally checks accepted create/update/archive branches, branch-specific graph traversal, retained contracts after upgrade, invalid accepted receipts, cancellation write interruption and individually reviewed command chains. Resource acceptance at this stage is unit-level; cancelled create/update/archive continuation and full mixed-resource browser/native journeys remain required.

## Verification and review

The isolated full regression passed 598 unit/PostgreSQL tests across 89 files in `/tmp/gabs-collision-outcome-regression.log`. Focused verification passed 97 tests across three files. Strict root/browser/Node/preload/worker checks, boundary/copy checks and all four fresh production builds passed in `/tmp/gabs-collision-outcome-build-final.log`. The focused test log is `/tmp/gabs-collision-outcome-unit.log`.

Eight distinct headless browser journeys passed across the final product build: six existing command/archive regressions in `/tmp/gabs-collision-outcome-web-final.log`, then the two new outcome journeys in `/tmp/gabs-collision-outcome-web-accepted.log`. The first log also records the new test failures before fixture corrections; it is not an uninterrupted eight-case pass.

The first unit run exposed overly broad contract retention. Retention was narrowed to entries with unresolved dependencies, preserving existing pruning behavior. Initial browser attempts exposed test assumptions: an ambiguous Settings link, an offline inbox that must be reopened after authorization refresh, and a saved parent review that correctly becomes “Resume review.” These were fixture corrections, not relaxed acceptance criteria. Intermediate logs remain at `/tmp/gabs-collision-outcome-web.log` and `/tmp/gabs-collision-outcome-web-recovery.log`.

Eight hidden/minimized, unfocused Electron journeys passed in `/tmp/gabs-collision-outcome-native.log`. Visual inspection covered all twelve retained captures: unknown command outcomes, accepted tables, and wide/narrow offline corrections. One browser capture was taken before the modal reached its visible animation phase; the browser fixture now waits for that phase and full opacity. The affected journey passed again in `/tmp/gabs-collision-outcome-web-capture.log`, and its four refreshed captures were reinspected. Scoped dialog Axe and overflow checks passed; this does not establish whole-product accessibility or final design approval.

Review checked accepted branch traversal, malformed receipt rejection, original-contract retention and pruning, permanent cancellation before held continuation, unchanged request/capture identities, individual command-chain review and current authorization checks. Changed-source formatting and diff checks passed. Historical captures overwritten by the regressions were restored.

Full parity, broader OFF-01 recovery, production release acceptance and the later UI-refinement goal remain open.


## Cancelled resource review follow-up

The [delegated architecture review](../architecture/README.md#resource-recovery-checkpoint-review-19-september-2026) completed the checkpoint's resource-review contract. Server-cancelled create/update/archive descendants retain their original requests and identifiers, reconnect prerequisites and remain held for explicit review. Review snapshots include the original/separate record context; stale snapshots cannot be saved or submitted. Resuming a changed context requires accepted prerequisites and a refreshed selected record/comparison while retaining saved user input. Portable draft exports retain their own review snapshot. Accepted child entries remain unchanged when a reviewed resource is replaced; unknown child outcomes block replacement.

The new real browser/native archive journey obtains a permanent cancellation from the API, seeds only the corresponding legacy client delivery state, and then uses the normal UI for failed-parent replacement and explicit archive review. It covers separate-target selection, unchanged original archive input, offline process/page restart, a lost settlement reply, exact cancelled-key 409 responses, accepted-key replay, one archive audit entry, the unchanged existing corporate record and the visible archived separate record. It does not claim the current scheduler sends children behind a failed create, or that the seeded state tests the entire initial Settings settlement flow.

Final verification passed 600 isolated unit/PostgreSQL tests, 99 focused tests, strict environment/boundary checks and four fresh builds. Seven distinct browser and seven hidden/minimized native collision journeys passed. The architecture record lists exact logs, corrected fixture failures and run ordering. Wide and narrow review dialogs passed scoped Axe/overflow checks. Six captures per client are retained in [archive-cancelled](archive-cancelled/), covering choices, review, accepted records and narrow navigation. Existing visual design is preserved; these checks do not establish full-product accessibility or final UI approval.

Remaining acceptance: cancelled create/update in the real clients, repeated parent collisions while a resource review is saved/open, accepted resource effects in the real clients and wider mixed graphs. The additional resource correction/export checks are unit-level evidence. OFF-01-COLLISION-OUTCOME remains active.

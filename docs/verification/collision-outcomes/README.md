# Submitted work after create collisions

OFF-01-COLLISION-OUTCOME, 19 September 2026. Command and resource recovery evidence is recorded below in delivery order. The real two-tab stale-review journey now passes. The tracker item remains active for final desktop resource acceptance, currently awaiting available OS-protected storage on an unlocked Mac.

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

## Resource outcomes and saved reviews

The follow-up adds six resource journeys through the public SDK, signed releases, generated views and Settings recovery: accepted and cancelled create, update and archive. It changes acceptance fixtures only; production code remains at `ae0740a`.

Each journey captures a failed parent create, a dependent resource write and independent work. Unknown descendant outcomes block parent replacement. Actual API execution or permanent cancellation establishes the outcome, and a lost settlement reply plus offline restart requires explicit recovery from Settings. Accepted requests, receipts, dependencies and effects remain unchanged. Cancelled originals retain their exact requests and permanent fences while explicitly reviewed replacements use fresh identities. Original-key and replacement-key retries check duplicate-free effects and audit counts.

Cancelled create and update save a review before the parent changes. The update case combines an accepted create sibling with a cancelled update, forces a second collision against a real server record, and restarts before recovering again. Both parent replacements preserve the saved review and accepted sibling. Resuming rebuilds the comparison against the final chosen record; the saved local value remains visible. The final user choice is saved, resumed offline and explicitly submitted after reconnecting. The existing corporate record and competing record stay unchanged, and unrelated work progresses.

These journeys seed only legacy client delivery metadata under the normal storage locks. Server effects, cancellation fences and receipts come from the real API and isolated PostgreSQL database. They do not claim that the current scheduler submits children behind a failed create. Temporary control of two generated UUIDs makes the second real collision deterministic; it does not fabricate a server error or accepted result.

Verification is being finalized for the corrected desktop fixture. The browser's final six resource cases passed after correcting the capture helper to await a visible dialog. An earlier eight-case browser pass also includes the existing accepted/cancelled command regressions. The initial desktop run passed six cases and failed two during fixture setup: it entered the next note before the previous capture callback cleared the form. The fixture now awaits the completed form reset and durable independent capture before reconnecting. This is separate from the earlier fixture corrections for self-reference metadata, the edit-target label and the generated reference combobox.

Logs: `/tmp/gabs-collision-resource-web-final.log` records eight passing browser cases; `/tmp/gabs-collision-resource-web-capture.log` records the six resource cases after form/capture waits. `/tmp/gabs-collision-resource-native.log` records the first desktop run (six passed, two setup failures). `/tmp/gabs-collision-resource-native-final.log` records the incomplete corrected run: two passed, window-closure and selector failures, then authentication timeout/failure as the runtime stopped responding. A direct PostgreSQL connection timed out and `docker compose ps` hung. The helper is still waiting to drop isolated database `suite_host_ui_1789807465682`; cleanup is not complete. Restarting the shared OrbStack runtime awaits user approval. A stronger saved-field assertion was added after these runs and still needs its two browser cases plus the final six desktop cases. Root TypeScript, changed-test formatting, boundaries/copy and diff checks passed; the previous architecture review's full unit suite/builds are historical evidence on unchanged production code.

The remaining interface gates are the final desktop resource run and a resource review left open while another recovery changes its context. Existing durable guards reject stale saves/submissions, but these saved-and-reopened journeys do not establish concurrent open-editor behavior. Broader OFF-01, release acceptance and final UI refinement remain unfinished.


### Runtime-blocked follow-up

The database still timed out on recheck, and the same isolated helper remains live in its cleanup query. No OrbStack restart has been performed. The native fixture now attaches non-secret lifecycle events on failure (launch, page close/crash, process exit code/signal and whether closure was expected) and includes the development-authentication HTTP status. These diagnostics do not weaken failure assertions.

The repeated-update browser fixture now opens a real second tab before parent recovery, keeps its resource review open across the two parent replacements, and asserts that stale autosave and submission fail without replacing the saved draft or losing the open input. This addition is not yet accepted: TypeScript passes, but execution awaits database recovery. Desktop sender validation in `apps/desktop/src/main/main.ts` accepts only the main window; adding an unsupported second native renderer would misrepresent that client. Its supported single-window flows still need the final six-case run, alongside the previously verified durable context checks.


The third consecutive goal-turn recheck still timed out connecting to PostgreSQL. The isolated helper was confirmed live as PID `53773` / executor session `50773`, with test execution finished and database cleanup pending. Goal continuation is blocked on runtime recovery rather than marked complete. No new acceptance run, OrbStack restart or commit was performed.


### Resumed browser acceptance and desktop storage dependency

PostgreSQL recovered before the resumed turn. The old helper terminated, its log confirmed cleanup, and a catalog query confirmed the isolated database was absent. No assistant-initiated OrbStack restart occurred.

The stronger cancelled-create saved-input case passed in `/tmp/gabs-collision-resource-web-resumed.log`. The new two-tab update case initially expected the context guard's message, but the earlier record-target guard correctly rejected the stale target. Its exact expectations were corrected without changing the product or relaxing the no-write/preserved-input assertions. The complete repeated-update/two-tab journey then passed in `/tmp/gabs-collision-resource-web-peer.log`; [the stale editor capture](resources/update-cancelled/web-open-stale-review.png) was inspected.

The six-case desktop rerun (`/tmp/gabs-collision-resource-native-resumed.log`) was interrupted after repeated missing-form failures. A single-case diagnostic (`/tmp/gabs-collision-resource-native-diagnostic.log`) reproduced the failure and captured [protected storage unavailable](resources/protected-storage-unavailable/native.png). macOS reported `CGSSessionScreenIsLocked: true`, and Keychain returned “User interaction is not allowed.” The application refused protected installation/offline storage; this is not accepted as successful recovery behavior. A native preflight now reports unavailable OS-protected storage before the journey, and failure attachments preserve the real screen and lifecycle events. No credential protection is mocked or bypassed.

The final six minimized desktop cases require an unlocked Mac/login keychain and remain pending. Earlier window/selector failures during the database outage are not assigned a proven common cause. Browser acceptance and unchanged production-code unit/build evidence do not substitute for this desktop gate.

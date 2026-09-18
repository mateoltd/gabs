# Later edits after a create collision

OFF-01, 18 September 2026. Extends [create-collision recovery](../create-collisions/README.md) to never-submitted same-record updates with explicit target selection and subsequent review.

## Behavior and boundaries

A dependency edge identifies an edit as related to the failed create. For each same-record update, the recovery dialog requires a choice between the separate record and the existing corporate record. Saved values can be inspected through the existing disclosure. Missing or stale choices reject replacement without rewriting the journal. A received accepted original receipt still recovers the original result rather than creating another record.

After authoritative cancellation, replacement and target choices commit atomically. These updates retain their original body and base snapshot as review input, with a separate local target marker. They remain conflicts awaiting review, not executable pending requests. Historical entries retain their original calls. Other eligible linked records follow the replacement through the existing declared-reference remapping.

Review waits for accepted prerequisites, fetches the selected target's current server state and uses the existing original/local/server comparison. Saving creates a fresh validated request against that target and atomically reconnects dependents. An arbitrary third target is rejected. Known uncertainty or prior submission still prevents identity replacement. Repeated parent collisions require fresh choices for retained edits. Resource ordering and archive preflight follow the chosen target without changing the preserved original call.

If the selected target has been archived, recovery remains read-only. Export retains the source record ID, captured version, module version and saved data, rather than attaching the source version to the different target. Broader archive-command and custom-operation recovery remain separate work.

## Actual journeys

The browser and hidden native journeys create a queued Contact and linked note, cause a collision from another authenticated session, and capture two later edits through the actual generated UI. One edit is assigned to the separate record and one to the existing corporate record. A lost settlement reply and restart preserve input. The target choices are committed on explicit confirmation; another restart proves that neither update executes automatically. Review of the first edit can be closed and resumed offline; reconnecting and saving releases the second review.

PostgreSQL assertions verify both chosen records reach version two with their respective phone edits, preserved names and exactly two update audits. The original corporate record remains unchanged until its own explicit review is saved. The linked note follows the new parent. Original bodies remain intact, repeating accepted create keys does not duplicate effects, and the old parent key remains permanently cancelled.

A separate browser journey archives the chosen target before review, downloads the recovery file and verifies its original ID, base version and exact saved values. Neither pending update is applied and the existing corporate record stays unchanged.

Focused checks cover missing/stale choices, prerequisite enforcement, wrong-target rejection, repeat collisions, original-input retention, archived-source metadata and archive ordering against the chosen target. Existing uncertainty, permission, cancellation and atomic-write tests remain in the full regression suite.

## Verification

- Strict root/browser/Node/preload/worker TypeScript, boundary/copy checks and all four builds passed: `/tmp/gabs-collision-edits-build-final.log`.
- Full unit/PostgreSQL regression passed **468 tests across 81 files**, including five new target/review cases: `/tmp/gabs-collision-edits-full-final.log`.
- **Seven distinct headless browser journeys** passed on final product source: linked collision recovery, later-edit target recovery, archived chosen-target export, new/legacy record ordering, ordinary archived input and cross-module capture. The broad run passed six and exposed the archived test's wrong dialog name; the corrected case passed separately. Logs: `/tmp/gabs-collision-edits-web-final.log` and `/tmp/gabs-collision-edits-archived-final.log`. This is cumulative scoped acceptance, not an uninterrupted seven-case run.
- **Six hidden/minimized native journeys** passed on final source: linked/later-edit collision recovery, new/legacy ordering, settlement and archived input: `/tmp/gabs-collision-edits-native-final.log`.
- Changed-file formatting, diff and local documentation-link checks passed. Builds and acceptance runners were serialized; product source remained frozen during final acceptance.

The first strict build caught an unsupported Select prop and an overly strict type for partial choices; both were corrected. The new archived-target browser test initially expected the ordinary edit dialog's title; it now uses the existing “Recover input” title and passes. No timeout or validation was weakened.

## Visual evidence

[Web confirmation](web-confirmation.png), [web narrow confirmation](web-confirmation-narrow.png), [web result](web-recovered.png), [web narrow result](web-recovered-narrow.png), [web archived target](web-archived-target.png). [Native confirmation](native-confirmation.png), [native narrow confirmation](native-confirmation-narrow.png), [native result](native-recovered.png), [native narrow result](native-recovered-narrow.png).

All nine captures were inspected. The existing UI kit, modal, saved-value disclosure, form spacing and keyboard interaction are retained. Scoped Axe and overflow checks pass. No stylesheet changed. Historical regression screenshots are restored. This is functional continuity, not final UI-polish approval or whole-product accessibility conformance.

## Remaining scope

Unjournaled ambiguous drafts, archive/custom-command descendants, already-submitted child outcomes, permanent revocation and broader profile/release acceptance remain required. The archived-target file journey is browser evidence; native export authority retains its separate acceptance. Local development services and unsigned hidden Electron do not establish hosted or signed-release acceptance. OFF-01 and full parity remain active.

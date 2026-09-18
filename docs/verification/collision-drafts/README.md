# Ordinary drafts during create-collision recovery

OFF-01, 18 September 2026. Extends [collision-edit recovery](../collision-edits/README.md) to ordinary saved drafts without treating a draft as an accepted or submitted operation.

## Recovery contract

Saving a draft retains its module version and verified response contract. Recovery inspects that saved schema to distinguish declared record references from coincidental IDs in free text. A draft editing the colliding record is recognized through its captured target, even if no field contains that ID.

The dialog requires an explicit choice for every affected draft. Each choice includes a fingerprint of the input, target, source version and slot revision. A concurrent change invalidates the choice. Current read/write access is required for each affected resource. Known queued-resource drafts become independent saved reviews after authoritative cancellation; the new parent, journal replacements and draft promotion commit together. No request is invented or sent for the ordinary draft. Original values and the original target remain in review metadata.

Users may follow the separate record or keep the existing corporate record. Reference remapping uses the original schema. Targeted edits wait for the parent's acceptance, fetch their selected server record and enter the existing comparison flow. Draft creates also require explicit resumption and submission. A prepared review can resume offline. Submission uses current rules, permissions and declared execution policy.

Moving or consuming an ordinary slot advances its revision. An editor holding the old revision cannot overwrite or submit it. A consumed collision review cannot be resurrected by a stale writer. Repeat parent collisions reconnect preserved review prerequisites without changing an earlier existing-record choice.

Unknown historical schemas and online-policy drafts may lack evidence of prior delivery. They can be explicitly kept unchanged, but cannot be automatically moved or promoted. Their preview does not claim they were never submitted. Other unresolved direct/queued reviews are not rewritten. These limits retain exact input and do not authorize a new retry identity for an uncertain effect.

## Actual journeys

The browser/native fixture captures a queued Contact and note, causes a server-side identity collision, then saves two ordinary drafts through the generated UI: an edit to the existing corporate record and a note referring to it. Both remain unqueued. The user chooses the separate record for the edit and the existing record for the note. Keyboard disclosure exposes the saved values.

A lost settlement reply, restart and renewed confirmation preserve the drafts. Promotion removes the ordinary slots but adds no operation to the journal. Another restart restores the independent reviews. The Contact review fetches the newly accepted record, retains its name and applies only the intended phone edit after explicit save; it also survives closing and resuming offline. The note is explicitly saved against the existing record. PostgreSQL checks establish the exact IDs, data, record versions and audit counts, including the unchanged original corporate record and both correctly linked notes.

Focused checks additionally cover false-positive free-text IDs, original schemas after an upgrade, target-only drafts, changed-choice rejection, legacy/online preservation, atomic write interruption, stale writers and repeated collisions.

## Verification

Final product source passed strict root/browser/Node/preload/worker TypeScript checks, boundary/copy checks and all four production builds. The isolated PostgreSQL unit suite passed **474 tests across 81 files**. Nine headless browser journeys passed. The final hidden/unfocused desktop regression passed **eight journeys**, followed by **nine passing collision cases** (three repetitions of linked, same-record edits and ordinary drafts). Product source remained frozen throughout these runs. The only intervening harness change made a failed dialog-close assertion include the remaining dialog text, preserving its five-second timeout and empty-dialog acceptance criterion.

Logs: `/tmp/gabs-draft-collision-build-final2.log`, `/tmp/gabs-draft-collision-full-final.log`, `/tmp/gabs-draft-collision-web-final.log`, `/tmp/gabs-draft-collision-native-diagnostic2.log` and `/tmp/gabs-draft-collision-native-diagnostic3.log`. Source and diagnostic-harness formatting checks passed. Isolated databases were removed.

Two earlier mixed desktop runs intermittently left the linked-only confirmation open at the five-second assertion. Other cases, including ordinary drafts, passed. Native traces lacked DOM snapshots, so they did not establish the dialog's state or the cause. Three isolated linked repetitions, the final eight-case regression and all nine instrumented repetitions passed. This is a retained intermittent reliability concern, not a claimed product fix or a reason to weaken acceptance. A future recurrence now reports the remaining dialog text; full release reliability remains open.

Initial strict checks caught internal typing mistakes while extracting the shared saved-value renderer and adding optional review state; they were corrected. One old unit fixture opening a new ordinary draft after legacy promotion needed the current slot revision. The real UI captures that revision when opening or resuming an editor. Validation and timeouts were not weakened.

## Visual evidence

[Web confirmation](web-confirmation.png), [web narrow confirmation](web-confirmation-narrow.png), [web result](web-recovered.png), [web narrow result](web-recovered-narrow.png). [Native confirmation](native-confirmation.png), [native narrow confirmation](native-confirmation-narrow.png), [native result](native-recovered.png), [native narrow result](native-recovered-narrow.png).

The existing UI kit, modal, keyboard disclosure and form layout are reused. No stylesheet changed. Scoped Axe, keyboard disclosure and document-overflow checks passed. All eight web/native wide/narrow captures were inspected: the confirmation keeps its choices inside the scrollable modal, and the recovered table retains the existing responsive layout. Historical regression screenshots were restored to their committed bytes. This establishes scoped visual continuity, not whole-product accessibility or final UI polish.

## Remaining scope

Automatic transfer of legacy/online input is not accepted because prior delivery and original schema meaning may be unknown. Exact preservation is supported; their wider outcome/profile recovery remains required. Queued custom/archive commands, submitted child outcomes, permanent revocation, profile removal and hosted/signed-release acceptance remain required. This is local development-service and hidden desktop evidence. OFF-01 and full parity remain active.

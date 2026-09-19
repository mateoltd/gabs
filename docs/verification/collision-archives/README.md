# Archive descendants after a create collision

OFF-01-COLLISION-ARCHIVE, 19 September 2026. Scoped acceptance verified; full OFF-01 and parity remain open.

## Problem and behavior

The previous generated collision dialog omitted archive descendants from target selection, and the client rejected them as unsupported linked work. The new real browser journey reproduced the missing choice against the previous build: `/tmp/gabs-collision-archive-before.log`. The confirmation was enabled without any archive target choice; the old client would reject graph replacement rather than provide a recovery path.

Never-submitted same-record archive descendants now require an explicit choice between the separate record and the existing corporate record. Their original target/base/input remain intact. After the original create is authoritatively cancelled, graph replacement saves the selected archive target separately and leaves the archive as a conflict awaiting review. Accepting the new parent or restarting the client does not archive either record.

The subsequent archive review loads the selected current server record and displays the original source separately. It requires accepted prerequisites and current read/write authority, fences the retained archive identity, and only then queues a new request using the explicitly reviewed target/version. Existing archive receipt, cancellation and uncertainty rules remain in force. Archive requests are not passed through data-field remapping.

A repeated parent collision also preserves prior existing-target reviews for both updates and archives. Those changes retain their original input and conflict state; reconnecting the parent does not silently make them executable.

## Acceptance scope

Two real SDK journeys capture a conflicting create and its archive while offline, install an independently signed generated-view release, explicitly choose each destination, lose the parent settlement reply, restart, and complete create recovery. Another offline restart proves the archive remains inert. Explicit archive review then loses a settlement reply, restarts again, and completes exactly one archive effect with one audit entry. Original inputs, both server records, retry outcomes and the unselected record are asserted.

Focused storage tests cover both destinations, missing choices, prerequisite rejection before network settlement, existing-target review retention across repeated parent collisions and an unchanged archive of another record. The full 580-test regression passed across 89 files. The final 70-case focused run adds an independent-target archive and ordered archive-review chain, for 582 distinct passing tests across these runs. The full run preceded the final guard correction; all affected storage tests were rerun afterward. Final strict checks and four fresh builds passed: `/tmp/gabs-collision-archive-build-final.log`. Acceptance covers eight distinct headless browser and seven hidden/minimized, unfocused Electron journeys. The four affected archive cases in each client passed again after the final guard correction; the other collision cases passed before that guard-only change:

- `/tmp/gabs-collision-archive-web-final.log`: both archive target choices and both existing archive-review cases, four passed.
- `/tmp/gabs-collision-archive-web-regression-final.log`: linked creates, later edits, archived-target export and ordinary drafts, four passed.
- `/tmp/gabs-collision-archive-native-final.log`: both archive target choices and both existing archive-review cases, four passed.
- `/tmp/gabs-collision-archive-native-regression-final.log`: linked creates, later edits and ordinary drafts, three passed.

The full unit/PostgreSQL log is `/tmp/gabs-collision-archive-regression.log`; the final focused log is `/tmp/gabs-collision-archive-unit-final.log`. Changed-source formatting and diff checks passed. Historical screenshots overwritten by regression runs were restored. No acceptance timeout or criterion was relaxed.

## Narrow navigation correction

Visual review found text leaking into the dialog from a long module label in the closed navigation. Clearing hover tooltips did not remove it. A real failing-before assertion showed `.sidebar .nav-label` remained visible because the narrow label rule overrode the hidden ancestor: `/tmp/gabs-collision-archive-navigation-before.log`. The narrow rule now inherits visibility and constrains long labels within their links using ellipsis. Tests require closed labels to be hidden, open labels to be visible and contained, and Escape to hide them again. This is the only stylesheet change; it preserves the existing layout and appearance.

Already-submitted collision descendants, custom-operation collision recovery and other legacy/profile/release requirements remain separate required work. This milestone does not broaden corporate offline authority or constitute final UI-polish approval.


## Visual evidence and review

Twenty final captures are retained under `separate/` and `existing/`, five per client/destination. Twelve were inspected: every `choice-narrow`, `review` and `navigation-narrow` capture across both destinations and both clients. The current record, original source and selected recovery target are distinct; long labels stay inside the open navigation and disappear on close. Scoped dialog Axe/overflow assertions and keyboard Escape checks passed. This is not a full-theme/accessibility sweep or approval of the final product design.

Production review checked the entire four-file diff: both update/archive same-record discovery, exact original-input preservation, old existing-target review retention, prerequisite checks before settlement, and the narrow visibility inheritance. Client ownership, authoritative server validation, current permission checks and original-request settlement remain intact.


## Ordered archive-review guard

Final review found that the archive settlement helper treated a later conflict awaiting collision review as possibly submitted, even when durable metadata proved it had never been sent. The new two-archive regression reproduced that rejection: `/tmp/gabs-collision-archive-chain-before.log`. The guard now permits a later collision review only when it remains a conflict with a recovery marker, unsubmitted delivery and zero attempts. It remains awaiting its own confirmation while dependency edges reconnect. Unknown, attempted or submitted children still block replacement. The regression chooses different targets and asserts ordered, separately confirmed effects.

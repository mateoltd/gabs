# Same-record queued edits

OFF-01, 18 September 2026. This extends [cross-module dependency recovery](../cross-capture/README.md) and [explicit conflict review](../conflict-review/README.md).

## Behavior

Enqueueing a new resource write now records prerequisites for unresolved writes to the same account, workspace, module, resource and record. The local storage transaction commits the request and its edges together. The newest dependent normally waits only on the preceding write; independent older branches are joined. Accepted and superseded entries and unrelated scopes are excluded. Concurrent saves share the existing storage lock.

A reviewed replacement retains its original prerequisites and position. Existing dependents are reconnected to its fresh request key atomically; later edits do not become prerequisites of the reviewed predecessor. Rejection or uncertainty keeps later same-record work waiting while unrelated authorized work can continue.

Ordering never rewrites a captured request, invents a future server version, or treats provisional input as accepted. Each edit retains the actual server snapshot used when it was captured. The server merges disjoint changes against its own revision history. Overlapping changes still need explicit review, including when the competing change was an earlier edit from this device.

Pending create/update rows now offer **View saved change**. The read-only disclosure shows the capture time, saved base version, and original/saved values for changed fields. Missing original values are explicit; removed properties are included. It reuses the schema value renderer and scoped reference loader, mounting the latter only while expanded. The existing panel, fieldset and responsive comparison styles remain in use.

## Actual journey

Headless Chromium and hidden/minimized Electron exercise the same authenticated company workflow:

1. Capture three edits to one Contact while offline: two overlapping phone changes and a separate email change. Capture an unrelated Contact edit.
2. Reload the browser or restart Electron offline. Verify exact saved calls and dependency edges. Expand the individual saved changes by keyboard and inspect distinct values at wide/narrow widths.
3. Make a disjoint authoritative address change. Reconnect and lose the first successful phone-edit response. Verify exact-key retry, acceptance of that first edit, conflict on the second, the third still waiting, and unrelated progress.
4. Explicitly choose the second phone edit during conflict review. Its new request occupies the same dependency position; the email edit follows after acceptance.
5. Assert exact PostgreSQL data, final versions and five update audits. The unrelated server address survives, the intended phone/email values are retained, and the lost response creates no duplicate effect.

Focused storage checks additionally cover interrupted commits, simultaneous enqueues, definitive rejection, reviewed replacement without cycles, independent older branches and scope isolation. These complement the existing durable delivery and synchronization tests.

## Verification

- Strict root and browser/Node/preload/worker checks, boundary/copy checks and all four production builds passed: `/tmp/gabs-record-build-3.log`.
- Full unit/PostgreSQL regression passed 447 tests across 80 files: `/tmp/gabs-record-full.log`.
- Nine headless browser journeys passed: the new same-record journey (`/tmp/gabs-record-web.log`) and eight affected existing journeys (`/tmp/gabs-record-web-regressions.log`). These cover current/legacy conflicts, independent reviews, nested comparisons, cross-module capture, collisions, dependencies and uncertain delivery.
- Six hidden/minimized, unfocused native journeys passed: the new same-record journey (`/tmp/gabs-record-native.log`) and five affected existing journeys (`/tmp/gabs-record-native-regressions.log`) covering collisions, cross-module capture, uncertain delivery, independent reviews and structured comparisons.

Product source remained frozen during serialized acceptance. The first strict build caught an incorrectly typed action in the new test fixture; it was corrected before the final build and acceptance runs. The saved-value comparison also explicitly checks property presence, so removing an optional null property is distinguishable from retaining it.

## Visual evidence

[Web saved changes](web-saved.png), [web narrow changes](web-narrow.png), [web result](web-recovered.png). [Native saved changes](native-saved.png), [native narrow changes](native-narrow.png), [native result](native-recovered.png). All six captures were inspected. Comparison values stack at narrow widths; the page remains scrollable without horizontal overflow. Scoped Axe and keyboard disclosure checks passed in both clients. This is scoped acceptance, not final UI polish or whole-product accessibility conformance.

## Limits

This verifies newly captured generated resource updates and their explicit conflict recovery. Existing journal calls and dependency sets are not automatically migrated; it cannot retroactively order legacy writes already dispatched. Direct online archive interactions, archived-input recovery, same-record descendants of a colliding create, ambiguous drafts, arbitrary custom commands, permanent revocation and broader sign-out/profile recovery remain separate required work in the [offline workflow map](../../offline-workflows.md). OFF-01 and full parity remain open.

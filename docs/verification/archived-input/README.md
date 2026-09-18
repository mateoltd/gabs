# Archived-input recovery

OFF-01, 18 September 2026. This extends [same-record ordering](../record-order/README.md), [independent reviews](../review-drafts/README.md) and [direct outcome recovery](../direct-recovery/README.md).

## Behavior

When a queued or direct update encounters an archived record, review preserves the original proposed values, original module version and captured base version. It does not merge in the archived server values or present a new write. The read-only recovery dialog exposes an explicit JSON export and no Save action. With offline storage enabled, its independent review slot survives browser reload and native process restart. Without caching, direct input remains in the mounted editor.

The recovery format accepts the original `baseData` snapshot in an uncertain update's pending request. Export retains the exact original request identity and marks its outcome unconfirmed; exporting never marks it accepted or authorizes resubmission with a new identity.

A new direct archive checks the durable journal for known unresolved edits of that record. The table explains why archive is unavailable. This is a local preflight, not a cross-device lock: concurrent remote changes still require authoritative server validation. Archive execution and outcome recovery check the original resource's read/write permissions before and after asynchronous work, even after switching resource tabs.

## Actual journeys

Both headless Chromium and hidden/minimized Electron exercise:

1. Two offline updates, followed by server archive of one target and a conflicting server edit of the other. Both journal entries remain conflicts.
2. Archive remains unavailable for the active record while its edit is unresolved. The archived edit opens a read-only recovery dialog with its original values.
3. Offline browser reload/native process restart preserves the review. Reconnect and reauthentication allow export; the parsed file retains original values and base version. The conflict is not silently accepted or removed.
4. Explicit review of the active record's edit permits subsequent archive. PostgreSQL asserts exact data, archived flags and versions.
5. A direct no-cache edit encounters archive between opening and saving. It exports the original input without updating the archived record.
6. A different direct edit loses its successful response. Export retains its exact pending request and base snapshot. Authoritative settlement recovers the receipt, with exactly one update audit.

The extended existing direct-recovery journey switches to a resource without write permission while the original archive is uncertain. It then revokes/restores the original resource's write permission and verifies exact-key retry and authoritative recovery. The selected tab cannot substitute its permissions for those of the original request.

A focused interrupted-storage check proves that saved archived-review metadata and input commit atomically without altering the rejected request.

## Verification

Final strict checks and all four builds passed: `/tmp/gabs-archived-build-2.log`. Final archived-input and extended direct-recovery journeys passed in both clients: two web tests in `/tmp/gabs-archived-web-final.log` and two native tests in `/tmp/gabs-archived-native-final.log`.

Full unit/PostgreSQL regression passed 448 tests across 80 files: `/tmp/gabs-archived-full.log`. Browser regressions passed eight cases initially; the ninth failed on the old uncertainty wording. The two affected editor assertions and the equivalent platform assertion now match the existing recovery message. The corrected editor case and platform duplicate-safe create case passed in `/tmp/gabs-archived-web-correction.log`. This gives twelve distinct passing browser journeys including the two milestone journeys. Initial regression log: `/tmp/gabs-archived-web-regressions.log`. No runtime behavior was changed to satisfy these stale assertions.

Five affected native regressions passed in `/tmp/gabs-archived-native-regressions.log`: direct collisions, ordinary and uncertain editors across updates, ordered edits, and independent reviews. Together with the two milestone journeys, seven hidden/minimized native journeys pass. Product source remained frozen during serialized acceptance. Formatting and diff checks passed; overwritten historical captures were restored.

An earlier native run failed during reconnect login with an unavailable-API error. Added transport diagnostics did not reproduce the failure; a diagnostic rerun and the final run passed. No product reconnect fix is claimed. Initial visual inspection prompted replacement of disabled editor fields and misleading Save wording with the read-only recovery view; final captures reflect that change.

## Visual evidence

[Web blocked archive](web-blocked.png), [queued recovery](web-queued.png), [narrow recovery](web-narrow.png), [direct recovery](web-direct.png), [uncertain input](web-uncertain.png). [Native blocked archive](native-blocked.png), [queued recovery](native-queued.png), [narrow recovery](native-narrow.png), [direct recovery](native-direct.png), [uncertain input](native-uncertain.png).

All ten captures were inspected. The recovery values stack at narrow width, the dialog has no horizontal overflow and scoped Axe passes in both clients. Existing styles are reused. Native windows stay hidden/minimized and unfocused; the destination dialog is replaced in the acceptance harness, while the real IPC/file write and resulting bytes are verified. This is scoped functional/visual evidence, not final UI polish or whole-product accessibility acceptance.

## Required follow-up

The generic native recovery-file IPC currently validates sender and format, but does not independently recheck current account/workspace/resource authority after the OS save dialog. The new renderer guard does not close this boundary. Add a host-owned recovery authorization path, including revocation, lease expiry, workspace/profile changes and delayed-dialog checks, without borrowing unrelated LAN permissions or silently weakening authorized offline recovery. Browser recovery export also needs equivalent scoped authority acceptance. This remains required OFF-01/OFF-03 engineering.

Legacy unsequenced journals, colliding-create same-record descendants, ambiguous drafts, arbitrary custom commands, permanent revocation, received-relay controls and broader sign-out/profile recovery remain open in the [workflow map](../../offline-workflows.md). OFF-01 and full parity remain open.

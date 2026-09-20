# Imported request targets

Scope: **ID-03-BACKUP-REQUEST-TARGETS**, within ID-03-BACKUP-CORPORATE. Scoped acceptance passed on 20 September 2026.

## Behavior and ownership

Request-only update/archive exports can carry a previously selected record target. Import formerly discarded that metadata, allowing later review to fall back to the original record. Restoration now requires a new original/reassigned choice, settles the exact original request on the authoritative server, reads the selected current record and records only the newly confirmed local destination. The original call, key and dependency/capture lists remain intact. The import itself never submits a replacement update or archive.

A server-accepted request cannot be retargeted. A reassigned selection is refused; choosing the original recovers its actual result without repeating its effect. A stopped request stays held until its prerequisites are independently verified. The existing update comparison or archive confirmation then reads current values and creates a separately identified correction. Retries of the stopped original stay fenced.

Target validation and current-record reads belong to the private client `recovery/import/target.ts` helper, shared with linked drafts. The typed public choice is either `{ draftSource }` or `{ recordTarget }`; the client snapshots it before asynchronous work. Suggestions shown by the host are untrusted file content. Other copied reference remappings remain inert and require their own recovery. Existing local target decisions or saved reviews are preserved; a review appearing during the asynchronous read prevents the import commit.

Missing/wrong targets, revocation, lock and cancellation retain the imported copy. Current policy and session authority guard target reads and the atomic local commit. Archived targets remain available for outcome/input review without automatically archiving again. The exact exported files are preserved.

## Actual product journeys

A signed, independently published test module captures a create collision and dependent update/archive through the public SDK while offline. A compatible module update exposes the host's generated review UI. The source explicitly reassigns the child to a separate record and exports the actual request plus its accepted prerequisite from Settings. The destination has an empty independent store and authenticates afresh; no source storage or keys are copied.

For stopped requests, both record choices are tested. The child imports before the parent and remains held, survives reload and becomes reviewable only after the authoritative parent receipt is restored. A correction changes only the selected record, increments its version once and leaves the other record unchanged. Exact retries recover the same result; late original retries are refused.

For already accepted updates and archives, an actual server call commits the original before import. The UI refuses the reassigned choice, then recovers the accepted original without another effect. Both files remain byte-for-byte unchanged. Native tests use actual main/IPC/utility persistence with controlled OS-protection and development-identity fixtures; they do not establish actual provider, live MFA or signed platform acceptance.

## Verification

- Focused import tests: **66 passed**, `/tmp/gabs-request-target-unit.log`.
- Initial six headless browser request journeys passed, `/tmp/gabs-request-target-web.log`.
- Strict environment type checks, boundary/copy checks and **four fresh builds passed**, `/tmp/gabs-request-target-final-build.log`.
- Isolated full regression: **910 tests across 121 files passed**, `/tmp/gabs-request-target-regression.log`.
- Final headless browser/cross-surface acceptance: **17 journeys passed**, `/tmp/gabs-request-target-final-web.log`.
- Final hidden/minimized native acceptance: **13 journeys passed**, `/tmp/gabs-request-target-final-native.log`.
- All **24 final wide/narrow captures** were inspected. Target selection/reset, keyboard operation, scoped Axe A/AA checks and 390px overflow checks passed, including archive confirmation. This is scoped continuity evidence, not full accessibility conformance or UI-polish approval.
- All disposable databases and temporary device profiles were removed. No CSS changed.

Initial fixture fixes added an explicit string type for arbitrary retry identities, used the actual archive-choice label, gave published fixtures unique names and waited for import refresh to finish before closing its dialog. No behavioral assertion was removed. Archive confirmation passed the additional scoped accessibility and narrow-layout checks in the final runs.

## Captures

| Surface and action | Original target | Reassigned target |
| --- | --- | --- |
| Web update | [Wide](web-update-original.png), [narrow](web-update-original-narrow.png) | [Wide](web-update-reassigned.png), [narrow](web-update-reassigned-narrow.png) |
| Web archive | [Wide](web-archive-original.png), [narrow](web-archive-original-narrow.png) | [Wide](web-archive-reassigned.png), [narrow](web-archive-reassigned-narrow.png) |
| Web archive review | [Wide](web-archive-original-review.png), [narrow](web-archive-original-review-narrow.png) | [Wide](web-archive-reassigned-review.png), [narrow](web-archive-reassigned-review-narrow.png) |
| Native update | [Wide](native-update-original.png), [narrow](native-update-original-narrow.png) | [Wide](native-update-reassigned.png), [narrow](native-update-reassigned-narrow.png) |
| Native archive | [Wide](native-archive-original.png), [narrow](native-archive-original-narrow.png) | [Wide](native-archive-reassigned.png), [narrow](native-archive-reassigned-narrow.png) |
| Native archive review | [Wide](native-archive-original-review.png), [narrow](native-archive-original-review-narrow.png) | [Wide](native-archive-reassigned-review.png), [narrow](native-archive-reassigned-review-narrow.png) |

## Remaining scope

Mixed reference remapping across requests, reconciliation of multiple snapshots, broader module/authority/failure transitions, encrypted corporate archives, corporate key loss and actual provider/platform acceptance remain under ID-03-BACKUP-CORPORATE. Overall parity and later UI refinement remain open.

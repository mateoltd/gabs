# Legacy journal ordering recovery

OFF-01, 18 September 2026. Extends [same-record capture](../record-order/README.md) to retained journals lacking dependency edges. It does not retroactively order business effects that already occurred.

## Behavior

Scoped resource creates, updates and archives are grouped by module, resource and record. Existing explicit dependencies, including paths through other records and newer reviewed replacements, take precedence over timestamps. Missing same-record edges use stable capture order within that dependency graph. Cycles are retained rather than rewritten by guesswork. Custom commands are outside this repair.

Request identifiers, input, module versions and base snapshots remain unchanged. Repairs and local recovery gates are saved under the module storage lock before dispatch. A failed repair write sends nothing. The scheduling metadata never becomes part of the server request.

If an unordered group contains a request with unknown delivery history, that request requires the existing **Resolve outcome** flow. Known unsent work on the same record waits until those outcomes are established. Unrelated records continue synchronizing. A later already-accepted unordered effect also prevents automatic execution of an older uncertain request. A verified accepted receipt releases subsequent work; a verified cancellation retains rejected input for explicit review and does not count as an accepted prerequisite. Reviewed corrections use the existing new-key and dependency-replacement rules.

## Observable acceptance

The browser and hidden native journeys capture three edits to one Contact and an unrelated edit, then deliberately remove the saved ordering and the first edit's delivery evidence to represent an older journal. Browser reload and native offline process restart retain the original input and show the recovery explanation. A real API request commits the first original key without updating the client journal. Reconnection dispatches only the unrelated edit. Resolving the original outcome recovers its receipt without another execution request; the second edit then conflicts, explicit review preserves a disjoint server change, and the third edit continues after the reviewed replacement.

Actual PostgreSQL data ends at the expected version and values with exactly five update audit entries, including the separate server edit and unrelated record. Original calls and later retry identities remain intact. Both the new-capture variant and legacy variant run through the same shared journey. Keyboard disclosure, scoped Axe checks and narrow overflow checks pass. Six new web/native captures were inspected; no stylesheet or layout changed. Historical regression captures are restored rather than replaced.

Focused checks additionally cover missing delivery with zero attempts, already-accepted later effects, reverse/transitive dependencies, equal-time stable ordering, scope isolation, custom-operation exclusion, cycle preservation, cancellation, and a failed durable repair before dispatch.

## Verification

- Strict root/browser/Node/preload/worker TypeScript, boundary/copy checks and all four builds passed: `/tmp/gabs-legacy-build-final.log`.
- Full unit/PostgreSQL regression: **463 passed across 81 files**, including six new ordering/storage cases: `/tmp/gabs-legacy-full.log`.
- **Seven headless browser journeys** passed: new/legacy ordering, settlement, create collision, cross-module capture, journal delivery and archived input. Logs: `/tmp/gabs-legacy-web.log` and `/tmp/gabs-legacy-web-regression.log`.
- **Five hidden/minimized native journeys** passed: new/legacy ordering, settlement, create collision and archived input: `/tmp/gabs-legacy-native.log`.
- Changed-file formatting, diff and local documentation-link checks passed. Builds and acceptance runners were serialized with product source frozen.

The initial new unit fixture returned an invalid settlement response and then used a retry key shorter than the actual protocol minimum. The fixture now uses the real response shape and valid key; the final full regression passed. No validation or timeout was weakened.

## Visual evidence

[Web saved changes](web-saved.png), [web narrow](web-narrow.png), [web result](web-recovered.png), [native saved changes](native-saved.png), [native narrow](native-narrow.png), [native result](native-recovered.png). All six were inspected.

## Limits

This verifies the legacy same-record resource path on local development services and hidden Electron. It does not establish arbitrary custom-operation recovery, correction of already-committed effects, destructive repair of corrupt cycles, permanent-revocation recovery, hosted release acceptance or whole-product accessibility. Colliding-create same-record descendants, ambiguous drafts and broader profile recovery remain required. The UI remains the existing engineering baseline; these captures are not approval of final polish.

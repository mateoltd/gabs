# Direct online create collision recovery

OFF-01, 18 September 2026. This extends [journaled collision recovery](../create-collisions/README.md) to generated direct resource editors, including use with offline storage disabled.

## Behavior and boundaries

A definitive first-attempt `RECORD_EXISTS` response retains its exact call in a failed-create review. Ordinary Save cannot silently change that colliding identity. The user can edit or export the input, then explicitly choose a separate record. The host checks the original outcome through the same server settlement protocol, validates an accepted receipt against the original module contract, and rechecks current resource permissions and workspace context. Only a confirmed cancellation permits a new record ID and retry key.

A direct create cancelled after uncertain delivery also exposes the separate-record action. Every replacement has its own delivery state: a lost replacement reply retains that replacement key as uncertain, whereas a definitive first collision on the replacement permits a new reviewed recovery. Recovery remains direct and requires authoritative acceptance even if the resource's usual policy is queued. The confirmation describes this distinction without changing shared UI styling.

No-cache direct state remains in the mounted editor. When the connection drops, the existing workspace privacy surface hides the editor and requires online reauthorization; in-memory input returns after reconnection. The journey verifies that no drafts or journal entries were written. This does not establish durability after process exit, navigation that destroys the editor, sign-out, or profile removal. Those requirements remain under OFF-03. The input-export control uses the existing recovery export; it is not a new accepted process-recovery protocol.

## Observable acceptance

`tests/support/direct-create-collision-journey.ts` runs through headless web and hidden/minimized Electron wrappers against a fresh PostgreSQL database:

1. Another authenticated session occupies the first generated record ID. The editor retains the failed original, blocks ordinary Save, preserves corrected input behind the offline privacy lock, and restores it after reauthorization.
2. The cancellation reply is lost. No replacement request is sent until the user retries the outcome check. The same original key is cancelled once.
3. The replacement commits but loses its receipt. Its input becomes read-only and the separate-record action is unavailable until the original replacement key recovers its receipt. No duplicate create or audit entry appears.
4. An uncertain uncommitted create is cancelled while its record ID is occupied by another session. Explicit separate-record recovery creates the intended new record without modifying the occupied record.
5. The first proposed replacement itself collides. This definitive first rejection remains editable, the second failed key is fenced, and another explicit recovery succeeds.
6. PostgreSQL contains exactly seven records: four unchanged version-1 corporate records and three intended recovered records. Audit counts are exactly seven creates and four cancellations. Every old fenced request rejects a late retry with `ATTEMPT_CANCELLED`; offline drafts and journals remain empty.

The confirmation has one active dialog, Escape returns to the preserved input, Enter activates recovery, scoped Axe passes and narrow layout stays within the viewport. Existing direct-update/archive, journaled collision, conflict comparison, saved-review and settlement journeys remain regression gates.

## Verification

- Strict root and browser/Node/preload/worker checks, dependency/copy checks and four production builds passed: `/tmp/gabs-direct-collisions-build-final.log`.
- The dedicated headless journey passed after correcting its initial offline expectation: `/tmp/gabs-direct-collisions-browser-2.log`.
- Six hidden/minimized native journeys passed on final source: `/tmp/gabs-direct-collisions-native-accepted.log`.
- Nine headless browser journeys passed on final source: `/tmp/gabs-direct-collisions-browser-accepted.log`.
- The full unit/PostgreSQL suite passed 442 tests across 79 files: `/tmp/gabs-direct-collisions-full.log`. This ran before the final presentation-only removal of duplicate collision errors; client/server/SDK runtime files did not change in that cleanup.

The initial browser test expected a disabled recovery control during disconnection. The established no-cache policy instead hides the entire corporate surface. The test now verifies the privacy lock, absence of additional writes and restoration of the original edited input. No workspace privacy behavior was changed to satisfy the test.

The failed-editor visual pass found the handled collision repeated in its recovery explanation, the generic form error and a background banner. The final UI keeps the actionable recovery explanation and omits those redundant errors. Its copy describes retained input without implying that no-cache state was durably saved. The new journey asserts the duplicate generic message is absent.

## Visual evidence

[Web failed editor](web-failed-editor.png), [narrow web failed editor](web-failed-editor-narrow.png), [native failed editor](native-failed-editor.png), [narrow native failed editor](native-failed-editor-narrow.png), [web confirmation](web-confirmation.png), [narrow web confirmation](web-confirmation-narrow.png), [web recovery](web-recovered.png), [narrow web recovery](web-recovered-narrow.png), [native confirmation](native-confirmation.png), [narrow native confirmation](native-confirmation-narrow.png), [native recovery](native-recovered.png), [narrow native recovery](native-recovered-narrow.png).

All twelve captures were inspected for dialog containment, controls, typography and responsive continuity. The final web/native failed-editor captures confirm the duplicate errors are gone; the narrow editor scrolls within its dialog. Native captures use physical device pixels; recovered narrow tables scroll within the existing surface. No stylesheet declarations changed. This remains engineering acceptance, not approval of final UI polish.

Nested/reference conflict decisions, cross-module offline capture under grants and revocation, ambiguous ordinary drafts, same-record ordering, arbitrary queued commands, archived-input recovery, archive permission changes, permanent revocation and the remaining [offline workflow gates](../../offline-workflows.md) are still required. Full parity and the separately authorized later UI-refinement goal remain open.

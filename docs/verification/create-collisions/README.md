# Failed-create collision recovery

OFF-01, 18 September 2026. Scoped acceptance for generated resource journals; the complete offline workflow and parity goals remain open.

## Behavior

A definitive `RECORD_EXISTS` response remains a conflict with its original input and retry identity. Review explains that the existing record was not replaced and requires an explicit separate-record action instead of resubmitting the same colliding identity. The confirmation checks the exact original request with the authoritative server. An accepted outcome recovers its validated receipt. Otherwise, the server permanently fences that original key before the client prepares a replacement.

The verified cancellation is retained independently of the subsequent graph replacement, so permission/schema/storage failure does not hide the server's answer. The new parent and all eligible descendants are committed together in one local module-state write under the scope's synchronization and storage locks. Every replacement receives a fresh request key; only the parent receives a new record identity. Superseded requests retain their original bodies for history. Schema-declared references follow the new parent, including nested arrays, tuples, maps and discriminated unions. Plain text, other reference targets, existing server base snapshots, unrelated work and foreign scopes stay unchanged. Each request retains its signed response contract.

Only provably unsubmitted resource descendants can be rewritten. Unknown delivery, previous attempts, already accepted children, custom commands, same-record edits, ambiguous reference declarations, identity reuse, cycles and ambiguous ordinary drafts prevent replacement without deleting input. Current permissions for every affected resource are rechecked after asynchronous contract verification; the host uses current props and rejects a departed workspace/view. Server execution still performs authoritative business validation.

## Evidence

- `tests/unit/reference-remapping.test.ts`: nested arrays/tuples/maps, escaped and `__proto__` keys, matching union branches, unrelated text/member/other-module links, ambiguous target rejection, immutable input and final-schema validation.
- `tests/unit/journal-delivery.test.ts`: structured definitive collision reasons; later collision responses never turn an earlier uncertain attempt into rejection.
- `tests/unit/module-response-storage.test.ts`: original accepted receipt, exact settlement envelope, fresh parent/child keys, transitive dependencies, preserved update base snapshots/ordinary drafts/foreign scope, interrupted cancellation and replacement writes, repeat recovery, malformed receipts, revocation before and after asynchronous checks, invalid identities, unknown delivery, cycles and blocked custom/same-record work.
- `tests/support/create-collision-journey.ts`, exercised by headless browser and hidden Electron wrappers: create a contact and linked note offline plus an independent project; cause a real collision through a second authenticated session; allow the project to complete; retain edited review input after a lost settlement reply and browser reload/native process restart; resume offline and reconnect; create a separate contact and remap the note. PostgreSQL confirms the original record/version unchanged, exactly four records, one cancellation audit and no duplicated effects after explicit retries. A late original request receives `ATTEMPT_CANCELLED`.
- Keyboard Escape/Enter, one active dialog, scoped Axe and narrow overflow checks cover the confirmation. Wide/narrow browser/native screenshots cover confirmation and recovered records. No style declarations changed.

## Final verification

| Check | Result |
| --- | --- |
| Strict root and browser/Node/preload/worker checks, boundaries, copy rules, four builds | Passed on final source. |
| Full unit/PostgreSQL suite in a fresh migrated/seeded database | 442/442 passed across 79 files. |
| Headless browser collision and recovery regressions | 8/8 passed: collision, settlement, direct recovery, current/legacy conflict review, generated response recovery and independent saved reviews. |
| Hidden/minimized Electron collision and recovery regressions | 5/5 passed: collision, settlement, direct recovery, conflict review and independent saved reviews. |

Logs: `/tmp/gabs-collisions-build-final.log`, `/tmp/gabs-collisions-full-final.log`, `/tmp/gabs-collisions-browser-final.log`, `/tmp/gabs-collisions-native-final.log`. The earlier 440-test run and browser/native journeys passed before final permission rechecks; the final full suite includes the two added regression cases. Existing bundle-size warnings remain. No external release or provider acceptance is inferred.

## Visual evidence

[Web confirmation](web-confirmation.png), [narrow web confirmation](web-confirmation-narrow.png), [web recovery](web-recovered.png), [narrow web recovery](web-recovered-narrow.png), [native confirmation](native-confirmation.png), [narrow native confirmation](native-confirmation-narrow.png), [native recovery](native-recovered.png), [narrow native recovery](native-recovered-narrow.png).

Review found no clipped recovery controls, stacked editors or new page overflow. Native captures use the device's physical pixel density. Existing table scrolling and shell geometry remain unchanged. This establishes continuity for this feature, not final UI design approval.

## Remaining boundaries

This milestone covers journaled generated resource creates and eligible resource dependents. Direct online/no-cache cancelled-create collisions still need their own explicit recovery path and acceptance; direct process-exit/sign-out recovery remains OFF-03. Ordinary drafts have no dependency provenance and are not silently remapped. Same-record pending edits and custom-operation descendants require their respective ordering/recovery implementations. Nested and cross-module capture with real grant changes, richer conflict decisions, permanent revocation and relay recovery remain in the [workflow map](../../offline-workflows.md). Nothing here accepts production/provider signing, hosted deployment, full OFF-01 or whole-product parity.

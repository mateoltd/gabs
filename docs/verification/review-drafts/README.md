# Independent saved reviews

18 September 2026. Scoped OFF-01 progress; the full parity goal remains active.

## Implemented behavior

Saved review input, field choices and the compared server record now have a slot per reviewed request. Journal reviews and direct online comparisons use distinct identities. Opening a second review or an ordinary draft no longer replaces the first review. A successful replacement consumes only its own saved review atomically with the journal change; unrelated reviews and the ordinary draft remain available.

Pending rows identify the attempted action and record, and expose **Resume review** when a saved comparison exists. Direct comparisons appear under **Saved reviews**. Resumption loads fresh scoped storage and checks that a journal review still belongs to an unresolved, unreplaced request. Stale writers cannot restore an already-replaced review. Existing reviews can resume offline within authorized cached access; saving still follows the declared execution policy and current server validation.

Legacy shared review slots are promoted when read and during the next atomic storage change. Promotion checks the associated journal scope/resource and preserves an independently saved destination instead of overwriting it. Legacy direct comparisons gain a stable identity from their retained record/version. Failed persistence leaves the previous durable data intact. An ordinary draft remains in its separate per-resource slot.

The online-only acceptance fixture exposed a pre-existing UX mismatch: offline submission was rejected by execution, but its enabled button offered to save a pending change. The generated form now disables submission and explains the connection requirement for online-only operations and direct uncertain attempts. Retained draft input can still be edited where appropriate. The first correction changed the label without wiring the disabled state; the failing browser gate caught that, and the final source below includes both.

## Verification

| Check                             | Result                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict checks/builds              | Root and four environment TypeScript, dependency/copy checks and all four bundles passed. `/tmp/gabs-reviews-build-final.log`. Existing bundle-size warnings remain.                                                        |
| Full unit/PostgreSQL regression   | 422/422 tests passed across 78 files. `/tmp/gabs-reviews-full.log`.                                                                                                                                                         |
| Final headless browser regression | 8/8 passed: independent queued/direct reviews, current/legacy comparison, authoritative settlement, direct-attempt recovery, two malformed-response journeys and journal delivery. `/tmp/gabs-reviews-browser-final-2.log`. |
| Hidden native regression          | 5/5 passed: independent queued/direct reviews with process restarts, conflict review, settlement, direct recovery and uncertain journal delivery. `/tmp/gabs-reviews-native.log`.                                           |
| Accessibility and visual checks   | Scoped Axe A/AA checks on queued and direct review screens, keyboard resumption, 390-CSS-pixel viewport checks, and inspected wide/narrow web/native captures.                                                              |

The shared real-interface journey creates two Contacts conflicts, saves different field choices and extra edits, and opens an unrelated ordinary draft between them. Browser reload or a full Electron process restart retains all three. Both reviews resume offline. Submitting the first preserves the second and the ordinary draft; reconnecting accepts both corrections with the intended names, addresses and unrelated server emails. PostgreSQL records four update audits: two concurrent remote edits and two accepted corrections.

The same journey installs a locally signed, reviewed schema-only fixture with explicitly online resource writes, using existing registry and generic host contracts. Test setup grants its local organization entitlement/activation/assignment and permissions. Two direct conflicts retain independent comparisons and an ordinary draft across another reload/native restart. Offline input edits are retained, while submission remains disabled. Reconnection accepts each reviewed correction once and preserves the ordinary draft. These direct writes create no journal entries; their four update audits are checked against real PostgreSQL. This fixture is local policy/host acceptance, not proof of the full external publishing or commerce lifecycle.

Storage tests cover legacy promotion, distinct journal/direct identities, independent review/ordinary preservation, interrupted writes, atomic replacement, stale writers, cross-workspace rejection and preservation of a pre-existing destination during legacy promotion. Existing current and missing-base comparison journeys now resume their own review rows and retain the original second-conflict behavior.

## Captures and limits

- Queued: [web wide](web-reviews.png), [web narrow](web-reviews-narrow.png), [native wide](native-reviews.png), [native narrow](native-reviews-narrow.png).
- Direct: [web wide](web-direct.png), [web narrow](web-direct-narrow.png), [native wide](native-direct.png), [native narrow](native-direct-narrow.png).

The host's existing panels and controls remain in use. Review labels and actions remain readable and contained at narrow widths. Existing tables retain their horizontal scrolling behavior. This is scoped functional/visual continuity evidence, not final UI approval or whole-product accessibility conformance. Historical regression screenshots were restored to their committed bytes. Browser tests were headless; native windows remained hidden/minimized and unfocused. Builds/runners were serialized against frozen product source, with isolated migrated/seeded databases removed after each run.

Only saved comparisons with offline storage enabled gain this restart behavior. An unresolved direct request without a durable journal is still a separate recovery gap; process restart, explicit sign-out/profile removal and permanent revocation must not be inferred from saved-review acceptance. Same-record pending ordering, failed-create collisions, nested/reference conflict choices, cross-module dependent capture, custom-operation/archive policy coverage and the remaining OFF-01/OFF-03 gates remain required. The later UI-refinement goal has not started.

# Authoritative settlement of uncertain attempts

18 September 2026. Scoped OFF-01 progress; the overall parity goal remains active.

## Behavior and boundaries

**Resolve outcome** is an explicit recovery action for an uncertain generated resource request. The confirmation explains that the server will return its committed result or stop further retries while keeping the saved input. It does not silently replace an uncertain key.

Recovery accepts the same bounded retry-key strings as normal execution, including legacy punctuation-bearing keys. The server uses the same account/workspace/key lock and exact versioned request fingerprint as normal execution. It rechecks current identity, membership, module and operation/resource authority after waiting for the lock. An accepted receipt returns its original result. Otherwise the transaction records a permanent cancellation and one audit entry. Late original requests receive `ATTEMPT_CANCELLED`; changed input under an existing key remains an idempotency conflict. Cancelled keys never appear in the accepted-receipt lookup used for remote prerequisites.

The client serializes settlement with journal synchronization, checks response identity/schema, validates accepted results against the retained original signed contract, and commits local state durably. Missing, malformed or lost replies do not unlock replacement. A confirmed cancellation leaves the saved input reviewable as rejected work. Its corrected request uses a new key, preserves the record target and reconnects dependent journal entries atomically. Resolution immediately resumes synchronization. A committed result is recovered without another business effect.

### Migration and release implications

Migration 029 adds an explicit `accepted`/`cancelled` outcome to existing idempotency records, defaulting historical rows to accepted. No accepted receipt or business data is deleted. The cancelled record, audit and execution fence share the transaction. Generated OpenAPI and client declarations include the new typed settlement route; desktop IPC permits its bounded module-version metadata.

A server predating cancellation-aware receipt handling is **not an accepted executable rollback target after cancellations exist**. Hosted deployment/rollback and supported-version fleet acceptance remain release gates. This local migration and unsigned desktop run do not establish those gates or authorize publication.

## Executed verification

| Check | Evidence |
| --- | --- |
| Focused server/storage suite | 20/20 passed after correcting the fixture's nonexistent Inventory 1.0.0 to its actual retained 1.2.0 release. `/tmp/gabs-attempt-settlement-focused-final.log`. |
| Final product-source full suite | 418/418 passed across 77 files, including current-authority rechecking, scoped receipts and original contract validation. `/tmp/gabs-attempt-settlement-full-final.log`. Final coverage includes observed lock races, transaction rollback and valid punctuation-bearing retry keys. |
| Strengthened race/rollback acceptance | 3/3 passed after adding direct observation of the exact blocked PostgreSQL advisory lock in both race orders and an interrupted-transaction rollback assertion. `/tmp/gabs-attempt-settlement-races.log`. |
| Strict checks/builds | Root/four environment TypeScript, dependency/copy checks and all four production bundles passed on final product source. Existing chunk-size warnings remain. `/tmp/gabs-attempt-settlement-build-reviewed.log`. Final root/environment type checks also pass after test refinements: `/tmp/gabs-attempt-settlement-types-final.log`. |
| Browser regression acceptance | 6/6 passed: settlement, current/legacy conflict review, two malformed-response journeys and lost-reply/later-denial recovery. `/tmp/gabs-attempt-settlement-browser-final.log`. |
| Hidden native regression acceptance | 3/3 passed: settlement/restart, conflict review/restart and lost-reply/later-denial recovery. `/tmp/gabs-attempt-settlement-native.log`. |
| Final visual timing check | Both affected journeys passed after waiting for the confirmation to finish opening before capture. `/tmp/gabs-attempt-settlement-browser-visual.log`, `/tmp/gabs-attempt-settlement-native-visual.log`. |
| Extended hidden native acceptance | The affected journey passed again with both settlement outcomes, protected process restart and wide/narrow confirmation checks. `/tmp/gabs-attempt-settlement-native-complete.log`. |
| Extended browser acceptance | The affected journey passed again with both cancelled and already-accepted settlement outcomes, plus wide/narrow confirmation checks. `/tmp/gabs-attempt-settlement-browser-complete.log`. |

The database race tests hold the original key lock and observe a competing request waiting on that exact lock before releasing it. Execution-first returns the accepted resource; cancellation-first blocks the real resource handler. Concurrent duplicate settlements produce one cancellation audit. An interrupted settlement transaction leaves neither a fence nor an audit, and normal execution can proceed. Changed fingerprints, cross-workspace keys, current read denial, stale authorization context and versioned corporate commands are exercised. No mocked receipt establishes these server outcomes.

The shared web/native journey captures a contact, dependent note and independent project offline. A controlled transport interruption prevents the original contact request from reaching the server. Settlement commits, but its reply is dropped. Browser reload or full Electron restart preserves uncertainty; retrying settlement recovers the cancellation. A delayed original request is then rejected by the real API. Reviewing and correcting the saved contact creates one accepted replacement, reconnects the note and preserves unrelated project progress. PostgreSQL has exactly one cancellation audit and one create audit per accepted business record. The extended journey also creates a real accepted receipt through another same-account authenticated session, then recovers that exact result through **Resolve outcome**, without duplicate creation.

Client storage tests reject wrong-key and malformed accepted replies, retain original contracts across updates, prevent settlement of unsubmitted work, reject unauthorized local access, and retain uncertainty after interrupted persistence. The existing journal-delivery journey now distinguishes outcome resolution from permission to edit; later denial still cannot authorize replacement.

The first browser run exposed that independent progress waited for the regular 15-second synchronization timer after settlement. The implementation now resumes synchronization immediately; the full affected browser/native regression runs above passed afterward.

## Visual and operational scope

The existing host modal, buttons and pending panel remain in use. Transport failures retain the useful uncertainty explanation without appending raw Electron IPC or network implementation errors; structured server denials retain their actionable message. Scoped Axe checks cover the confirmation and resolved panel; 390-pixel overflow checks pass. Inspected captures: [web confirmation](web-confirmation.png), [web narrow confirmation](web-confirmation-narrow.png), [web resolved](web-resolved.png), [native confirmation](native-confirmation.png), [native narrow confirmation](native-confirmation-narrow.png) and [native resolved](native-resolved.png). The decision text and action remain readable and contained at narrow widths. This is functional recovery and UI continuity evidence, not final UI approval or whole-product accessibility conformance.

Browser runs were headless. Native windows stayed hidden/minimized and unfocused, with no OS dialog or notification. Each integration runner created and removed only its own migrated/seeded database. Historical regression screenshots were restored to their committed bytes.

## Remaining required work

OFF-01 remains active for direct online editor/archive attempts, independent simultaneous review drafts, failed-create collisions, same-record ordering, nested/cross-module choices and durable arbitrary custom-operation journals. The server's declared-command settlement contract does not establish end-to-end custom-operation journaling. Permanent revocation, profile/sign-out recovery, received-relay controls and hosted release compatibility keep their separate gates in the [workflow map](../../offline-workflows.md). Full parity and the later UI-refinement goal are unchanged.

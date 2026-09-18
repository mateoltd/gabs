# Corporate offline workflow acceptance

OFF-01 is active. Durable capture, dependency sequencing and conflict review must work together; this document keeps their acceptance boundaries explicit.

## Dependent creates

Generated queued resource forms keep client-generated record identifiers stable. The resource's exact verified schema determines references, including nested structures. Enqueueing records their prerequisite journal identifiers atomically with the request and retained response contract. Related work waits for accepted prerequisites; unrelated work continues after a definitive rejection. An uncertain reply retains the original retry identity.

Offline reference pickers include same-account/workspace pending creates and mark them **pending** or **needs review**. They remain separate from accepted server pages. Resource permission and the corporate lease are required. Cross-module pending choices also require a previously successful online lookup for that target; an undeclared or never-authorized target gains no offline choices. The authoritative server rechecks grants, record existence and business rules on submission.

Reviewed replacement of a rejected/conflicting request preserves its record target and existing prerequisites. The journal reconnects dependents atomically. Replacing uncertain work, reusing a retry identifier for different content, or introducing circular prerequisites fails without deleting the draft.

## Conflict comparison

Generated updates retain the original values with the queued request. Review compares them with the attempted edit and a freshly fetched server record. Disjoint server changes remain in the proposed result; each overlapping top-level field needs an explicit local/server choice before the form or save action is enabled. Objects and arrays are reviewed as complete fields, matching the server's merge granularity. Older queued updates without original values require explicit choices for all differing fields.

Review choices, the compared server version and subsequent form edits are saved with the draft. Resume uses that labeled server snapshot; saving always revalidates against current server state. A later overlapping server edit creates another visible conflict. The editor permits a new reviewed request for journal entries marked rejected/conflicting, preserves the record target and atomically replaces the prior entry. Denial after earlier uncertainty keeps the original entry pending, as described below.

## Uncertain delivery

The journal durably records dispatch before invoking transport. Failure to persist dispatch prevents submission; a crash after submission leaves the original identity marked uncertain. Transport errors, timeouts, malformed acknowledgements and later denials cannot turn that uncertainty into a confirmed rejection. Legacy pending entries without delivery metadata also remain conservative: the old attempt counter did not record lost replies, so even zero attempts cannot establish non-delivery.

New, provably unsubmitted requests can still receive ordinary first-attempt rejection/conflict outcomes. An uncertain request and its dependents stay pending while unrelated authorized work proceeds after a permission denial. Current permissions remain mandatory. Once restored, retry uses the same key and original response contract to recover the committed receipt, without creating another record or audit event. Browser reload and protected desktop process restart have [scoped acceptance](verification/journal-delivery/README.md).

### Authoritative settlement

Generated resource journals expose an explicit **Resolve outcome** action. The server locks the original account/workspace/retry key, rechecks current authority after waiting, and compares the exact operation and original versioned input fingerprint. An existing accepted receipt is returned; otherwise the same transaction writes a permanent cancellation and its audit. Every later execution using that key is blocked. A missing receipt alone never authorizes a correction.

The client verifies the returned identity and, for acceptance, the original signed response contract before changing local state. Lost or malformed settlement replies leave the request uncertain and can be retried after restart. Confirmed cancellations retain their input as rejected work; ordinary review creates a fresh, validated request and atomically reconnects its dependents. Resolving also resumes unrelated synchronization immediately. See [settlement evidence](verification/attempt-settlement/README.md).

Migration 029 preserves historical accepted receipts and adds explicit outcome metadata. Executable server rollback must retain cancellation-aware receipt handling; a server predating this protocol is not an accepted rollback target once cancellation rows exist. Hosted rollout/rollback acceptance remains part of release readiness.

### Direct online attempts

Generated direct editors and archive controls now use the same verified settlement contract. They retain the original key and execution mode through later denial or conflict, recover accepted receipts, and allow correction only after confirmed cancellation. Cancelled updates and definitive first-attempt conflicts show explicit comparison with the current server record. The [direct acceptance journey](verification/direct-recovery/README.md) verifies duplicate-safe creates, update correction and both archive outcomes in headless web and hidden Electron.

With offline storage disabled, direct pending input remains in the mounted editor's memory. This milestone does not silently persist corporate data or establish direct process-exit/sign-out/profile recovery. Permanent revocation, received relay recovery controls and durable arbitrary custom-operation journals retain their separate gates. The server supports settlement of declared corporate commands, but these generated client journeys establish resource recovery only.

## Remaining OFF-01 work

- Extend direct-attempt acceptance to cancelled-create collisions, archived-input recovery and original-resource permission changes during archive recovery. Preserve direct restart/sign-out/profile work under OFF-03. Permanently revoked access and received relay recovery controls require their own acceptance.
- Preserve multiple simultaneous review drafts independently. The current editor has one saved draft slot per resource; starting another editor can replace that slot even though each original pending request remains in the journal.
- Extend conflict acceptance to nested/reference-field decisions and failed-create collisions; current browser/native journeys cover ordinary resource updates and legacy requests without original values.
- Verify rejected-parent correction and dependent continuation through the real editor, including restart and reauthentication. Storage-level coverage alone does not accept this interface.
- Verify nested and cross-module dependent capture under explicit grants and revocation in the real interface.
- Complete same-record pending-edit ordering and clear identification/recovery of individual pending changes.
- Align retry-key validation across desktop submissions and relay receipt lookups with server-accepted formats; those older paths still use narrower character rules than execution and the new settlement endpoint.
- Re-audit durable queued custom operations, archive behavior and recovery controls against operation policies; retain missing implementation in the tracker rather than treating generated CRUD coverage as full SDK coverage.

Broader working-set management is OFF-02. Explicit sign-out/profile-removal recovery is OFF-03. Personal-to-company import is OFF-04. These required gates are not completed by a browser reload or a desktop process restart.

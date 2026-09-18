# Corporate offline workflow acceptance

OFF-01 is active. Durable capture, dependency sequencing and conflict review must work together; this document keeps their acceptance boundaries explicit.

## Dependent creates

Generated queued resource forms keep client-generated record identifiers stable. The resource's exact verified schema determines references, including nested structures. Enqueueing records their prerequisite journal identifiers atomically with the request and retained response contract. Related work waits for accepted prerequisites; unrelated work continues after a definitive rejection. An uncertain reply retains the original retry identity.

Offline reference pickers include same-account/workspace pending creates and mark them **pending** or **needs review**. They remain separate from accepted server pages. Resource permission and the corporate lease are required. Cross-module pending choices also require a previously successful online lookup for that target; an undeclared or never-authorized target gains no offline choices. The authoritative server rechecks grants, record existence and business rules on submission.

Reviewed replacement of a rejected/conflicting request preserves its record target and existing prerequisites. The journal reconnects dependents atomically. Replacing uncertain work, reusing a retry identifier for different content, or introducing circular prerequisites fails without deleting the draft.

## Conflict comparison

Generated updates retain the original values with the queued request. Review compares them with the attempted edit and a freshly fetched server record. Disjoint server changes remain in the proposed result; each overlapping top-level field needs an explicit local/server choice before the form or save action is enabled. Objects and arrays are reviewed as complete fields, matching the server's merge granularity. Older queued updates without original values require explicit choices for all differing fields.

Review choices, the compared server version and subsequent form edits are saved with the draft. Resume uses that labeled server snapshot; saving always revalidates against current server state. A later overlapping server edit creates another visible conflict. The editor permits a new reviewed request for journal entries marked rejected/conflicting, preserves the record target and atomically replaces the prior entry. Denial after earlier uncertainty still needs the separate audit below. Existing uncertain requests keep their identity.

## Remaining OFF-01 work

- Audit denial after a previously uncertain request: a later permission failure does not by itself prove that the original attempt never committed. Keep original retry identity until authoritative reconciliation establishes the prior outcome.
- Preserve multiple simultaneous review drafts independently. The current editor has one saved draft slot per resource; starting another editor can replace that slot even though each original pending request remains in the journal.
- Extend conflict acceptance to nested/reference-field decisions and failed-create collisions; current browser/native journeys cover ordinary resource updates and legacy requests without original values.
- Verify rejected-parent correction and dependent continuation through the real editor, including restart and reauthentication. Storage-level coverage alone does not accept this interface.
- Verify nested and cross-module dependent capture under explicit grants and revocation in the real interface.
- Complete same-record pending-edit ordering and clear identification/recovery of individual pending changes.
- Re-audit durable queued custom operations, archive behavior and recovery controls against operation policies; retain missing implementation in the tracker rather than treating generated CRUD coverage as full SDK coverage.

Broader working-set management is OFF-02. Explicit sign-out/profile-removal recovery is OFF-03. Personal-to-company import is OFF-04. These required gates are not completed by a browser reload or a desktop process restart.

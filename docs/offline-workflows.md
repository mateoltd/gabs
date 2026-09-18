# Corporate offline workflow acceptance

OFF-01 is active. Durable capture, dependency sequencing and conflict review must work together; this document keeps their acceptance boundaries explicit.

## Dependent creates

Generated queued resource forms keep client-generated record identifiers stable. The resource's exact verified schema determines references, including nested structures. Enqueueing records their prerequisite journal identifiers atomically with the request and retained response contract. Related work waits for accepted prerequisites; unrelated work continues after a definitive rejection. An uncertain reply retains the original retry identity.

Offline reference pickers include same-account/workspace pending creates and mark them **pending** or **needs review**. They remain separate from accepted server pages. Resource permission and the corporate lease are required. Cross-module pending choices also require a previously successful online lookup for that target; an undeclared or never-authorized target gains no offline choices. The authoritative server rechecks grants, record existence and business rules on submission.

Reviewed replacement of a rejected/conflicting request preserves its record target and existing prerequisites. The journal reconnects dependents atomically. Replacing uncertain work, reusing a retry identifier for different content, or introducing circular prerequisites fails without deleting the draft.

## Remaining OFF-01 work

- Finish explicit conflict comparison between original input, the attempted edit and current server data. Preserve disjoint server changes and require deliberate choices for overlapping fields; never silently overwrite them.
- Verify rejected-parent correction and dependent continuation through the real editor, including restart and reauthentication. Storage-level coverage alone does not accept this interface.
- Verify nested and cross-module dependent capture under explicit grants and revocation in the real interface.
- Complete same-record pending-edit ordering and clear identification/recovery of individual pending changes.
- Re-audit durable queued custom operations, archive behavior and recovery controls against operation policies; retain missing implementation in the tracker rather than treating generated CRUD coverage as full SDK coverage.

Broader working-set management is OFF-02. Explicit sign-out/profile-removal recovery is OFF-03. Personal-to-company import is OFF-04. These required gates are not completed by a browser reload or a desktop process restart.

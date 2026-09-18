# Received draft recovery

Company members with an explicit module relay grant and permission to read the draft's resource or queued operation can manage same-account receipts in **Settings → Local network → Received drafts**. Reading, exporting, importing or moving a receipt does not submit it. The server accepts business changes only after an explicit submission with current module access and a valid queued-operation contract.

## Inbox and archive

The inbox holds ten transport envelopes. At capacity, new deliveries are refused without removing existing work. The sender must retry after space is available. Employees see only authorized receipt counts; the ten-slot capacity is shared by all envelopes in this account/workspace inbox. Inaccessible and foreign-account contents do not appear in their rows, counts or archive byte usage. Connected administrators retain workspace quarantine inspection.

**Archive draft** stores the complete original envelope in the account/workspace's encrypted archive before removing its inbox copy. The archive holds up to 100 copies and 16 MiB of serialized contents; encryption/database overhead is additional. It does not evict pending work. A full archive refuses the move and keeps the inbox draft intact. Capacity and retention are shown in the archive view.

**Restore to inbox** writes the original envelope back before removing its archived copy. If either move is interrupted, two copies may remain temporarily; retrying the exact move reconciles them safely. A full inbox leaves the archived copy intact. Repeated network deliveries of an already archived exact receipt are acknowledged without reopening it in the inbox. Changed content under that archived retry identifier is rejected.

Copies remain until explicitly restored or deleted. There is no automatic age-based deletion. Small protected server-outcome records remain after copy deletion so dependency acknowledgements and uncertain retry identities are not silently erased. An archive is still device-local storage, not a backup.

## Recovery files

**Export recovery file** uses a native save picker and writes a versioned JSON file containing the original account/workspace-bound envelope. Connected administrators can export invalid draft schemas when account ownership is recognizable. Employees see only valid same-account envelopes with current module read/operation permission and an authorized relay grant. Foreign-account and unknown-owner payloads cannot be exported; connected administrators may archive or explicitly delete those quarantined copies after review.

Recovery files contain draft data. Store them securely. The native host selects the bytes from protected storage, limits file size, and rechecks authorization after the picker. Renderer requests contain receipt identifiers, not filesystem paths or export content.

**Import recovery file** accepts only a matching account/workspace, supported format and digest-valid envelope. Files cannot supply accepted-state authority. A matching protected outcome on this device is retained; otherwise the receipt is provisional and requires explicit review/submission. Invalid draft schemas remain invalid rather than being treated as accepted. Original idempotency keys are preserved, allowing server validation to recover an uncertain prior result without creating a duplicate effect.

## Explicit deletion

An archived copy can be deleted only through a separate confirmation. Export it first if its contents may be needed later. Deleting the copy neither cancels a request already sent to the server nor reverses a committed change. A pending outcome remains uncertain; restoring the original request and retrying with its original identity is how to resolve it.

Accepted inbox receipts retain their existing **Dismiss accepted receipt** action. Unconfirmed inbox work is moved to the archive instead of silently discarded.

## Employee and offline authorization

The native main process obtains current company policy and verifies the signed module contract. Employees need a `lan.relay` declaration, its permission, assigned/enabled/entitled access to the module and its dependencies, and the module view permission where applicable. Resource receipts additionally require resource read permission; queued custom operations require their declared operation permission. A peer-status grant is insufficient. Submission also requires the authoritative server's current write/operation permission.

Offline review, archive, restoration, file export/import and explicit copy deletion require previously prepared signed relay authority with `offline: "lease"`, device storage consent and an unexpired corporate lease. The main process verifies the protected package, issuer, exact release, permissions and clock history. Neither a renderer connectivity flag nor a file grants authority. Offline administrators use these same scoped grants; cached administrative status alone is insufficient.

Local recovery remains available while the network listener is disabled. It does not send business writes. The submit control stays disabled offline and the native submit method independently rejects the request. Online recovery rechecks policy and grants before returning receipt contents or applying local actions, including after native file dialogs. Known denial, expiry and profile changes prevent recovery; the stored draft and retry identity remain intact.

Receipt queries are keyed by account, workspace and authorization context. Failed or cancelled revalidation cannot retain a stale preview. Files contain no trusted accepted-state claim. A locally uncertain receipt stays uncertain through archive/file recovery; its original server retry identity resolves the outcome after reauthentication.

## Prerequisites and original releases

Before submission, the host resolves prerequisites from protected local outcomes or a read-only server lookup. The server acknowledges only committed module requests for the same account and workspace under current module assignment, entitlement and operation permissions. Unknown and inaccessible keys produce the same result; responses expose no business payloads. A missing acknowledgement keeps the dependent draft provisional without blocking unrelated work. Remote acknowledgements are not copied into local outcomes as if this device had verified the original contents.

The review shows the draft's original module release. Submission retrieves and verifies that exact signed contract and preserves both the original version and retry key. Merely retrieving a historical contract does not authorize execution. An administrator can allow a compatible original version through the existing optional rollout policy; schema, backend, dependency and permission checks still apply. An incompatible or mandatory update blocks new old-version execution and leaves the draft available for review or export. There is no automatic conversion or substitution of a new retry identity.

If the server already committed the original request, retrying can recover its recorded result even after a mandatory update. Current account, workspace, module and operation authority still apply. A lost reply remains uncertain until this authoritative retry succeeds; it never appears accepted because a peer or recovery file claims success.

## Remaining scope

Process restart plus reauthentication is supported; explicit sign-out/profile removal still requires the broader OFF-03/identity recovery work and is not covered by this milestone. Production identity providers, deployment certificates and other target platforms retain their own acceptance gates.

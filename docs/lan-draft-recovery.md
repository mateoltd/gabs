# Received draft recovery

An authorized company administrator can manage same-account receipts in **Settings → Local network → Received drafts**. Reading, exporting, importing or moving a receipt does not submit it. The server accepts business changes only after an explicit submission with current module access and a valid queued-operation contract.

## Inbox and archive

The inbox holds ten transport envelopes. At capacity, new deliveries are refused without removing existing work. The sender must retry after space is available. The interface shows the occupied slots.

**Archive draft** stores the complete original envelope in the account/workspace's encrypted archive before removing its inbox copy. The archive holds up to 100 copies and 16 MiB of serialized contents; encryption/database overhead is additional. It does not evict pending work. A full archive refuses the move and keeps the inbox draft intact. Capacity and retention are shown in the archive view.

**Restore to inbox** writes the original envelope back before removing its archived copy. If either move is interrupted, two copies may remain temporarily; retrying the exact move reconciles them safely. A full inbox leaves the archived copy intact. Repeated network deliveries of an already archived exact receipt are acknowledged without reopening it in the inbox. Changed content under that archived retry identifier is rejected.

Copies remain until explicitly restored or deleted. There is no automatic age-based deletion. Small protected server-outcome records remain after copy deletion so dependency acknowledgements and uncertain retry identities are not silently erased. An archive is still device-local storage, not a backup.

## Recovery files

**Export recovery file** uses a native save picker and writes a versioned JSON file containing the original account/workspace-bound envelope. Invalid draft schemas can be exported when their account ownership is recognizable. Foreign-account and unknown-owner payloads remain protected and cannot be exported through this interface. They may be archived or explicitly deleted after review.

Recovery files contain draft data. Store them securely. The native host selects the bytes from protected storage, limits file size, and rechecks authorization after the picker. Renderer requests contain receipt identifiers, not filesystem paths or export content.

**Import recovery file** accepts only a matching account/workspace, supported format and digest-valid envelope. Files cannot supply accepted-state authority. A matching protected outcome on this device is retained; otherwise the receipt is provisional and requires explicit review/submission. Invalid draft schemas remain invalid rather than being treated as accepted. Original idempotency keys are preserved, allowing server validation to recover an uncertain prior result without creating a duplicate effect.

## Explicit deletion

An archived copy can be deleted only through a separate confirmation. Export it first if its contents may be needed later. Deleting the copy neither cancels a request already sent to the server nor reverses a committed change. A pending outcome remains uncertain; restoring the original request and retrying with its original identity is how to resolve it.

Accepted inbox receipts retain their existing **Dismiss accepted receipt** action. Unconfirmed inbox work is moved to the archive instead of silently discarded.

## Remaining scope

The recovery flow requires current administrator authorization. Employee/delegated authority, dependencies accepted on another device, inactive authoring-release reconciliation and offline recovery authorization remain separate required gates. Process restart plus reauthentication is supported; explicit sign-out/profile removal still requires the broader OFF-03/identity recovery work and is not covered by this milestone. Production identity providers, deployment certificates and other target platforms retain their own acceptance gates.

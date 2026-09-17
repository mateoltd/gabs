# Local device capability authority

The local profile host now stores device-capability consent alongside encrypted records and installation metadata. This is the authorization foundation for SDK-05. The consent interface, worker message broker and native effect integration remain unfinished.

## Profile API

`await localCapabilityAccess(session.data, catalog)` lists verified declarations from available standalone modules. `await session.setCapabilityAccess(moduleId, alias, allowed)` persists an explicit decision. Corporate-only definitions are ineligible. Revocation can remove a saved grant even if the installed artifact can no longer be verified.

A grant binds the module ID, version, capability alias, capability kind, declared permission and exact signed package digest. Bundled definitions bind their complete canonical contract. Each decision receives a new random grant ID. Regranting access cannot revive a request prepared before revocation.

`await session.prepareCapability(call)` resolves the request against the host's installed definition and validates the capability input. Its result contains an immutable request, profile-scoped metadata and an `assertCurrent()` function. Brokers must call that function immediately before an effect and after asynchronous work such as a save dialog. Device interactions must not hold the profile transaction queue, so a pending interaction cannot prevent revocation.

The guard rechecks current encrypted-vault revision, unlocked state, installed release, signature and original consent. It rejects profile changes during validation. It is a process-local object, not an IPC token or corporate authorization. A returned descriptor alone never authorizes a device effect.

## Lifecycle

- Locking invalidates existing guards. Unlocking reloads durable consent for newly prepared requests.
- Another window changing or removing the profile invalidates the stale session.
- Different release bytes require renewed consent. Updates discard the previous grant, so rolling back cannot revive it.
- Repairing the exact same signed release preserves its grant.
- Uninstall clears device grants and preserves business records. Reinstall requires new consent.

## Remaining integration

Connect explicit consent controls to this authority, add bounded worker request/reply messages and revalidate in the desktop effect broker. Verify cancellation, delayed authorization and native context changes with actual bounded adapters. Preserve typed SDK capability clients and result validation. Corporate offline capability leases and positive LAN transport remain separate SDK-05/OPS work.

`prepareCapability` waits for outstanding profile transactions. Calling it from a worker callback while that same transaction waits for the worker would deadlock. The broker must explicitly coordinate its execution phases and cancellation; device dialogs must not hold the profile write queue. External device effects also cannot be rolled back with local business records. Resolve that execution contract before exposing worker-side effect calls.

[Verification](verification/local-device-grants/README.md) covers the profile authority only; it does not establish worker/native device execution or UI consent acceptance.

# Standalone service composition

Use the same public `serviceReference(provider, operation)` declaration as corporate modules, with a compatible module dependency. A provider operation must declare both `policy: "local"` and `public: true`; its permission must belong to the provider's declared permissions. The consuming alias copies the typed input, output and error contract into its signed release.

Within `defineLocalModule`, `ctx.service(alias, input)` infers the provider's input and output. `ctx.serviceAttempt(alias, input)` returns the provider's declared business error as a discriminated result. Undeclared aliases, wrong input/output types and corporate operations fail compilation. See the [compiled authoring example](../tests/fixtures/local-services.ts) and [independently published fixture](../tests/support/local-service-fixture.ts).

A service gets its own installed configuration and standalone resources, plus the same `profileId` and root `requestId`. `ctx.caller` identifies the immediate consuming module and operation. Resource methods remain scoped to the executing module; a service declaration does not permit direct access to another module's tables, corporate services, credentials or native APIs.

## Consent and lifecycle

The profile owner opens **Manage local modules → Service access**. `localServiceAccess(session.data)` lists eligible aliases and effective grants. `await session.setServiceAccess(consumerId, serviceAlias, allowed)` saves or revokes consent in the encrypted profile. Consent defaults to denied and binds both exact releases. Updates to either release require renewed consent; uninstalling either clears the related grants and preserves business data and historical receipts.

At execution, the profile host follows only current, granted service edges. The worker verifies provider packages and contracts before loading their reviewed executable code. A call must still match the dependency range, copied public local operation contract, declared provider permission and exact grant. An incompatible provider does not become callable simply because its version satisfies a dependency range.

Reference access remains a separate grant. A service can return a record identifier without granting the consumer permission to browse that provider resource. When reference read access is also granted, reference validation sees provider records already created by earlier calls in the same transaction.

## Atomic execution and recovery

`executeLocalTransaction` coordinates a root local request and the participating module snapshots. Service calls are serialized within each invocation, including calls submitted with `Promise.all`; nested service chains share the same transaction. Recursive calls, chains deeper than 16 modules and more than 1000 service calls in one request are rejected.

All participating records and the root idempotency receipt commit together to the encrypted profile. Nested calls do not create independent receipts or commit early. A caught or detached child failure still aborts the transaction. Use `ctx.reject` to translate a declared child business error into the consumer's declared error; returning success after catching it cannot accept earlier writes.

Cancellation, worker failure, locking, profile removal or a competing profile revision prevents a stale result from committing. The saved root request can be recovered after unlocking with `retry(savedAttemptId)`; the attempt ID is obtained from the profile's request journal and is distinct from the operation's request key. Repeating an accepted request returns its original receipt without repeating provider effects. Historical accepted results survive permission changes; revocation prevents new service execution rather than erasing accepted records or receipts.

The pure SDK transaction function assumes host-supplied, authorized snapshots. It is not a signature verifier or a corporate authorization endpoint. The actual profile worker verifies packages, and the profile host checks the current vault revision before dispatch and before committing the result. Reviewed module code remains trusted application code, not hostile code sandboxed by the worker.

[Verification and limits](verification/local-services/README.md). Standalone device capability consent/brokering, corporate offline host leases and the remaining SDK-05 requirements remain open.

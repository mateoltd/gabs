# Read-only module operations

16 September 2026. SDK-01 remains active. This adds a reusable query boundary; the default Orders/Inventory releases remain unchanged.

## Implemented

Operations can declare `kind: "query"` with online execution. Their generated clients use the versioned `/queries/{operation_name}` endpoint over web HTTP and narrow Electron IPC. Queries do not require or record idempotency keys and do not append operation audits. Supplying the same key does not return a stale saved result. The response disallows HTTP caching; offline working-set reads are separate.

The inferred query context exposes resource/private-store reads and declared query services. Compile-time checks reject writes, row locks, audits, events, command services and queued query declarations. The host repeats those checks even when handlers bypass the types. A caught or detached prohibited call fails the whole operation, including any enclosing command's earlier writes. Query contracts require scoped backends.

Top-level queries run in a PostgreSQL repeatable-read, read-only transaction with current request authorization, selected-release compatibility, current-operation permissions and service-only visibility checks. All reads and query-service calls in that request see the same snapshot. Query services invoked inside a command retain the command's transaction and isolation; they still cannot write.

Inventory candidate product/get/overview/movement operations and Orders candidate get/list/overview/export-page operations now use this boundary. Product-resolution services that deliberately lock snapshots remain commands. The independently built Custom notes acceptance module reads through a query operation, preserving its existing layout and interactions.

## Verification

- All 123 unit/PostgreSQL tests in 24 files passed with strict TypeScript and boundary/copy checks. All four production builds passed.
- All five query acceptance tests passed again after adding service-only, stale-version and foreign-workspace assertions.
- The real API rejects create/replace/archive/row-lock/resource-write/audit/event attempts, both caught and detached; query-to-command service calls also fail. A command that writes before calling a failing query rolls back its records, revisions, audit, outbox and receipt.
- Repeated query requests observe committed changes without adding records, revisions, business audits, outgoing events or receipts. Explicit grants and read permissions are rechecked. Query/command endpoint confusion is rejected.
- A coordinated concurrency test pauses a query between reads, commits a separate command and verifies both query reads retain the earlier value; the next request sees the new value. PostgreSQL also rejects a direct write in the read-only transaction.
- Type proofs cover query-only services, typed resource data, unavailable mutations, row locks and online execution. The simulator rejects caught/detached query effects and does not cache query results as command receipts.

Four selected headless browser journeys passed: independent signed-module installation with a verified `/queries/names` response, the existing stock/order workflow, administrator configuration/publication/assignment, and open custom-editor preservation until explicit replacement. All three selected minimized/unfocused Electron journeys passed: renderer boundaries, unconfigured sign-in and the independently signed module reading through the native query transport. Wide/narrow browser and native screens were visually inspected; no layout or styling changed.

Logs: `/tmp/gabs-readonly-check.log`, `/tmp/gabs-readonly-final-query-tests.log`, `/tmp/gabs-readonly-build.log`, `/tmp/gabs-readonly-browser.log`, `/tmp/gabs-readonly-native.log`, `/tmp/gabs-readonly-lifecycle.log`, `/tmp/gabs-readonly-format-check.log`.

## Remaining work and limits

- A separate HTTP page starts a new snapshot. The complete worker export still needs all its pages in one authorized snapshot transaction; multi-request export pagination is not point-in-time consistency.
- Permissions are checked against the request's transaction snapshot. Revocation committed afterward affects subsequent requests; this is not cancellation of already running database reads.
- Authoritative relational extraction, cross-record validation/reservation reconciliation, coordinated migration, current API/client/UI and worker adapters, and explicit permissions/service grants remain required before selecting production 2.0 releases.
- Deployment-scale query/index performance and current remote latency acceptance remain open. Full parity and the separately authorized UI refinement remain unfinished.

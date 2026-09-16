# Scoped queries and business read models

16 September 2026. SDK-01 remains active; default Orders/Inventory application releases are unchanged.

## Implemented

Private stores now expose typed `query` and `aggregate` capabilities through the same module/workspace transaction boundary. Queries support schema-checked exact filters, literal case-insensitive search on declared string fields, typed ranges, up to three scalar sort fields and bounded keyset pagination. Numeric values sort numerically. A record UUID breaks ties; missing/null values sort last in either direction. Search uses the database locale while sorted string cursors use deterministic byte ordering.

Field names and values are SQL parameters. Neither arbitrary SQL nor a foreign namespace is exposed to module authors. Unknown fields, unsupported field types, malformed filters, excessive limits and mismatched cursors fail at the host boundary. Queries exclude archived records.

Pagination tokens encrypt and authenticate saved sort values with AES-256-GCM and bind them to the actor, workspace, module, store, filters and sort order. They retain their position when the anchor record is archived. Production requires the shared `MODULE_QUERY_CURSOR_KEY` secret (32 bytes, hexadecimal) on every API/worker instance that executes private queries. Development/test can omit it and use a process-local key; restarting then requires reloading a paginated list. Key rotation likewise invalidates old cursors, without changing business data or pending operations.

Aggregates compute complete filtered counts, requested numeric sums and optional scalar groups in one SQL statement. They do not derive totals from a displayed page. Group cardinality is capped at 200; exceeding the requested limit fails instead of truncating silently. Unsafe integer totals and non-finite numeric results fail explicitly. An empty result has zero count/sums and no groups.

The Inventory 2.0 candidate now uses these capabilities for product search/pagination, full active-stock totals, the five lowest-stock products and chronological movement history. The Orders 2.0 candidate uses them for customer/status filtering, status totals, seven UTC fulfillment days, ready/recent orders and bounded exports in numeric order-number sequence. Fulfillment dates are derived by the server and by prepared-snapshot migrations.

## Verification

- All 118 unit/PostgreSQL tests in 23 files passed with strict TypeScript and boundary/copy checks. All four production bundles built.
- After refining locale-aware search, all 25 affected business/store/cursor tests passed; the eight store tests passed again with an accented case-insensitive search assertion.
- Query tests exercise ascending/descending numeric order, duplicate sort values, null/missing values, filtered pages, archived anchors, literal `%`/`_` searches, accented text, malformed/injected field names, wrong types/limits and foreign query/workspace cursors.
- Aggregation verifies 205 records across groups, complete totals, empty results, foreign module isolation, group overflow and unsafe integer sums. Compile-time checks reject numeric search fields, text numeric bounds, text sums and undeclared sum results.
- Cursor tests verify confidentiality, tamper/scope rejection, randomized encoding, missing/invalid production keys, shared-key decoding and invalidation after key rotation.
- Signed API acceptance creates more than 50 matching products and orders, traverses all pages, checks complete summaries, literal/case-insensitive filters, chronological movement pages, numeric exports and seven-day fulfillment counts. These execute the candidate read models, not the legacy SQL handlers.

Three selected headless browser journeys passed: the stock/order workflow, independent executable module installation and administrator migration. Three selected minimized/unfocused Electron journeys passed: renderer boundaries, unconfigured sign-in behavior and independent signed-module execution. These preserve the current application baseline; the candidate read models are verified through signed API acceptance.

Logs: `/tmp/gabs-query-check.log`, `/tmp/gabs-query-final-test.log`, `/tmp/gabs-query-locale-test.log`, `/tmp/gabs-query-build.log`, `/tmp/gabs-query-browser.log`, `/tmp/gabs-query-native.log`.

## Remaining SDK-01 work

- Follow-up: [read-only operation acceptance](../read-only-operations/README.md) now replaces command dispatch for candidate reads with a consistent per-request snapshot and no effect receipts/audits. Complete worker exports still require one snapshot across all pages; multi-request pagination is not point-in-time export consistency.
- Authoritative relational extraction, cross-record validation, reservation reconciliation and coordinated schema migration of both modules.
- Current API/client/UI adapters, worker export/event integration, explicit role/service grants and supported version/queue migration before production 2.0 selection.
- Large-data and deployed latency acceptance of the final read paths. Functional query tests do not establish suitable indexes or production query-plan performance. OPS-07 remains open for the existing remote read budget.

The current UI was not redesigned. Full parity, production rollout and later UI refinement remain unfinished.

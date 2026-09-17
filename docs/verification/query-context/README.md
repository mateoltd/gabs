# SDK-04: complete read-only resource query contracts

17 September 2026. SDK-04 and full parity remain active.

## Change

`QueryContext.resource()` now projects the read methods of the same inferred `ResourceClient` used by module clients. Read-only server operations can compose equality filters, ranges, sorting, pagination, references and cancellation options without duplicate request interfaces. Create, update and archive remain absent from the authoring contract; authoritative runtime checks continue to reject writes from queries.

The independently built Resource explorer fixture now includes a read-only server operation combining approved-record filtering, a numeric lower bound, descending amount sorting and two-record cursor pages. Its input and output schemas remain the only application-facing definitions. The development simulator, published HTTP query and desktop bridge execute the same typed handler.

## Verification

- Formatting and all 579 checked local documentation links passed. Strict TypeScript, dependency/copy checks and four production builds passed (`/tmp/gabs-query-context-build.log`). Compile-time negative cases reject resource writes, undeclared resources, wrong filter operands, boolean ranges, unknown sort fields and invalid directions.
- **226 unit/PostgreSQL tests across 48 files passed in 54.60 seconds** on a freshly migrated/seeded temporary database (`/tmp/gabs-query-context-full.log`). The focused simulator test also passed (`/tmp/gabs-query-context-unit2.log`). Existing query authority tests cover command/query confusion, writes, locks, events and caught/detached failures.
- **Two headless browser journeys passed in 13.8 seconds** on a temporary database (`/tmp/gabs-query-context-browser.log`). Signed server publication is exercised through the public CLI. Query pages return the expected filtered order, changed range/cursor combinations return 400, and revoking resource-read permission returns 403 despite retaining permission to invoke the operation. Existing query UI, cancellation, development permission races and offline reconnect assertions also pass.
- **One hidden/unfocused Electron journey passed in 7.9 seconds** on a temporary database (`/tmp/gabs-query-context-native.log`). The typed query runs through `moduleQuery` with the signed module version, returns the expected records, and the custom UI remains usable. Hidden/minimized and unfocused state is asserted before and after.
- Temporary databases were removed. The shared development database and preview services were preserved. A generated browser capture was inspected; this change does not alter UI source or styles. Regression captures were restored to their historical versions.

## Remaining SDK-04 acceptance

The [acceptance map](../../sdk-04-acceptance.md) identifies an actual remaining validator gap: resource get/list/mutation responses are currently cast to `ResourceRecord`/`ResourcePage` without validating the returned resource schema and envelope. Runtime operation outputs and reference pages already have validators; their existence does not prove resource response validation. That work is next. Broader UI-kit, standalone capability, offline, performance and production-release gates remain tracked separately without changing the original scope.

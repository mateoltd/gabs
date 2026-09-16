# Orders through the public module SDK

16 September 2026. SDK-01 remains active. These are independently packaged Orders/Inventory 2.0 server candidates, not the default application releases.

## Implemented

Orders drafts, edits, confirmation, cancellation and fulfillment now have a scoped candidate backend. It receives private store repositories and declared Inventory services; it imports no SQL, transaction object or Inventory implementation. Order numbers use a private counter with an absent-record lock. The server normalizes product identities, calculates bounded integer totals, resolves product snapshots through the provider and enforces order state and version rules.

Confirmations reserve stock through Inventory. Cancellation releases the saved reservation only when the order was confirmed. Fulfillment consumes the saved authoritative quantities. Both modules' records, audits, events and the outer receipt share one transaction. Product snapshots remain historical until a draft edit refreshes them. Business versions are separate from private storage revision numbers so prepared imports preserve existing order versions.

The SDK provides `ctx.serviceAttempt(name, input)` with inferred provider success/error types. A handler may translate a declared provider error into its own `ctx.reject` contract. The transaction still rolls back; ignoring the typed rejection cannot commit earlier writes. Permission, grant and transport errors do not become typed business errors.

`pnpm module services <provider-directory> <output.ts>` exports public service contracts as portable typed source. Consumers import this generated snapshot instead of the provider's implementation. `--check` detects drift; `--update` explicitly regenerates an existing file. Unsupported schema shapes fail with the operation/field path rather than weakening inferred types. The current exporter handles objects, arrays, primitives, literals, unions and intersections; dictionary/tuple/reference-schema extensions remain part of broader SDK authoring work.

`pnpm module build <directory> --dependency <provider-directory>` resolves independently authored provider versions without editing the host catalog. The option may be repeated. This produces local signed packages; publication still requires the review/staging workflow and does not follow automatically from a build.

The Orders migration validates prepared legacy order totals, distinct product lines and the authoritative next-number counter. It preserves archived records, business versions and bounded activity history, archives the source snapshots and rejects inconsistent or missing counters rather than reusing order numbers.

## Verification

- All 112 unit/PostgreSQL tests in 22 files passed. Strict TypeScript, boundary/copy checks and all four production builds passed.
- `tests/business-sdk.test.ts` extends the preceding Inventory acceptance with the actual independently signed Orders backend. Only fixture version metadata and provider version references change for isolated prereleases. Both packages are submitted, reviewed, staged and selected through workspace pins before real module API calls.
- Six simultaneous first-use drafts receive distinct numbers. Totals and product names/SKUs come from server calculations and provider snapshots. Forged state/totals and oversized totals are rejected; retry returns the same draft without more effects.
- Competing seven-unit orders against ten units produce one confirmation and one typed insufficient-stock error. The losing order stays a draft. Fulfillment and receipt replay leave one fulfillment audit, one consumption audit and the correct remaining balance.
- Edits enforce business versions and draft-only state. Confirmed cancellation releases stock; draft cancellation creates no stock effects. Another workspace cannot read the order. Later-product failure restores both modules, events, audits and receipts; missing grants fail before business commitment.
- Prepared import rejects inconsistent totals and counters atomically. Successful import preserves business version 7, original activity/product snapshots, archived history and next order number 100. Migration replay creates no duplicate records.
- Generated public contracts match the provider canonically. Compile-time checks reject unknown services, wrong inputs and undeclared error fields. Runtime acceptance proves both explicit error translation and rejection of ignored service failures.
- The CLI checked the committed Inventory service snapshot and built the Orders 2.0 signed client/server packages with its explicit Inventory 2.0 dependency. Local outputs remain under ignored `.local/modules`; production 2.0 releases were not published.
- All eight selected headless browser journeys passed: stock-to-fulfillment, offline recovery, viewer permissions/themes/narrow layout, workspace isolation, storage failure, overview/keyboard/dialog behavior, independent executable installation and administrator migration.
- All three selected real Electron journeys passed hidden/minimized and unfocused: renderer boundaries, unconfigured production authentication and independent executable installation. Existing screens were not redesigned. These are baseline regression checks, not a UI rollout of the new business candidates or cross-OS installed acceptance.

Logs: `/tmp/gabs-orders-check.log`, `/tmp/gabs-orders-build.log`, `/tmp/gabs-orders-cli-build.log`, `/tmp/gabs-orders-contract-check.log`, `/tmp/gabs-orders-browser.log`, `/tmp/gabs-orders-native.log`.

## Still required for SDK-01

- Reusable search, aggregates and read models for lists, movement history, overview, export and notifications/events. The candidates' bounded exact-filter scans do not replace these existing surfaces.
- Authoritative relational-data extraction, cross-record/reference reconciliation, reservations and a coordinated migration of both modules. Prepared private snapshots are fixtures, not evidence of complete conversion from the existing tables.
- Current UI/client operation adapters, queue compatibility and explicit role/service-grant readiness, followed by end-to-end migration and supported pinned-version acceptance before selecting/publishing the 2.0 application contracts.

The default Orders 1.1 and Inventory 1.2 still use their trusted bridges. SDK-01, the full parity goal, performance acceptance and the later UI-refinement goal are not complete.

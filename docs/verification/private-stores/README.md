# Scoped private module stores

16 September 2026. SDK-01 foundation; the Orders/Inventory migration remains active.

## Delivered

Modules can declare private `stores` with the public `store` helper. Store names, fields, filters, values and results are inferred from the same schemas. Server handlers use `ctx.store(name)` for bounded scans, reads with optional row locking, creation, version-checked replacement and archival. The host supplies the workspace and module namespace; handlers receive no SQL or transaction object.

Private stores share the existing tenant-isolated record/history tables under an internal namespace that public resource routes cannot address. Store commands and data are validated on the server. Queries are parameterized, scans are capped at 200 records, and writes are capped at 1 MiB. Declared scalar unique fields are checked under a transaction lock. Archival preserves records and revision history. Uninstall retains this storage.

The enclosing operation rechecks current authorization and module availability. Store changes, their audits, declared outgoing events, granted cross-module service changes and the idempotency receipt share the same transaction. Failed capability calls cause rollback even when a handler catches or detaches them. SDK promise handling also avoids an unhandled rejection from a detached failed write.

Forward migrations can use `ctx.store(name).scan/create/write/archive`. Historical values remain unknown until the migration validates them. The host checks target schemas, including archived records, and active unique values before committing a schema version. Migration failure restores earlier writes and history. Signed JSON hydration retains private-store schemas; the reviewed migration package executes through the existing staging pipeline.

## Verification

- All 93 unit/PostgreSQL tests passed across 20 files, including five new store API tests. Strict TypeScript, dependency boundaries, copy checks and four production builds passed.
- The real module API tests concurrent reservations without overselling, unique-key races, stale versions, retry deduplication, caught/detached rollback, workspace/module isolation, public CRUD rejection, bounded filtered pagination and data-preserving archival.
- A two-module test requires an explicit service grant and verifies both private stores, events and audits roll back together. A retried accepted service call creates no duplicate effects.
- Compile-time checks reject unknown store names, wrong value types, unknown filter fields and nonexistent unique fields.
- The independently signed migration fixture tests private-record conversion, copy/archive, unique-value rejection, rollback and foreign-workspace preservation alongside existing interrupted migration and compatible pin acceptance.
- Both selected headless browser journeys passed: independent executable installation and the administrator migration flow. No UI layout or visual styling was changed.

All three selected real Electron journeys passed minimized/unfocused: renderer/credential boundaries, unconfigured production authentication behavior and independent executable installation. These are regression checks of the local macOS runtime, not cross-OS signed installation acceptance.

## Remaining SDK-01 work

Orders and Inventory still use their trusted SQL bridges. Their production handlers, read models, shared reservation services, existing-data migration and supported version compatibility have not been moved by this foundation change. Rich query/aggregation needs must be addressed through reusable public contracts as that migration proceeds. Private stores currently require an authoritative server transaction; standalone worker execution remains SDK-02. Reference IDs in private data do not authorize cross-module access: handlers must use declared, granted services to validate or affect another module.

This is engineering acceptance of a reusable capability, not a claim of complete module-framework or business-application parity.

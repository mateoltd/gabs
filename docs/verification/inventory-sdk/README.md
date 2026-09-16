# Inventory through the public module SDK

16 September 2026. SDK-01 remains active. This is acceptance of the Inventory 2.0 server candidate, not a default-release rollout or complete business-module migration.

## Implemented

`modules/inventory/releases/2.0.0` contains a self-contained scoped backend using only public SDK imports. Products/balances, movements, counts and reservation history use private stores. Receipts and adjustments have separate operation permissions, checked before receipt replay. Product and stock versions remain independent so unrelated product edits do not invalidate a physical count.

Reservations are service-only operations. Direct client requests, including administrator requests, are denied before execution or saved-receipt lookup. A consumer still needs a declared compatible dependency/service, a separate workspace grant and the actor's current provider permission. The server supplies immutable caller identity. Only the module that created a reservation can release or consume it, using its saved authoritative lines. Clients cannot submit replacement consumption quantities.

Declared `audit` actions expose typed `ctx.audit(action, targetId)`. The host applies the module prefix and writes through the same transaction as business records, events and the outer receipt. Invalid audit calls cause rollback even when caught or detached. Logical record locks also protect absent IDs, including UUID casing variants; unique constraints use scoped value locks instead of serializing every record in a store.

Explicit root pins can select prereleases. Ordinary release discovery still chooses stable releases, and consumer dependency ranges still apply. Development consumers resolve a published provider's selected workspace contract instead of the older bundled definition.

The candidate migration validates prepared private legacy snapshots, checks product balance relationships and duplicate reservation lines, copies records into the new stores, preserves archival state and retains source history. It is not the relational-data extraction or coordinated Orders/Inventory migration.

## Verified locally

- All 104 unit/PostgreSQL tests in 21 files passed, including strict TypeScript and boundary/copy checks. All four production bundles built.
- Eight Inventory tests build the actual candidate source into an independently signed server package, submit/review/stage/publish a uniquely pinned test prerelease, and invoke the real module API. The production version stays unpublished. Fixture consumers exercise granted calls; they are not the production Orders implementation.
- Concurrent reservations cannot oversell. A multi-product failure and rejection by the calling module restore stock, records, audits, events and receipts. Fulfillment and counts replay without duplicate effects.
- Another module cannot release a reservation; absent grants, revoked provider permissions and direct stock-service requests fail. Foreign workspace products are unavailable. Availability-only actors do not receive full balances.
- Counts reject stale stock versions and values below reserved stock. SKU normalization preserves uniqueness; duplicate product lines and inactive product commitments fail. A maximum-length count reason remains supported.
- Signed migration rejects inconsistent imported balances after an earlier write and restores the original schema/records/history. Successful import retains product/stock versions and archival state; replay performs no duplicate migration.
- SDK regressions cover first-use concurrent counters, declared audit typing and caught/detached audit rollback. A service-only policy change denies direct replay of a formerly accepted client operation. Prerelease resolution retains consumer compatibility constraints.

All eight selected headless Chromium journeys passed: stock-to-fulfilled-order, offline recovery, viewer permissions/themes/narrow layout, workspace response isolation, storage failure, overview/keyboard/dialog behavior, independent executable installation and administrator migration. All three selected real Electron journeys passed minimized/unfocused: renderer boundaries, unconfigured production authentication and independent executable installation. Inventory and native custom-view captures were inspected; these are baseline regression checks, not UI design approval or a native Inventory 2.0 rollout.

Command logs: `/tmp/gabs-inventory-check-final.log`, `/tmp/gabs-inventory-build.log`, `/tmp/gabs-inventory-browser.log`, `/tmp/gabs-inventory-native.log`. Formatting is verified separately before the checkpoint.

## Required before production selection

- Migrate the actual Orders handlers and counters to private stores and declared Inventory services, preserving actionable typed dependent errors.
- Prepare and validate existing relational products, balances, movements, counts, orders and reservation history under coordinated migration locks. Verify cross-record consistency, references and exact stock reconciliation. A prepared-snapshot fixture does not establish this conversion.
- Complete reusable search/aggregation/read-model capabilities, movement/history/overview/export integrations, event processing and client adapters. The candidate's bounded exact-filter product scan alone does not replace the existing read surfaces.
- Establish explicit permissions/grants and readiness for existing roles; preserve supported pinned executable/schema combinations and validate end-to-end migration before publishing client 2.0 releases.

Current web/desktop screens and the default Inventory 1.2 / Orders 1.1 contracts still use their existing bridges. No UI polish or overall parity claim accompanies this milestone.

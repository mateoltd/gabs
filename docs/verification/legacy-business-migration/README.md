# Coordinated legacy business migration

16 September 2026. SDK-01 remains active. The server conversion is implemented and exercised against signed candidate releases; current application adapters and the administrator cutover flow remain unfinished.

## Implemented

The host-only `migrateLegacyBusinessStorage` coordinator extracts authoritative relational products/stock, movement history, counts, orders/lines/customer names, order activity and the next order number. Extraction uses bounded 200-record pages. It validates source balances against movement history and active orders, checks each order's reservation/release/consumption quantities, checks line totals and numbering, and validates every prepared record against the target signed schema. Contradictory source data fails with a record-specific diagnostic.

Both modules move in one workspace transaction under the exclusive storage lock. The coordinator stages private source snapshots, selects explicit mandatory target pins, invokes the reviewed public migration handlers in dependency order, validates supported releases and commits both schema changes, audit, outgoing events and completion together. Savepoints also prevent a caller that catches an error from committing partial conversion. Duplicate attempts return the stored completion without duplicating effects.

Source tables and archived prepared snapshots remain available for recovery. Record IDs, business versions, quantities, prices, order product snapshots, movement/count actors and timestamps, recent order activity and the actual next order number are preserved. Original order creators remain in the retained source and prepared snapshots; creation of target private records is attributed to the migration actor. The legacy movement table did not capture historical SKUs, so conversion captures the product's current SKU for those movement rows. It does not invent earlier SKU values.

Confirmed, fulfilled and previously confirmed/cancelled orders receive owned reservation histories with the corresponding reserved, consumed or released state. Drafts and orders cancelled before confirmation have no fabricated reservation. Already accepted legacy requests can recover their original receipts; new legacy-contract commands require an update.

Database migrations 023/024 fence writes to retired products, stock, movements, counts, orders, lines, customers and the legacy number counter. A writer already waiting at cutover is rejected after the migration commits. Legacy writes require read-committed isolation so a transaction snapshot predating cutover cannot hide retirement; new private-store commands have no such restriction. Authorization/storage lock and cache keys canonicalize UUID case to agree with PostgreSQL identity.

The generic single-module migration rejects bypassing this coordinated conversion when relational business data exists. A reusable host batch migration validates the complete rollout after all dependency-ordered schema steps, with rollback of the whole batch on failure.

## Verification

- All 129 unit/PostgreSQL tests in 24 files passed, with strict TypeScript and boundary/copy checks. All four production bundles built. After bounding each order-line read to 101 rows with explicit rejection beyond the 100-line contract, all 21 affected business tests passed again.
- Real legacy API calls create stock/counts and all four order states, then the actual independently signed Inventory/Orders migration handlers convert their data. SDK queries retain the prior identity/state/history, fulfillment consumes the imported reservation, and the next draft continues the legacy number sequence.
- Concurrent duplicate conversion, including an uppercase workspace UUID, commits exactly one conversion audit and two module migrations. A foreign SDK workspace remains unchanged.
- Balance, total, counter and individual reservation inconsistencies fail without prepared records, revisions, pins, schema changes, audits, receipts or outgoing events escaping. A missing entitlement deliberately fails the second module after the first has migrated; catching that failure still leaves the original state intact, and retry succeeds after correction.
- A 206-product/207-movement case crosses both extraction page boundaries and verifies the final record through the SDK.
- A coordinated database-lock test proves an already waiting legacy SQL write fails after cutover; stale transaction isolation and attempts to update the retired counter also fail.
- Two selected headless browser journeys passed: administrator module migration and the existing stock/order workflow. All three selected hidden/minimized Electron journeys passed: renderer boundaries, unconfigured sign-in and independent signed-module execution. These preserve existing interfaces; they do not demonstrate the unfinished administrator business-cutover UI.
- The [local logical restore drill](restore.json) passed in five seconds, including 15 migrated SDK workspaces and an exercised retired-write fence. It checks retained relational data plus migrated private-store balances, ledger/reservations, order totals/states, counters and schema history. Restored RLS hides private records; the restored legacy fence rejects a write as the application role.

Logs: `/tmp/gabs-business-migration-check.log`, `/tmp/gabs-business-migration-final-focused.log`, `/tmp/gabs-business-migration-build.log`, `/tmp/gabs-business-migration-browser.log`, `/tmp/gabs-business-migration-restore.log`, `/tmp/gabs-business-migration-native.log`.

## Remaining SDK-01 work

- Current application API/client/UI adapters, worker event handling and complete snapshot exports must use the selected public SDK contracts before activation of the new production releases.
- Add administrator review of target versions, permission/service grants, pending-work compatibility and cutover results. The internal coordinator does not silently add permissions/grants and is not yet exposed as an administrator action.
- Full coordinated rollout and recovery acceptance, production-scale migration timing/query indexes, and current-candidate remote performance remain open. This conversion deliberately holds the workspace storage lock; it is not a zero-downtime large-enterprise migration protocol.
- Logical restore was local. Managed point-in-time recovery, offsite retention, hosted deployment and installed signed desktop acceptance remain separate requirements.

The current interface remains the existing engineering baseline. Full functionality parity and the later UI-refinement goal remain unfinished.

# SDK-01: Orders export and worker cutover

Verified locally on 16 September 2026. This checkpoint closes the worker/export portion of the scoped Orders migration. The default business releases still use their trusted bridges; business-screen adapters and administrator cutover remain unfinished.

## Behavior

- Existing export creation, status and download routes manage host-owned export records independently of the old Orders executable version. They retain current permission, assignment, activation, actor ownership, idempotency and audit checks.
- Workers choose the workspace's current storage and signed release. Schema-one workspaces retain the guarded relational export. Migrated workspaces execute the reviewed scoped `export-page` query and validate its typed public output.
- All pages share one repeatable-read transaction. Concurrent edits to later pages and newly created orders cannot change an export already in progress. The worker rejects incorrect isolation, incomplete or inconsistent pages, duplicate/out-of-order numbers, and exports above the existing explicit 100,000-order limit.
- The complete CSV is generated before writing the private artifact or marking it ready. Formula-like cells retain escaping. Retries recover ready artifacts and deduplicate notifications. Access is checked when processing and again on download.
- Scoped Orders confirmation, fulfillment and cancellation events now enter the persistent notification inbox with their order number. Other module-event work remains in GOV-04.
- Migration `025_worker_scoped_queries.sql` grants only SELECT on module records and reviewed backend metadata to the worker. Business writes remain denied; workspace RLS still applies.

## Actual verification

- `pnpm check`: **130 tests in 24 files**, strict TypeScript, module/browser boundaries and UI-copy checks passed. Log: `/tmp/gabs-export-check.log`.
- `pnpm build`: **four builds passed**, including worker and desktop. Log: `/tmp/gabs-export-build.log`.
- A final small worker change avoids spreading the entire legacy export into a function argument list. After that change, the **42 affected business/integration tests** and final worker build passed. Logs: `/tmp/gabs-export-final-focused.log`, `/tmp/gabs-export-final-worker-build.log`.
- The signed PostgreSQL acceptance converts a real legacy fixture, populates 203 orders, reads the first 200, then commits a late-page edit and a 204th order from another transaction. The remaining snapshot contains the original three records. A subsequent worker export contains all 204 current records, the later cancellation and an escaped formula cell.
- The same acceptance exercises REST creation/list/download, duplicate request receipts, reclaimed job delivery, one notification per event, revoked export processing/download, worker business-write denial and foreign-workspace read denial. Existing relational export authorization tests also pass.
- **One headless Chromium journey passed**: use the existing Orders export dialog, create a pending CSV, run the actual worker, wait for Ready, download and inspect the file. Log: `/tmp/gabs-export-browser.log`. No UI geometry or styles changed, and no foreground browser or Electron window was opened.
- The final logical backup/restore passed in **six seconds**, including 34 migrated SDK workspaces, all nine zero-violation invariants, the retired-source write fence and unscoped RLS checks. [Recorded result](restore.json). Log: `/tmp/gabs-export-restore.log`.

## Limits and next work

The worker keeps the existing explicit 100,000-order cap and buffers the final CSV in memory. Large-data export throughput and hosted object-storage/recovery acceptance remain open. Permissions are checked against the transaction's consistent snapshot and checked fresh for later downloads; revocation does not retroactively cancel an already-started snapshot.

This is local backend and existing-interface acceptance, not a claim that migrated business screens are ready. Their reads, commands and offline journals still need selected-contract adapters, followed by administrator permission/service-grant review and coordinated cutover. No normal workspace was migrated or candidate release made generally available.

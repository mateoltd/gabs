# Module storage migrations (EXT-03)

A module release declares its desired stored schema separately from its executable version. Omitted storage metadata means schema 1, compatible only with schema 1. The storage contract is part of both signed packages and must match the reviewed server contract.

```ts
storage: {
  version: 2,
  compatible: { minimum: 2, maximum: 2 },
  migrations: { "add-category": { from: 1, to: 2 } },
},
```

Each step advances one integer version. Names and source versions must be unique. Releases upgrading existing records must include a continuous path from the installed schema. An empty, previously uninitialized namespace can initialize directly to its target schema.

## Authoring

Declare handlers with the public server SDK. The compiler requires the declared migration names and rejects missing or unknown handlers. A resource-only module with migrations also needs a signed server package.

```ts
import { defineModuleServer } from "@suite/module-sdk/server";
import module from "./module";

export default defineModuleServer(module)(
  {},
  {
    "add-category": async (context) => {
      let cursor: string | undefined;
      do {
        const page = await context.scan("notes", cursor);
        for (const record of page.items) {
          if (typeof record.data.name !== "string") {
            throw new Error("A legacy note has an invalid name.");
          }
          await context.write(
            "notes",
            record.id,
            {
              ...record.data,
              category: "general",
            },
            record.version,
          );
        }
        cursor = page.next ?? undefined;
      } while (cursor);
    },
  },
);
```

Historical values are `unknown`; validate them before transforming them. `scan` includes archived records and pages at 100 records. `write` replaces data using the expected record version. `create` creates a record in a declared target resource; an optional stable UUID helps preserve identifiers when moving resources. `archive` preserves the original record. Scan, write and archive can address retired resource names within the same module. There is no raw SQL, physical deletion or cross-module write capability.

Public resource references are reconciled recursively after all migration steps, before the schema version commits. New links use the ordinary workspace membership, dependency, resource-read permission and explicit read-grant checks. Targets must exist and be active in the final transaction state. A migration can therefore create a target after writing a link to it; creating and then archiving that target does not satisfy validation. An administrator who introduces cross-module links must also hold the required current business permissions and assignment. Migration permission alone does not grant cross-module access.

Before transforming records, the host snapshots their original data in a transaction-local PostgreSQL table. Historical links are identified by original record, field path, target module/resource (or membership) and case-insensitive UUID, using the signed schema-producing release. A namespace without a recorded storage release uses its currently selected compatible contract. An explicit pin to a not-yet-installed schema cannot establish historical links; without a compatible original contract, all final links require validation. An unchanged link may retain an archived target; moving it to another field or record, changing its array position or changing its target namespace requires fresh authorization and validation. A previously unannotated string does not establish a historical link. Invalid original records can be repaired, but receive no historical-link exemption.

Final validation covers every retained record in the target's declared resources, including untouched and archived records. Comparing against the original snapshot prevents intermediate writes from making a new link look historical. The snapshot is indexed and read in bounded pages, explicitly dropped on success, and removed on rollback or transaction completion. Migration connections require PostgreSQL `TEMP` privilege and sufficient temporary storage for the selected module records. Intermediate record shapes can be incomplete while a migration runs; all final records must satisfy the target schema. These reference semantics cover public resources; private-store and operation-input annotations remain separate work.

## Applying and recovering

Build, submit, review, stage and publish through the [official release workflow](module-server-releases.md). Publication does not alter corporate records. In **Modules > Configure > Stored data schema**, select a release and apply its migration. The authenticated command requires `modules.manage`, an active entitlement, a compatible dependency set and the exact reviewed backend. Permission is checked again after the migration lock is acquired.

A workspace-wide schema lock serializes migrations and excludes ordinary module execution until commit or rollback. It also covers cross-module operations; other workspaces remain independent. Changes, record revisions, applied-step history, schema version, audit and outbox events commit together. A savepoint prevents a caller that catches a migration error from committing partial changes. Detached capability calls are drained and caught capability failures still abort the migration. All retained records in current resources, including archived records, must satisfy the target schema before commit.

If a handler, validation or database query fails before commit, the old schema and records remain. A connection lost during commit may leave the outcome uncertain; refresh the authoritative state and retry. The stored schema and idempotency receipt distinguish an accepted migration from one that rolled back. The interface shows failure and permits a retry. A retry after a completed migration is a no-op; concurrent requests apply each step once. This implementation restarts an interrupted transaction from its beginning. Pagination bounds page size, not transaction duration: plan large migrations against the configured database timeout and service maintenance requirements. It does not support partially committed migration chunks.

## Executable compatibility

Until migration succeeds, resolution prefers releases compatible with the current stored schema. An incompatible explicitly pinned release cannot execute. After migration, older code may run only if its signed compatibility range includes the stored schema; its resource writes also validate against the schema-producing release. A false compatibility declaration cannot bypass resource validation.

Stored schemas never move backward. Roll back an executable only when compatible with stored data; otherwise publish a corrective forward migration. Retired resources and archived originals remain stored. Uninstall still preserves business data.

[Local acceptance evidence](verification/module-migrations/README.md). [Device installation/update recovery](module-lifecycle-recovery.md) now has local browser and native acceptance under EXT-04. Mandatory-update rollout, durable aggregate failure dashboards, hosted acceptance and all-platform packaged release acceptance remain tracked separately under EXT-05 and operations work. This manager applies to SDK resource storage; the existing trusted Orders/Inventory SQL bridges remain SDK-01 work.

## Coordinated conversion of legacy business data

Orders/Inventory schema 2 requires the host's coordinated conversion when relational business records exist. The ordinary single-module action refuses to initialize an empty namespace over that data. `migrateLegacyBusinessStorage` holds the workspace's exclusive storage lock, validates balances/reservations/totals/numbering, prepares schema-validated private snapshots, selects explicit mandatory target versions and calls both signed migration handlers in one savepoint-protected transaction. It preserves source tables and accepted receipts. A database fence prevents later legacy writes and requires legacy write transactions to use read-committed isolation.

This host-only coordinator is verified through real signed candidate acceptance. It is not yet exposed in the administrator UI: current application/worker adapters, explicit permission/grant review and pending-work cutover acceptance must be completed before production activation. See [implementation evidence and remaining work](verification/legacy-business-migration/README.md).

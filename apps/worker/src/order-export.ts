import { sql } from "kysely";
import { assertSchema, Type, type Static } from "@suite/module-sdk";
import { moduleServers } from "@suite/module-catalog/server";
import { orderExportRows } from "@suite/orders/server";
import { requireCondition, type Context, type Tx } from "@suite/server-core";
import legacyOrders from "../../../modules/orders/releases/1.1.0/module";
import orders from "../../../modules/orders/releases/2.0.0/module";
import { workspaceModule } from "../../../packages/server-core/src/module-releases";
import { assertHostModuleRollout } from "../../../packages/server-core/src/module-rollout";
import { moduleStorageVersions } from "../../../packages/server-core/src/module-storage";
import { executeModuleOperation } from "../../../packages/server-core/src/module-services";

type ExportRow = Static<
  (typeof orders.operations)["export-page"]["output"]
>["items"][number];

/** Consume every page in the same transaction; separate HTTP pages are not an export snapshot. */
export async function* orderExportPages(
  tx: Tx,
  ctx: Context,
): AsyncGenerator<ExportRow[]> {
  const isolation = await sql<{
    isolation: string;
  }>`select current_setting('transaction_isolation') as isolation`.execute(tx);
  requireCondition(
    ["repeatable read", "serializable"].includes(isolation.rows[0].isolation),
    500,
    "EXPORT_SNAPSHOT_REQUIRED",
    "Order exports require a consistent database snapshot.",
  );
  if (
    ((await moduleStorageVersions(tx, ctx.workspaceId)).get("orders") ?? 1) ===
    1
  ) {
    await assertHostModuleRollout(
      tx,
      ctx.workspaceId,
      legacyOrders,
      moduleServers,
    );
    const rows = await orderExportRows(tx, ctx.workspaceId);
    const mapped = rows.map((row) => ({
      number: row.number,
      customerName: row.name,
      status: row.status,
      totalMinor: Number(row.total_minor),
    }));
    assertSchema(
      Type.Array(
        orders.operations["export-page"].output.properties.items.items,
      ),
      mapped,
    );
    yield mapped as ExportRow[];
    return;
  }
  const definition = await workspaceModule(tx, ctx.workspaceId, "orders");
  requireCondition(
    definition.operations["export-page"]?.kind === "query",
    409,
    "EXPORT_CONTRACT_REQUIRED",
    "The selected Orders release must provide a read-only export query.",
  );
  let cursor: string | undefined;
  let count = 0,
    total: number | undefined,
    lastNumber = 0;
  do {
    const result = await executeModuleOperation(
      tx,
      ctx,
      definition,
      "export-page",
      { limit: 200, ...(cursor ? { cursor } : {}) },
      moduleServers,
    );
    const schema = orders.operations["export-page"].output;
    assertSchema(schema, result);
    const page = result as Static<typeof schema>;
    requireCondition(
      page.total <= 100000,
      400,
      "EXPORT_TOO_LARGE",
      "The pilot export limit is 100,000 orders.",
    );
    total ??= page.total;
    requireCondition(
      page.total === total && page.items.length <= 200,
      409,
      "EXPORT_INCONSISTENT",
      "The export query returned inconsistent pagination.",
    );
    for (const row of page.items) {
      requireCondition(
        row.number > lastNumber,
        409,
        "EXPORT_INCONSISTENT",
        "The export query must return distinct orders in number order.",
      );
      lastNumber = row.number;
    }
    count += page.items.length;
    requireCondition(
      count <= total &&
        (!page.nextCursor ||
          (page.items.length > 0 &&
            count < total &&
            page.nextCursor !== cursor)),
      409,
      "EXPORT_INCONSISTENT",
      "The export query did not advance through its complete result.",
    );
    cursor = page.nextCursor ?? undefined;
    yield page.items;
  } while (cursor);
  requireCondition(
    count === total,
    409,
    "EXPORT_INCOMPLETE",
    "The export query omitted orders. Retry after repairing the module.",
  );
}

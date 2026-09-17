import { sql } from "kysely";
import {
  assertSchema,
  hydrateModule,
  type ModuleDefinition,
} from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import { authorize, type Context } from "../identity/authorization";
import type { Tx } from "../persistence/database";
import { found, requireCondition } from "../errors";
import { migrateModuleStorageBatch } from "../persistence/module-migrations";
import {
  resolveWorkspaceRelease,
  workspaceModule,
} from "../registry/module-releases";
import {
  invalidateStorageVersions,
  lockModuleStorage,
  moduleStorageVersions,
} from "../persistence/module-storage";
import type { InstalledModuleServer } from "../runtime/services";
import { audit, iso, publish } from "../persistence/transactions";

const counterId = "00000000-0000-4000-8000-000000000001";
type Versions = { inventory: string; orders: string };
const moduleIds = ["inventory", "orders"] as const;
async function pages<T extends { id: string }>(
  load: (after?: string) => Promise<T[]>,
  visit: (row: T) => Promise<void>,
) {
  let after: string | undefined;
  for (;;) {
    const rows = await load(after);
    for (const row of rows) await visit(row);
    if (rows.length < 200) break;
    after = rows.at(-1)!.id;
  }
}

/** One-time trusted conversion from the host's historical SQL layout. Module code
 * still receives only its public migration capabilities, never relational access.
 * Invoke only in a workspace transaction before taking any shared module lock.
 */
export async function migrateLegacyBusinessStorage(
  tx: Tx,
  initial: Context,
  versions: Versions,
  servers: readonly InstalledModuleServer[],
) {
  await lockModuleStorage(tx, initial.workspaceId, true);
  const ctx = await authorize(
    tx,
    initial.actor,
    initial.workspaceId,
    initial.requestId,
    initial.runtime,
    "modules.manage",
  );
  await sql`savepoint suite_legacy_business_import`.execute(tx);
  try {
    const result = await convert(tx, ctx, versions, servers);
    await sql`release savepoint suite_legacy_business_import`.execute(tx);
    return result;
  } catch (error) {
    try {
      await sql`rollback to savepoint suite_legacy_business_import`.execute(tx);
      await sql`release savepoint suite_legacy_business_import`.execute(tx);
    } catch {
      /* PostgreSQL rolls back a disconnected transaction. */
    }
    invalidateStorageVersions(tx, ctx.workspaceId);
    throw error;
  }
}

async function convert(
  tx: Tx,
  ctx: Context,
  versions: Versions,
  servers: readonly InstalledModuleServer[],
) {
  const ws = ctx.workspaceId;
  const stored = await moduleStorageVersions(tx, ws);
  const prior = await tx
    .selectFrom("suite.platform_settings")
    .select("value")
    .where("workspace_id", "=", ws)
    .where("key", "=", "business-storage-import")
    .executeTakeFirst();
  if (prior?.value.state === "completed") {
    requireCondition(
      canonical(prior.value.versions) === canonical(versions) &&
        moduleIds.every((id) => stored.get(id) === 2),
      409,
      "BUSINESS_MIGRATION_CHANGED",
      "This workspace already completed a different business migration.",
    );
    return prior.value;
  }
  requireCondition(
    !prior && moduleIds.every((id) => (stored.get(id) ?? 1) === 1),
    409,
    "BUSINESS_MIGRATION_STATE",
    "Both business modules must still use schema 1 without a previous import.",
  );
  const existing = await tx
    .selectFrom("suite.module_records")
    .select("id")
    .where("workspace_id", "=", ws)
    .where("module_id", "in", [...moduleIds])
    .limit(1)
    .executeTakeFirst();
  requireCondition(
    !existing,
    409,
    "BUSINESS_IMPORT_NOT_EMPTY",
    "Existing private business records require reconciliation before legacy import.",
  );
  const source = new Map<string, ModuleDefinition>();
  for (const id of moduleIds)
    source.set(id, await workspaceModule(tx, ws, id, ctx.runtime.catalog));
  // Pins, prepared snapshots, migrations and completion are one transaction.
  // Supported older clients cannot continue writing the retained SQL tables.
  for (const id of moduleIds) {
    const value = {
      moduleId: id,
      version: versions[id],
      mandatory: true,
      acceptedVersions: [],
    };
    await tx
      .insertInto("suite.platform_settings")
      .values({ workspace_id: ws, key: `pin:${id}`, value, version: 1 })
      .onConflict((oc) =>
        oc.columns(["workspace_id", "key"]).doUpdateSet((eb) => ({
          value,
          version: eb("suite.platform_settings.version", "+", 1),
        })),
      )
      .execute();
  }
  const targets = new Map<string, ModuleDefinition>();
  for (const id of moduleIds) {
    const plan = await resolveWorkspaceRelease(tx, ws, id, false, versions[id]);
    const definition = hydrateModule(
      found(plan.find((p) => p.module_id === id))
        .artifact as unknown as ModuleDefinition,
    );
    requireCondition(
      definition.storage?.version === 2 &&
        definition.storage.migrations["import-v1"]?.from === 1 &&
        definition.storage.migrations["import-v1"]?.to === 2,
      409,
      "BUSINESS_IMPORT_CONTRACT",
      "Select reviewed schema-2 releases declaring the legacy import.",
    );
    targets.set(id, definition);
  }
  await reconcileLegacyBusiness(tx, ws);
  const counts = {
    products: 0,
    movements: 0,
    counts: 0,
    reservations: 0,
    orders: 0,
    counters: 0,
  };
  const append = async (
    moduleId: "inventory" | "orders",
    name: keyof typeof counts,
    id: string,
    data: Record<string, unknown>,
    creator = ctx.actor.id,
    createdAt = new Date().toISOString(),
  ) => {
    const schema = targets.get(moduleId)!.stores?.[name]?.schema;
    requireCondition(
      schema,
      409,
      "BUSINESS_IMPORT_CONTRACT",
      `The target ${moduleId} release must declare ${name}.`,
    );
    assertSchema(schema, data);
    const resource = `$legacy-${name}`;
    await tx
      .insertInto("suite.module_records")
      .values({
        workspace_id: ws,
        module_id: moduleId,
        resource,
        id,
        data,
        version: 1,
        archived: false,
        created_by: creator,
        updated_at: createdAt,
      })
      .execute();
    await tx
      .insertInto("suite.module_revisions")
      .values({
        workspace_id: ws,
        module_id: moduleId,
        resource,
        record_id: id,
        version: 1,
        data,
      })
      .execute();
    counts[name]++;
  };
  await pages(
    (after) => {
      let q = tx
        .selectFrom("suite.products as p")
        .innerJoin("suite.stock as s", (j) =>
          j
            .onRef("p.workspace_id", "=", "s.workspace_id")
            .onRef("p.id", "=", "s.product_id"),
        )
        .selectAll("p")
        .select(["s.on_hand", "s.reserved", "s.version as stock_version"])
        .where("p.workspace_id", "=", ws)
        .orderBy("p.id")
        .limit(200);
      if (after) q = q.where("p.id", ">", after);
      return q.execute();
    },
    async (p) =>
      append(
        "inventory",
        "products",
        p.id,
        {
          sku: p.sku,
          name: p.name,
          priceMinor: p.price_minor,
          active: p.active,
          productVersion: p.version,
          stockVersion: p.stock_version,
          onHand: p.on_hand,
          reserved: p.reserved,
          available: p.on_hand - p.reserved,
          lowStock: p.active && p.on_hand - p.reserved <= 10,
        },
        ctx.actor.id,
        iso(p.created_at),
      ),
  );
  await pages(
    (after) => {
      let q = tx
        .selectFrom("suite.stock_movements as m")
        .innerJoin("suite.products as p", (j) =>
          j
            .onRef("m.workspace_id", "=", "p.workspace_id")
            .onRef("m.product_id", "=", "p.id"),
        )
        .selectAll("m")
        .select("p.sku")
        .where("m.workspace_id", "=", ws)
        .orderBy("m.id")
        .limit(200);
      if (after) q = q.where("m.id", ">", after);
      return q.execute();
    },
    async (m) =>
      append(
        "inventory",
        "movements",
        m.id,
        {
          productId: m.product_id,
          sku: m.sku,
          kind: m.kind,
          onHandDelta: m.on_hand_delta,
          reservedDelta: m.reserved_delta,
          reason: m.reason,
          actorId: m.actor_id,
          createdAt: iso(m.created_at),
          ...(m.order_id ? { orderId: m.order_id } : {}),
        },
        m.actor_id,
        iso(m.created_at),
      ),
  );
  await pages(
    (after) => {
      let q = tx
        .selectFrom("suite.stock_counts")
        .selectAll()
        .where("workspace_id", "=", ws)
        .orderBy("id")
        .limit(200);
      if (after) q = q.where("id", ">", after);
      return q.execute();
    },
    async (c) =>
      append(
        "inventory",
        "counts",
        c.id,
        {
          productId: c.product_id,
          expectedVersion: c.expected_version,
          previousOnHand: c.previous_on_hand,
          countedOnHand: c.counted_on_hand,
          reason: c.reason,
          actorId: c.actor_id,
          createdAt: iso(c.created_at),
        },
        c.actor_id,
        iso(c.created_at),
      ),
  );
  let highest = 0;
  await pages(
    (after) => {
      let q = tx
        .selectFrom("suite.orders as o")
        .innerJoin("suite.customers as c", (j) =>
          j
            .onRef("o.workspace_id", "=", "c.workspace_id")
            .onRef("o.customer_id", "=", "c.id"),
        )
        .selectAll("o")
        .select("c.name as customer_name")
        .where("o.workspace_id", "=", ws)
        .orderBy("o.id")
        .limit(200);
      if (after) q = q.where("o.id", ">", after);
      return q.execute();
    },
    async (o) => {
      const lines = await tx
        .selectFrom("suite.order_lines")
        .selectAll()
        .where("workspace_id", "=", ws)
        .where("order_id", "=", o.id)
        .orderBy("sku_snapshot")
        .orderBy("product_id")
        .limit(101)
        .execute();
      requireCondition(
        lines.length <= 100,
        409,
        "BUSINESS_ORDER_TOO_LARGE",
        `Order ${o.number} exceeds the supported 100-line contract.`,
      );
      const total = lines.reduce(
        (n, line) => n + line.quantity * line.price_minor,
        0,
      );
      requireCondition(
        Number.isSafeInteger(total) && total === Number(o.total_minor),
        409,
        "BUSINESS_TOTAL_MISMATCH",
        `Order ${o.number} does not match its line totals.`,
      );
      const activity = await tx
        .selectFrom("suite.audit")
        .select(["action", "created_at"])
        .where("workspace_id", "=", ws)
        .where("target_id", "=", o.id)
        .where("action", "in", [
          "orders.created",
          "orders.updated",
          "orders.confirmed",
          "orders.fulfilled",
          "orders.cancelled",
        ])
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(20)
        .execute();
      await append(
        "orders",
        "orders",
        o.id,
        {
          number: o.number,
          orderVersion: o.version,
          customerName: o.customer_name,
          status: o.status,
          totalMinor: total,
          createdAt: iso(o.created_at),
          updatedAt: iso(o.updated_at),
          ...(o.status === "fulfilled"
            ? { fulfilledOn: iso(o.updated_at).slice(0, 10) }
            : {}),
          lines: lines.map((l) => ({
            productId: l.product_id,
            sku: l.sku_snapshot,
            name: l.name_snapshot,
            quantity: l.quantity,
            priceMinor: l.price_minor,
          })),
          activity: activity.map((a) => ({
            action: a.action,
            createdAt: iso(a.created_at),
          })),
        },
        o.created_by,
        iso(o.updated_at),
      );
      const hasReservation = await tx
        .selectFrom("suite.stock_movements")
        .select("id")
        .where("workspace_id", "=", ws)
        .where("order_id", "=", o.id)
        .where("kind", "=", "reservation")
        .limit(1)
        .executeTakeFirst();
      if (hasReservation)
        await append(
          "inventory",
          "reservations",
          o.id,
          {
            sourceModule: "orders",
            state:
              o.status === "confirmed"
                ? "reserved"
                : o.status === "fulfilled"
                  ? "consumed"
                  : "released",
            lines: lines.map((l) => ({
              productId: l.product_id,
              quantity: l.quantity,
            })),
          },
          o.created_by,
          iso(o.updated_at),
        );
      highest = Math.max(highest, o.number);
    },
  );
  const counter = await tx
    .selectFrom("suite.workspaces")
    .select("next_order_number")
    .where("id", "=", ws)
    .executeTakeFirstOrThrow();
  requireCondition(
    counter.next_order_number > highest,
    409,
    "BUSINESS_COUNTER_MISMATCH",
    "The legacy order counter must exceed every existing order number.",
  );
  await append("orders", "counters", counterId, {
    next: counter.next_order_number,
  });
  for (const id of moduleIds)
    await tx
      .insertInto("suite.module_storage")
      .values({
        workspace_id: ws,
        module_id: id,
        schema_version: 1,
        release_version: source.get(id)!.version,
      })
      .onConflict((oc) => oc.columns(["workspace_id", "module_id"]).doNothing())
      .execute();
  invalidateStorageVersions(tx, ws);
  await tx
    .insertInto("suite.platform_settings")
    .values({
      workspace_id: ws,
      key: "business-storage-import",
      value: { state: "prepared", versions, counts },
      version: 1,
    })
    .execute();
  await migrateModuleStorageBatch(
    tx,
    ctx,
    moduleIds.map((moduleId) => ({ moduleId, version: versions[moduleId] })),
    servers,
  );
  const result = { state: "completed", versions, counts };
  await tx
    .updateTable("suite.platform_settings")
    .set({ value: result, version: 2 })
    .where("workspace_id", "=", ws)
    .where("key", "=", "business-storage-import")
    .execute();
  await audit(tx, ctx, "modules.business-storage.migrated", ws);
  await publish(tx, ctx, "module.business-storage.migrated", result);
  return result;
}

/** Fail before importing anything when the source has contradictory commitments. */
export async function reconcileLegacyBusiness(tx: Tx, workspace: string) {
  const check = async (
    code: string,
    query: ReturnType<typeof sql<{ id: string }>>,
    message: string,
  ) => {
    const row = (await query.execute(tx)).rows[0];
    requireCondition(
      !row,
      409,
      code,
      `${message}${row ? ` Record: ${row.id}.` : ""}`,
    );
  };
  await check(
    "BUSINESS_TOTAL_MISMATCH",
    sql<{
      id: string;
    }>`select o.id from suite.orders o left join (select order_id,count(*) as lines,sum(quantity::bigint*price_minor) as total from suite.order_lines where workspace_id=${workspace}::uuid group by order_id) l on l.order_id=o.id where o.workspace_id=${workspace}::uuid and (coalesce(l.lines,0) not between 1 and 100 or o.total_minor<>l.total or l.total>9000000000000) limit 1`,
    "Each order must have 1 to 100 lines and a matching supported total.",
  );
  await check(
    "BUSINESS_COUNTER_MISMATCH",
    sql<{
      id: string;
    }>`select w.id from suite.workspaces w where w.id=${workspace}::uuid and w.next_order_number<=coalesce((select max(number) from suite.orders where workspace_id=w.id),0)`,
    "The order counter must exceed every existing order number.",
  );
  await check(
    "BUSINESS_STOCK_MISMATCH",
    sql<{ id: string }>`
    select p.id from suite.products p left join suite.stock s on s.workspace_id=p.workspace_id and s.product_id=p.id
    left join (select product_id, sum(on_hand_delta) as on_hand, sum(reserved_delta) as reserved from suite.stock_movements where workspace_id=${workspace}::uuid group by product_id) m on m.product_id=p.id
    left join (select l.product_id, sum(l.quantity) as reserved from suite.order_lines l join suite.orders o on o.workspace_id=l.workspace_id and o.id=l.order_id where l.workspace_id=${workspace}::uuid and o.status='confirmed' group by l.product_id) r on r.product_id=p.id
    where p.workspace_id=${workspace}::uuid and (s.product_id is null or s.on_hand<>coalesce(m.on_hand,0) or s.reserved<>coalesce(m.reserved,0) or s.reserved<>coalesce(r.reserved,0)) limit 1`,
    "Stock, movement history and active order reservations must agree.",
  );
  await check(
    "BUSINESS_MOVEMENT_MISMATCH",
    sql<{
      id: string;
    }>`select id from suite.stock_movements where workspace_id=${workspace}::uuid and not (
    (kind='receipt' and order_id is null and on_hand_delta>0 and reserved_delta=0) or
    (kind='adjustment' and order_id is null and on_hand_delta<>0 and reserved_delta=0) or
    (kind='reservation' and order_id is not null and on_hand_delta=0 and reserved_delta>0) or
    (kind='release' and order_id is not null and on_hand_delta=0 and reserved_delta<0) or
    (kind='fulfillment' and order_id is not null and on_hand_delta<0 and reserved_delta=on_hand_delta)) limit 1`,
    "Movement kinds and stock deltas are inconsistent.",
  );
  await check(
    "BUSINESS_RESERVATION_MISMATCH",
    sql<{ id: string }>`
    with effects as (
      select order_id, product_id, count(*) as effects,
        sum(case when kind='reservation' then reserved_delta else 0 end) as reserved,
        sum(case when kind='release' then -reserved_delta else 0 end) as released,
        sum(case when kind='fulfillment' then -reserved_delta else 0 end) as consumed
      from suite.stock_movements where workspace_id=${workspace}::uuid and order_id is not null group by order_id,product_id
    ), pairs as (
      select coalesce(l.order_id,e.order_id) as order_id,l.product_id,l.quantity,e.effects,coalesce(e.reserved,0) as reserved,coalesce(e.released,0) as released,coalesce(e.consumed,0) as consumed
      from (select * from suite.order_lines where workspace_id=${workspace}::uuid) l full join effects e on e.order_id=l.order_id and e.product_id=l.product_id
    ) select o.id from pairs p join suite.orders o on o.id=p.order_id and o.workspace_id=${workspace}::uuid
    where p.product_id is null or not (
      (o.status='draft' and p.effects is null) or
      (o.status='confirmed' and p.reserved=p.quantity and p.released=0 and p.consumed=0) or
      (o.status='fulfilled' and p.reserved=p.quantity and p.released=0 and p.consumed=p.quantity) or
      (o.status='cancelled' and ((p.effects is null and not exists(select 1 from effects e where e.order_id=p.order_id)) or (p.reserved=p.quantity and p.released=p.quantity and p.consumed=0)))) limit 1`,
    "Order states and their individual stock commitments must agree.",
  );
}

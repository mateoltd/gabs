import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { DraftInput, Order } from "@suite/contracts";
import {
  type Tx,
  type Context,
  found,
  requireCondition,
  requireVersion,
  audit,
  publish,
  iso,
  AppError,
  lockWorkspace,
} from "@suite/server-core";
import { applyOrderStock, resolveOrderProducts } from "@suite/inventory/server";
import { transition, validateDraft, type OrderStatus } from "../domain";
export async function getOrder(
  tx: Tx,
  workspaceId: string,
  id: string,
): Promise<
  Order & {
    status: OrderStatus;
    lines: NonNullable<Order["lines"]>;
    activity: NonNullable<Order["activity"]>;
  }
> {
  const order = found(
    await tx
      .selectFrom("suite.orders as o")
      .innerJoin("suite.customers as c", (j) =>
        j
          .onRef("o.customer_id", "=", "c.id")
          .onRef("o.workspace_id", "=", "c.workspace_id"),
      )
      .select([
        "o.id",
        "o.number",
        "o.status",
        "o.version",
        "o.total_minor",
        "o.created_at",
        "c.name",
      ])
      .where("o.workspace_id", "=", workspaceId)
      .where("o.id", "=", id)
      .executeTakeFirst(),
  );
  const lines = await tx
    .selectFrom("suite.order_lines")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .where("order_id", "=", id)
    .orderBy("sku_snapshot")
    .execute();
  const activity = await tx
    .selectFrom("suite.audit")
    .select(["action", "created_at"])
    .where("workspace_id", "=", workspaceId)
    .where("target_id", "=", id)
    .where("action", "in", [
      "orders.created",
      "orders.updated",
      "orders.confirmed",
      "orders.fulfilled",
      "orders.cancelled",
    ])
    .orderBy("created_at", "desc")
    .limit(20)
    .execute();
  return {
    id: order.id,
    number: order.number,
    status: order.status as OrderStatus,
    version: order.version,
    totalMinor: Number(order.total_minor),
    customerName: order.name,
    createdAt: iso(order.created_at),
    activity: activity.map((event) => ({
      action: event.action,
      createdAt: iso(event.created_at),
    })),
    lines: lines.map((l) => ({
      productId: l.product_id,
      quantity: l.quantity,
      priceMinor: l.price_minor,
      sku: l.sku_snapshot,
      name: l.name_snapshot,
    })),
  };
}
async function replaceLines(
  tx: Tx,
  ctx: Context,
  orderId: string,
  input: DraftInput,
) {
  const products = await resolveOrderProducts(
    tx,
    ctx,
    input.lines.map((l) => l.productId),
  );
  await tx
    .deleteFrom("suite.order_lines")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("order_id", "=", orderId)
    .execute();
  await tx
    .insertInto("suite.order_lines")
    .values(
      input.lines.map((l) => {
        const p = products.find((p) => p.id === l.productId)!;
        return {
          id: randomUUID(),
          workspace_id: ctx.workspaceId,
          order_id: orderId,
          product_id: l.productId,
          quantity: l.quantity,
          price_minor: l.priceMinor,
          sku_snapshot: p.sku,
          name_snapshot: p.name,
        };
      }),
    )
    .execute();
}
function draftTotal(input: DraftInput) {
  try {
    return validateDraft(input);
  } catch (e) {
    throw new AppError(400, "INVALID_DRAFT", (e as Error).message);
  }
}
export async function createOrder(tx: Tx, ctx: Context, input: DraftInput) {
  const total = draftTotal(input);
  await lockWorkspace(tx, ctx.workspaceId);
  const workspace = await tx
    .updateTable("suite.workspaces")
    .set((eb) => ({ next_order_number: eb("next_order_number", "+", 1) }))
    .where("id", "=", ctx.workspaceId)
    .returning("next_order_number")
    .executeTakeFirstOrThrow();
  const id = randomUUID(),
    customerId = randomUUID();
  await tx
    .insertInto("suite.customers")
    .values({
      id: customerId,
      workspace_id: ctx.workspaceId,
      name: input.customerName.trim(),
    })
    .execute();
  await tx
    .insertInto("suite.orders")
    .values({
      id,
      workspace_id: ctx.workspaceId,
      number: workspace.next_order_number - 1,
      customer_id: customerId,
      total_minor: total,
      created_by: ctx.actor.id,
    })
    .execute();
  await replaceLines(tx, ctx, id, input);
  await audit(tx, ctx, "orders.created", id);
  return getOrder(tx, ctx.workspaceId, id);
}
export async function editOrder(
  tx: Tx,
  ctx: Context,
  id: string,
  input: DraftInput,
  version?: string,
) {
  const total = draftTotal(input);
  const order = found(
    await tx
      .selectFrom("suite.orders")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst(),
  );
  requireVersion(order.version, version);
  requireCondition(
    order.status === "draft",
    409,
    "INVALID_TRANSITION",
    "Only draft orders can be edited.",
  );
  await tx
    .updateTable("suite.customers")
    .set({ name: input.customerName.trim() })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "=", order.customer_id)
    .execute();
  await replaceLines(tx, ctx, id, input);
  await tx
    .updateTable("suite.orders")
    .set({
      total_minor: total,
      version: order.version + 1,
      updated_at: new Date(),
    })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "=", id)
    .execute();
  await audit(tx, ctx, "orders.updated", id);
  return getOrder(tx, ctx.workspaceId, id);
}
export async function changeOrder(
  tx: Tx,
  ctx: Context,
  id: string,
  action: "confirm" | "fulfill" | "cancel",
  version?: string,
) {
  const order = found(
    await tx
      .selectFrom("suite.orders")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst(),
  );
  requireVersion(order.version, version);
  let status: OrderStatus;
  try {
    status = transition(order.status as OrderStatus, action);
  } catch (e) {
    throw new AppError(409, "INVALID_TRANSITION", (e as Error).message);
  }
  const lines = await tx
    .selectFrom("suite.order_lines")
    .select(["product_id", "quantity"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("order_id", "=", id)
    .execute();
  if (action === "confirm")
    await applyOrderStock(tx, ctx, id, lines, "reservation");
  if (action === "fulfill")
    await applyOrderStock(tx, ctx, id, lines, "fulfillment");
  if (action === "cancel" && order.status === "confirmed")
    await applyOrderStock(tx, ctx, id, lines, "release");
  await tx
    .updateTable("suite.orders")
    .set({ status, version: order.version + 1, updated_at: new Date() })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "=", id)
    .execute();
  await audit(tx, ctx, `orders.${status}`, id);
  await publish(tx, ctx, `orders.${status}`, {
    recordId: id,
    number: order.number,
  });
  return getOrder(tx, ctx.workspaceId, id);
}

export async function listOrders(
  tx: Tx,
  workspaceId: string,
  page: { cursor?: string; search?: string; limit?: number; status?: string },
) {
  let query = tx
    .selectFrom("suite.orders as o")
    .innerJoin("suite.customers as c", (j) =>
      j
        .onRef("o.customer_id", "=", "c.id")
        .onRef("o.workspace_id", "=", "c.workspace_id"),
    )
    .select([
      "o.id",
      "o.number",
      "o.status",
      "o.version",
      "o.total_minor",
      "o.created_at",
      "c.name",
    ])
    .where("o.workspace_id", "=", workspaceId)
    .orderBy("o.id");
  if (page.status) query = query.where("o.status", "=", page.status);
  if (page.cursor) query = query.where("o.id", ">", page.cursor);
  if (page.search) query = query.where("c.name", "ilike", `%${page.search}%`);
  const limit = page.limit ?? 50,
    rows = await query.limit(limit + 1).execute(),
    visible = rows.slice(0, limit);
  const lines = visible.length
    ? await tx
        .selectFrom("suite.order_lines")
        .selectAll()
        .where("workspace_id", "=", workspaceId)
        .where(
          "order_id",
          "in",
          visible.map((o) => o.id),
        )
        .orderBy("sku_snapshot")
        .execute()
    : [];
  const items: Order[] = visible.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status as OrderStatus,
    version: o.version,
    totalMinor: Number(o.total_minor),
    customerName: o.name,
    createdAt: iso(o.created_at),
    lines: lines
      .filter((l) => l.order_id === o.id)
      .map((l) => ({
        productId: l.product_id,
        quantity: l.quantity,
        priceMinor: l.price_minor,
        sku: l.sku_snapshot,
        name: l.name_snapshot,
      })),
  }));
  return { items, nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}
export async function orderExportRows(tx: Tx, workspaceId: string) {
  const rows = await tx
    .selectFrom("suite.orders as o")
    .innerJoin("suite.customers as c", (j) =>
      j
        .onRef("o.customer_id", "=", "c.id")
        .onRef("o.workspace_id", "=", "c.workspace_id"),
    )
    .select(["o.number", "o.status", "o.total_minor", "c.name"])
    .where("o.workspace_id", "=", workspaceId)
    .orderBy("o.number")
    .limit(100001)
    .execute();
  requireCondition(
    rows.length <= 100000,
    400,
    "EXPORT_TOO_LARGE",
    "The pilot export limit is 100,000 orders.",
  );
  return rows;
}

/** Workspace-wide counts and bounded work queues; never derived from a paginated list. */
export async function ordersOverview(tx: Tx, workspaceId: string) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 6 * 86400000);
  const day = sql<string>`to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD')`;
  const daily = await tx
    .selectFrom("suite.orders")
    .select([day.as("date"), tx.fn.countAll<string>().as("count")])
    .where("workspace_id", "=", workspaceId)
    .where("status", "=", "fulfilled")
    .where("updated_at", ">=", start)
    .where("updated_at", "<", new Date(today.getTime() + 86400000))
    .groupBy(day)
    .execute();
  const counts = await tx
    .selectFrom("suite.orders")
    .select(["status", tx.fn.countAll<string>().as("count")])
    .where("workspace_id", "=", workspaceId)
    .groupBy("status")
    .execute();
  const base = tx
    .selectFrom("suite.orders as o")
    .innerJoin("suite.customers as c", (j) =>
      j
        .onRef("o.customer_id", "=", "c.id")
        .onRef("o.workspace_id", "=", "c.workspace_id"),
    )
    .select([
      "o.id",
      "o.number",
      "o.status",
      "o.version",
      "o.total_minor",
      "o.created_at",
      "c.name",
    ])
    .where("o.workspace_id", "=", workspaceId);
  const ready = await base
    .where("o.status", "=", "confirmed")
    .orderBy("o.created_at")
    .orderBy("o.id")
    .limit(5)
    .execute();
  const recent = await base
    .orderBy("o.created_at", "desc")
    .orderBy("o.id", "desc")
    .limit(6)
    .execute();
  const view = (o: (typeof ready)[number]) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    version: o.version,
    totalMinor: Number(o.total_minor),
    customerName: o.name,
    createdAt: iso(o.created_at),
  });
  const count = (status: string) =>
    Number(counts.find((c) => c.status === status)?.count ?? 0);
  return {
    draft: count("draft"),
    confirmed: count("confirmed"),
    fulfilled: count("fulfilled"),
    cancelled: count("cancelled"),
    fulfilledDaily: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start.getTime() + index * 86400000)
        .toISOString()
        .slice(0, 10);
      return {
        date,
        count: Number(daily.find((d) => d.date === date)?.count ?? 0),
      };
    }),
    ready: ready.map(view),
    recent: recent.map(view),
  };
}

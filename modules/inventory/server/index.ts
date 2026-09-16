import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import {
  type Tx,
  type Context,
  found,
  requireCondition,
  audit,
  publish,
  AppError,
  requireVersion,
} from "@suite/server-core";
import { applyStockEffect, type StockEffect } from "../domain";
export async function productView(
  tx: Tx,
  workspaceId: string,
  id: string,
  full = true,
) {
  const p = found(
    await tx
      .selectFrom("suite.products as p")
      .innerJoin("suite.stock as s", (j) =>
        j
          .onRef("p.id", "=", "s.product_id")
          .onRef("p.workspace_id", "=", "s.workspace_id"),
      )
      .select([
        "p.id",
        "p.sku",
        "p.name",
        "p.price_minor",
        "p.active",
        "p.version",
        "s.on_hand",
        "s.version as stock_version",
        "s.reserved",
      ])
      .where("p.workspace_id", "=", workspaceId)
      .where("p.id", "=", id)
      .executeTakeFirst(),
  );
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    priceMinor: p.price_minor,
    active: p.active,
    version: p.version,
    stockVersion: p.stock_version,
    ...(full ? { onHand: p.on_hand, reserved: p.reserved } : {}),
    available: p.on_hand - p.reserved,
  };
}
export async function createProduct(
  tx: Tx,
  ctx: Context,
  input: { sku: string; name: string; priceMinor: number },
) {
  const id = randomUUID();
  await tx
    .insertInto("suite.products")
    .values({
      id,
      workspace_id: ctx.workspaceId,
      sku: input.sku.trim().toUpperCase(),
      name: input.name.trim(),
      price_minor: input.priceMinor,
    })
    .execute();
  await tx
    .insertInto("suite.stock")
    .values({ workspace_id: ctx.workspaceId, product_id: id })
    .execute();
  await audit(tx, ctx, "inventory.product.created", id);
  return productView(tx, ctx.workspaceId, id);
}
export async function editProduct(
  tx: Tx,
  ctx: Context,
  id: string,
  input: { sku: string; name: string; priceMinor: number; active: boolean },
  version?: string,
) {
  const product = found(
    await tx
      .selectFrom("suite.products")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst(),
  );
  requireVersion(product.version, version);
  await tx
    .updateTable("suite.products")
    .set({
      sku: input.sku.trim().toUpperCase(),
      name: input.name.trim(),
      price_minor: input.priceMinor,
      active: input.active,
      version: product.version + 1,
    })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "=", id)
    .execute();
  await audit(tx, ctx, "inventory.product.updated", id);
  return productView(tx, ctx.workspaceId, id);
}
async function move(
  tx: Tx,
  ctx: Context,
  productId: string,
  kind: StockEffect,
  quantity: number,
  reason: string,
  orderId?: string,
) {
  const row = found(
    await tx
      .selectFrom("suite.stock")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("product_id", "=", productId)
      .forUpdate()
      .executeTakeFirst(),
  );
  let next;
  try {
    next = applyStockEffect(
      { onHand: row.on_hand, reserved: row.reserved },
      kind,
      quantity,
    );
  } catch (e) {
    throw new AppError(409, "INSUFFICIENT_STOCK", (e as Error).message);
  }
  await tx
    .updateTable("suite.stock")
    .set({
      on_hand: next.onHand,
      reserved: next.reserved,
      version: row.version + 1,
    })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("product_id", "=", productId)
    .execute();
  await tx
    .insertInto("suite.stock_movements")
    .values({
      id: randomUUID(),
      workspace_id: ctx.workspaceId,
      product_id: productId,
      order_id: orderId ?? null,
      kind,
      on_hand_delta: next.onHand - row.on_hand,
      reserved_delta: next.reserved - row.reserved,
      reason,
      actor_id: ctx.actor.id,
    })
    .execute();
}
export async function changeStock(
  tx: Tx,
  ctx: Context,
  productId: string,
  input: { kind: "receipt" | "adjustment"; quantity: number; reason: string },
) {
  requireCondition(
    input.reason.trim().length >= 3,
    400,
    "REASON_REQUIRED",
    "Enter a reason for this stock change.",
  );
  await move(
    tx,
    ctx,
    productId,
    input.kind,
    input.quantity,
    input.reason.trim(),
  );
  await audit(tx, ctx, `inventory.${input.kind}`, productId);
  await publish(tx, ctx, "inventory.changed", { recordId: productId });
  return productView(tx, ctx.workspaceId, productId);
}
// Orders consumes this business service; repositories and SQL are private to Inventory.
export async function applyOrderStock(
  tx: Tx,
  ctx: Context,
  orderId: string,
  lines: readonly { product_id: string; quantity: number }[],
  kind: "reservation" | "release" | "fulfillment",
) {
  for (const line of [...lines].sort((a, b) =>
    a.product_id.localeCompare(b.product_id),
  )) {
    if (kind === "reservation") {
      const product = found(
        await tx
          .selectFrom("suite.products")
          .select("active")
          .where("workspace_id", "=", ctx.workspaceId)
          .where("id", "=", line.product_id)
          .forShare()
          .executeTakeFirst(),
      );
      requireCondition(
        product.active,
        409,
        "PRODUCT_INACTIVE",
        "A product on this order is no longer active.",
      );
    }
    await move(
      tx,
      ctx,
      line.product_id,
      kind,
      line.quantity,
      `Order ${kind}`,
      orderId,
    );
  }
}
export async function resolveOrderProducts(
  tx: Tx,
  ctx: Context,
  ids: string[],
) {
  const products = await tx
    .selectFrom("suite.products")
    .select(["id", "sku", "name", "active"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "in", ids)
    .orderBy("id")
    .forShare()
    .execute();
  requireCondition(
    products.length === ids.length && products.every((p) => p.active),
    400,
    "PRODUCT_UNAVAILABLE",
    "One or more products are unavailable in this workspace.",
  );
  return products;
}

export async function listProducts(
  tx: Tx,
  ctx: Context,
  page: { cursor?: string; search?: string; limit?: number; stock?: "low" },
) {
  let query = tx
    .selectFrom("suite.products as p")
    .innerJoin("suite.stock as s", (j) =>
      j
        .onRef("p.id", "=", "s.product_id")
        .onRef("p.workspace_id", "=", "s.workspace_id"),
    )
    .select([
      "p.id",
      "p.sku",
      "p.name",
      "p.price_minor",
      "p.active",
      "p.version",
      "s.on_hand",
      "s.version as stock_version",
      "s.reserved",
    ])
    .where("p.workspace_id", "=", ctx.workspaceId)
    .orderBy("p.id");
  if (page.stock === "low")
    query = query
      .where("p.active", "=", true)
      .where(sql<boolean>`s.on_hand - s.reserved <= 10`);
  if (page.cursor) query = query.where("p.id", ">", page.cursor);
  if (page.search)
    query = query.where((eb) =>
      eb.or([
        eb("p.name", "ilike", `%${page.search}%`),
        eb("p.sku", "ilike", `%${page.search}%`),
      ]),
    );
  const limit = page.limit ?? 50,
    rows = await query.limit(limit + 1).execute(),
    full = ctx.permissions.includes("inventory.read");
  return {
    items: rows.slice(0, limit).map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      priceMinor: p.price_minor,
      active: p.active,
      version: p.version,
      stockVersion: p.stock_version,
      ...(full ? { onHand: p.on_hand, reserved: p.reserved } : {}),
      available: p.on_hand - p.reserved,
    })),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}

export async function inventoryOverview(tx: Tx, workspaceId: string) {
  const base = tx
    .selectFrom("suite.products as p")
    .innerJoin("suite.stock as s", (j) =>
      j
        .onRef("p.id", "=", "s.product_id")
        .onRef("p.workspace_id", "=", "s.workspace_id"),
    )
    .where("p.workspace_id", "=", workspaceId)
    .where("p.active", "=", true);
  const totals = await base
    .select([
      sql<string>`count(*)`.as("products"),
      sql<string>`coalesce(sum(s.on_hand - s.reserved), 0)`.as("available"),
      sql<string>`count(*) filter (where s.on_hand - s.reserved <= 10)`.as(
        "lowStock",
      ),
    ])
    .executeTakeFirstOrThrow();
  const lowStockItems = await base
    .select([
      "p.id",
      "p.name",
      "p.sku",
      sql<number>`s.on_hand - s.reserved`.as("available"),
    ])
    .where(sql<boolean>`s.on_hand - s.reserved <= 10`)
    .orderBy("available")
    .orderBy("p.sku")
    .limit(5)
    .execute();
  return {
    products: Number(totals.products),
    available: Number(totals.available),
    lowStock: Number(totals.lowStock),
    lowStockItems,
  };
}

/** A physical count is an observation against a specific stock snapshot, never a blind overwrite. */
export async function countStock(
  tx: Tx,
  ctx: Context,
  input: { id: string; stockVersion: number; counted: number; reason: string },
) {
  requireCondition(
    ctx.permissions.includes("inventory.adjust"),
    403,
    "FORBIDDEN",
    "Your role cannot commit stock counts.",
  );
  requireCondition(
    Number.isSafeInteger(input.counted) &&
      input.counted >= 0 &&
      input.counted <= 1000000000 &&
      input.reason.trim().length >= 3,
    400,
    "INVALID_COUNT",
    "Enter a nonnegative whole-unit count and a reason.",
  );
  const row = found(
    await tx
      .selectFrom("suite.stock")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("product_id", "=", input.id)
      .forUpdate()
      .executeTakeFirst(),
  );
  requireCondition(
    row.version === input.stockVersion,
    412,
    "VERSION_CONFLICT",
    "Stock changed during the count. Reload and recount before committing.",
  );
  requireCondition(
    input.counted >= row.reserved,
    409,
    "RESERVED_STOCK",
    "The count is below reserved stock. Resolve the affected reservations before committing.",
  );
  const countId = randomUUID(),
    delta = input.counted - row.on_hand;
  if (delta)
    await move(
      tx,
      ctx,
      input.id,
      "adjustment",
      delta,
      `Stock count: ${input.reason.trim()}`,
    );
  else
    await tx
      .updateTable("suite.stock")
      .set({ version: row.version + 1 })
      .where("workspace_id", "=", ctx.workspaceId)
      .where("product_id", "=", input.id)
      .execute();
  await tx
    .insertInto("suite.stock_counts")
    .values({
      id: countId,
      workspace_id: ctx.workspaceId,
      product_id: input.id,
      expected_version: input.stockVersion,
      previous_on_hand: row.on_hand,
      counted_on_hand: input.counted,
      reason: input.reason.trim(),
      actor_id: ctx.actor.id,
    })
    .execute();
  await audit(tx, ctx, "inventory.counted", input.id);
  await publish(tx, ctx, "inventory.changed", {
    recordId: input.id,
    countId,
    variance: delta,
  });
  return productView(tx, ctx.workspaceId, input.id);
}

import {
  defineModuleServer,
  type OperationContext,
} from "@suite/module-sdk/server";
import { assertSchema, type Static, type StoreRecord } from "@suite/module-sdk";
import module from "./module";
type Context = OperationContext<typeof module, keyof typeof module.operations>;
type Product = Static<typeof module.stores.products.schema>;
type Row = StoreRecord<Product>;
type Effect = Static<typeof module.stores.movements.schema>["kind"];
const view = (ctx: Context, row: Row) => {
  const p = row.data;
  return {
    id: row.id,
    sku: p.sku,
    name: p.name,
    priceMinor: p.priceMinor,
    active: p.active,
    version: p.productVersion,
    stockVersion: p.stockVersion,
    available: p.available,
    ...(ctx.hasPermission("inventory.read")
      ? { onHand: p.onHand, reserved: p.reserved }
      : {}),
  };
};
async function product(ctx: Context, id: string, lock = false) {
  const row = await ctx.store("products").get(id, { lock });
  if (!row)
    return ctx.reject({
      code: "NOT_FOUND",
      message: "This product is not available in this workspace.",
    });
  return row;
}
async function move(
  ctx: Context,
  productId: string,
  kind: Effect,
  quantity: number,
  reason: string,
  orderId?: string,
) {
  const row = await product(ctx, productId, true),
    previous = row.data;
  if (
    !Number.isSafeInteger(quantity) ||
    !quantity ||
    (kind !== "adjustment" && quantity < 0)
  )
    return ctx.reject({
      code: "INVALID_INPUT",
      message: "Enter a valid whole-unit quantity.",
    });
  if (kind === "reservation" && !previous.active)
    return ctx.reject({
      code: "PRODUCT_INACTIVE",
      message: "A product on this order is no longer active.",
    });
  let onHand = previous.onHand,
    reserved = previous.reserved;
  if (kind === "receipt" || kind === "adjustment") onHand += quantity;
  if (kind === "reservation") reserved += quantity;
  if (kind === "release") reserved -= quantity;
  if (kind === "fulfillment") {
    onHand -= quantity;
    reserved -= quantity;
  }
  if (onHand < 0 || reserved < 0 || reserved > onHand || onHand > 1000000000)
    return ctx.reject({
      code: "INSUFFICIENT_STOCK",
      message: "There is not enough available stock for this operation.",
    });
  const updated = await ctx.store("products").replace(row.id, row.version, {
    ...previous,
    onHand,
    reserved,
    available: onHand - reserved,
    lowStock: previous.active && onHand - reserved <= 10,
    stockVersion: previous.stockVersion + 1,
  });
  await ctx.store("movements").create({
    productId: row.id,
    sku: previous.sku,
    kind,
    onHandDelta: onHand - previous.onHand,
    reservedDelta: reserved - previous.reserved,
    reason,
    actorId: ctx.actor.id,
    createdAt: new Date().toISOString(),
    ...(orderId ? { orderId } : {}),
  });
  await ctx.emit("changed", { recordId: row.id });
  return updated;
}
async function changeStock(
  ctx: Context,
  input: { id: string; quantity: number; reason: string },
  kind: "receipt" | "adjustment",
) {
  if (input.reason.trim().length < 3)
    return ctx.reject({
      code: "INVALID_INPUT",
      message: "Enter a reason for this stock change.",
    });
  const row = await move(
    ctx,
    input.id,
    kind,
    input.quantity,
    input.reason.trim(),
  );
  await ctx.audit(kind, row.id);
  return view(ctx, row);
}
async function finish(
  ctx: Context,
  referenceId: string,
  state: "released" | "consumed",
) {
  const reservations = ctx.store("reservations"),
    row = await reservations.get(referenceId, { lock: true });
  if (
    !row ||
    row.data.sourceModule !== ctx.caller?.moduleId ||
    row.data.state !== "reserved"
  )
    return ctx.reject({
      code: "RESERVATION_CONFLICT",
      message: "This caller has no active reservation for this reference.",
    });
  for (const line of [...row.data.lines].sort((a, b) =>
    a.productId.localeCompare(b.productId),
  ))
    await move(
      ctx,
      line.productId,
      state === "released" ? "release" : "fulfillment",
      line.quantity,
      `Order ${state === "released" ? "release" : "fulfillment"}`,
      row.id,
    );
  await reservations.replace(row.id, row.version, { ...row.data, state });
  await ctx.audit(state, row.id);
  return { state };
}
export default defineModuleServer(module)(
  {
    "create-product": async (ctx, input) => {
      if (!input.sku.trim() || !input.name.trim())
        return ctx.reject({
          code: "INVALID_INPUT",
          message: "Enter a SKU and product name.",
        });
      const row = await ctx.store("products").create({
        ...input,
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        active: true,
        productVersion: 1,
        stockVersion: 1,
        onHand: 0,
        reserved: 0,
        available: 0,
        lowStock: true,
      });
      await ctx.audit("product.created", row.id);
      return view(ctx, row);
    },
    "edit-product": async (ctx, input) => {
      const row = await product(ctx, input.id, true);
      if (row.data.productVersion !== input.version)
        return ctx.reject({
          code: "VERSION_CONFLICT",
          message: "This product changed. Reload before editing it.",
        });
      if (!input.sku.trim() || !input.name.trim())
        return ctx.reject({
          code: "INVALID_INPUT",
          message: "Enter a SKU and product name.",
        });
      const updated = await ctx.store("products").replace(row.id, row.version, {
        ...row.data,
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        priceMinor: input.priceMinor,
        active: input.active,
        lowStock: input.active && row.data.available <= 10,
        productVersion: row.data.productVersion + 1,
      });
      await ctx.audit("product.updated", row.id);
      return view(ctx, updated);
    },
    get: async (ctx, input) => view(ctx, await product(ctx, input.id)),
    products: async (ctx, input) => {
      const page = await ctx.store("products").query({
        cursor: input.cursor,
        ...(input.search?.trim()
          ? { search: { fields: ["sku", "name"], text: input.search.trim() } }
          : {}),
        limit: input.limit,
        ...(input.stock ? { where: { lowStock: true } } : {}),
      });
      return {
        items: page.items.map((row) => view(ctx, row)),
        nextCursor: page.next,
      };
    },
    overview: async (ctx) => {
      const store = ctx.store("products");
      const totals = await store.aggregate({
        where: { active: true },
        sum: ["available"],
        groupBy: "lowStock",
      });
      const low = await store.query({
        where: { active: true, lowStock: true },
        orderBy: [
          { field: "available", direction: "asc" },
          { field: "sku", direction: "asc" },
        ],
        limit: 5,
      });
      return {
        products: totals.count,
        available: totals.sums.available,
        lowStock: totals.groups.find((g) => g.key === true)?.count ?? 0,
        lowStockItems: low.items.map((row) => ({
          id: row.id,
          name: row.data.name,
          sku: row.data.sku,
          available: row.data.available,
        })),
      };
    },
    movements: async (ctx, input) => {
      const page = await ctx.store("movements").query({
        cursor: input.cursor,
        limit: input.limit,
        ...(input.productId
          ? { where: { productId: input.productId.toLowerCase() } }
          : {}),
        ...(input.search?.trim()
          ? {
              search: {
                fields: ["sku", "reason"],
                text: input.search.trim(),
              },
            }
          : {}),
        orderBy: [{ field: "createdAt", direction: "desc" }],
      });
      return {
        items: page.items.map((row) => ({ id: row.id, ...row.data })),
        nextCursor: page.next,
      };
    },
    receipt: (ctx, input) => changeStock(ctx, input, "receipt"),
    adjustment: (ctx, input) => changeStock(ctx, input, "adjustment"),
    count: async (ctx, input) => {
      const row = await product(ctx, input.id, true);
      if (input.reason.trim().length < 3)
        return ctx.reject({
          code: "INVALID_INPUT",
          message: "Enter a reason for this count.",
        });
      if (row.data.stockVersion !== input.stockVersion)
        return ctx.reject({
          code: "VERSION_CONFLICT",
          message: "Stock changed during the count. Reload and recount.",
        });
      if (input.counted < row.data.reserved)
        return ctx.reject({
          code: "RESERVED_STOCK",
          message:
            "Resolve reservations before counting stock below reserved units.",
        });
      const delta = input.counted - row.data.onHand;
      const updated = delta
        ? await move(
            ctx,
            row.id,
            "adjustment",
            delta,
            `Stock count: ${input.reason.trim()}`,
          )
        : await ctx.store("products").replace(row.id, row.version, {
            ...row.data,
            stockVersion: row.data.stockVersion + 1,
          });
      const count = await ctx.store("counts").create({
        productId: row.id,
        expectedVersion: input.stockVersion,
        previousOnHand: row.data.onHand,
        countedOnHand: input.counted,
        reason: input.reason.trim(),
        actorId: ctx.actor.id,
        createdAt: new Date().toISOString(),
      });
      await ctx.audit("counted", row.id);
      await ctx.emit("counted", {
        recordId: row.id,
        countId: count.id,
        variance: delta,
      });
      return view(ctx, updated);
    },
    "resolve-products": async (ctx, input) => {
      const ids = input.ids.map((id) => id.toLowerCase()).sort();
      if (new Set(ids).size !== ids.length)
        return ctx.reject({
          code: "INVALID_INPUT",
          message: "Combine duplicate product lines.",
        });
      const rows = [];
      for (const id of ids) {
        const row = await product(ctx, id, true);
        if (!row.data.active)
          return ctx.reject({
            code: "PRODUCT_INACTIVE",
            message: "This product is no longer active.",
          });
        rows.push({ id: row.id, sku: row.data.sku, name: row.data.name });
      }
      return rows;
    },
    reserve: async (ctx, input) => {
      const store = ctx.store("reservations");
      if (await store.get(input.referenceId, { lock: true }))
        return ctx.reject({
          code: "RESERVATION_CONFLICT",
          message: "This reference already has a reservation history.",
        });
      const lines = input.lines
        .map((line) => ({ ...line, productId: line.productId.toLowerCase() }))
        .sort((a, b) => a.productId.localeCompare(b.productId));
      if (new Set(lines.map((line) => line.productId)).size !== lines.length)
        return ctx.reject({
          code: "INVALID_INPUT",
          message: "Combine duplicate product lines.",
        });
      for (const line of lines)
        await move(
          ctx,
          line.productId,
          "reservation",
          line.quantity,
          "Order reservation",
          input.referenceId,
        );
      await store.create(
        { sourceModule: ctx.caller!.moduleId, state: "reserved", lines },
        { id: input.referenceId },
      );
      await ctx.audit("reserved", input.referenceId);
      return { state: "reserved" };
    },
    release: async (ctx, input) => {
      await finish(ctx, input.referenceId, "released");
      return { state: "released" };
    },
    consume: async (ctx, input) => {
      await finish(ctx, input.referenceId, "consumed");
      return { state: "consumed" };
    },
  },
  {
    "import-v1": async (ctx) => {
      for (const name of [
        "products",
        "movements",
        "counts",
        "reservations",
      ] as const) {
        let cursor: string | undefined;
        do {
          const page = await ctx.store(`legacy-${name}`).scan(cursor);
          for (const row of page.items) {
            assertSchema(module.stores[name].schema, row.data);
            if (name === "products") {
              assertSchema(module.stores.products.schema, row.data);
              const p = row.data;
              if (
                p.reserved > p.onHand ||
                p.available !== p.onHand - p.reserved ||
                p.lowStock !== (p.active && p.available <= 10)
              )
                throw Error("Imported product balances are inconsistent.");
            }
            if (name === "reservations") {
              assertSchema(module.stores.reservations.schema, row.data);
              if (
                new Set(
                  row.data.lines.map((line) => line.productId.toLowerCase()),
                ).size !== row.data.lines.length
              )
                throw Error(
                  "Imported reservation contains duplicate products.",
                );
            }
            const created = await ctx.store(name).create(row.data, row.id);
            if (row.archived)
              await ctx.store(name).archive(created.id, created.version);
            await ctx.store(`legacy-${name}`).archive(row.id, row.version);
          }
          cursor = page.next ?? undefined;
        } while (cursor);
      }
    },
  },
);

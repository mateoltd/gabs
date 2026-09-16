import {
  defineModuleServer,
  type OperationContext,
} from "@suite/module-sdk/server";
import { assertSchema, type Static, type StoreRecord } from "@suite/module-sdk";
import module, { draft } from "./module";
type Context = OperationContext<typeof module, keyof typeof module.operations>;
type Data = Static<typeof module.stores.orders.schema>;
const counterId = "00000000-0000-4000-8000-000000000001";
const view = (row: StoreRecord<Data>) => {
  const { orderVersion, fulfilledOn: _fulfilledOn, ...data } = row.data;
  return { id: row.id, version: orderVersion, ...data };
};
function validateDraft(ctx: Context, input: Static<typeof draft>) {
  const lines = input.lines.map((line) => ({
    ...line,
    productId: line.productId.toLowerCase(),
  }));
  const totalMinor = lines.reduce(
    (total, line) => total + line.quantity * line.priceMinor,
    0,
  );
  if (
    !input.customerName.trim() ||
    new Set(lines.map((line) => line.productId)).size !== lines.length ||
    !Number.isSafeInteger(totalMinor) ||
    totalMinor > 9000000000000
  )
    return ctx.reject({
      code: "INVALID_DRAFT",
      message:
        "Enter a customer and distinct product lines within the supported total.",
    });
  return { customerName: input.customerName.trim(), lines, totalMinor };
}
async function resolveDraft(ctx: Context, input: Static<typeof draft>) {
  const valid = validateDraft(ctx, input);
  const products = await ctx.serviceAttempt("products", {
    ids: valid.lines.map((line) => line.productId),
  });
  if (!products.ok)
    return ctx.reject({
      code: "STOCK_REJECTED",
      message: products.error.message,
      stock: products.error,
    });
  return {
    ...valid,
    lines: valid.lines
      .map((line) => {
        const product = products.value.find((p) => p.id === line.productId);
        if (!product)
          throw Error("The product service returned an incomplete snapshot.");
        return { ...line, sku: product.sku, name: product.name };
      })
      .sort(
        (a, b) =>
          a.sku.localeCompare(b.sku) || a.productId.localeCompare(b.productId),
      ),
  };
}
async function get(ctx: Context, id: string, version?: number) {
  const row = await ctx
    .store("orders")
    .get(id, { lock: version !== undefined });
  if (!row)
    return ctx.reject({
      code: "NOT_FOUND",
      message: "This order is not available in this workspace.",
    });
  if (version !== undefined && row.data.orderVersion !== version)
    return ctx.reject({
      code: "VERSION_CONFLICT",
      message: "This order changed. Reload it before continuing.",
    });
  return row;
}
const activity = (
  previous: Data["activity"],
  action: string,
  createdAt: string,
) => [{ action: `orders.${action}`, createdAt }, ...previous].slice(0, 20);
async function transition(
  ctx: Context,
  input: { id: string; version: number },
  action: "confirm" | "fulfill" | "cancel",
) {
  const row = await get(ctx, input.id, input.version);
  const status = row.data.status;
  if (
    !(action === "confirm" && status === "draft") &&
    !(action === "fulfill" && status === "confirmed") &&
    !(action === "cancel" && (status === "draft" || status === "confirmed"))
  )
    return ctx.reject({
      code: "INVALID_TRANSITION",
      message: `Cannot ${action} an order that is ${status}.`,
    });
  if (action === "confirm") {
    const result = await ctx.serviceAttempt("reserve", {
      referenceId: row.id,
      lines: row.data.lines.map(({ productId, quantity }) => ({
        productId,
        quantity,
      })),
    });
    if (!result.ok)
      return ctx.reject({
        code: "STOCK_REJECTED",
        message: result.error.message,
        stock: result.error,
      });
  } else if (status === "confirmed") {
    const result =
      action === "fulfill"
        ? await ctx.serviceAttempt("consume", { referenceId: row.id })
        : await ctx.serviceAttempt("release", { referenceId: row.id });
    if (!result.ok)
      return ctx.reject({
        code: "STOCK_REJECTED",
        message: result.error.message,
        stock: result.error,
      });
  }
  const next =
    action === "confirm"
      ? "confirmed"
      : action === "fulfill"
        ? "fulfilled"
        : "cancelled";
  const now = new Date().toISOString();
  const updated = await ctx.store("orders").replace(row.id, row.version, {
    ...row.data,
    orderVersion: row.data.orderVersion + 1,
    status: next,
    ...(next === "fulfilled" ? { fulfilledOn: now.slice(0, 10) } : {}),
    updatedAt: now,
    activity: activity(row.data.activity, next, now),
  });
  await ctx.audit(next, row.id);
  await ctx.emit(next, { recordId: row.id, number: row.data.number });
  return view(updated);
}
export default defineModuleServer(module)(
  {
    draft: async (ctx, input) => {
      // All drafts acquire the sequence before product snapshots; a first-use
      // logical lock protects this absent counter as well as existing values.
      const counters = ctx.store("counters");
      const counter = await counters.get(counterId, { lock: true });
      const number = counter?.data.next ?? 1;
      if (number > 2147483646)
        return ctx.reject({
          code: "NUMBER_EXHAUSTED",
          message: "This workspace has exhausted its supported order numbers.",
        });
      const details = await resolveDraft(ctx, input);
      if (counter)
        await counters.replace(counter.id, counter.version, {
          next: number + 1,
        });
      else await counters.create({ next: number + 1 }, { id: counterId });
      const now = new Date().toISOString();
      const row = await ctx.store("orders").create({
        ...details,
        number,
        orderVersion: 1,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        activity: activity([], "created", now),
      });
      await ctx.audit("created", row.id);
      return view(row);
    },
    edit: async (ctx, input) => {
      const row = await get(ctx, input.id, input.version);
      if (row.data.status !== "draft")
        return ctx.reject({
          code: "INVALID_TRANSITION",
          message: "Only draft orders can be edited.",
        });
      const details = await resolveDraft(ctx, input),
        now = new Date().toISOString();
      const updated = await ctx.store("orders").replace(row.id, row.version, {
        ...row.data,
        ...details,
        orderVersion: row.data.orderVersion + 1,
        updatedAt: now,
        activity: activity(row.data.activity, "updated", now),
      });
      await ctx.audit("updated", row.id);
      return view(updated);
    },
    confirm: (ctx, input) => transition(ctx, input, "confirm"),
    fulfill: (ctx, input) => transition(ctx, input, "fulfill"),
    cancel: (ctx, input) => transition(ctx, input, "cancel"),
    get: async (ctx, input) => view(await get(ctx, input.id)),
    overview: async (ctx) => {
      const store = ctx.store("orders");
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const start = new Date(today.getTime() - 6 * 86400000);
      const totals = await store.aggregate({ groupBy: "status" });
      const daily = await store.aggregate({
        where: { status: "fulfilled" },
        ranges: {
          fulfilledOn: {
            gte: start.toISOString().slice(0, 10),
            lte: today.toISOString().slice(0, 10),
          },
        },
        groupBy: "fulfilledOn",
      });
      const ready = await store.query({
        where: { status: "confirmed" },
        orderBy: [{ field: "createdAt", direction: "asc" }],
        limit: 5,
      });
      const recent = await store.query({
        orderBy: [{ field: "createdAt", direction: "desc" }],
        limit: 6,
      });
      const count = (status: Data["status"]) =>
        totals.groups.find((g) => g.key === status)?.count ?? 0;
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
            count: daily.groups.find((g) => g.key === date)?.count ?? 0,
          };
        }),
        ready: ready.items.map(view),
        recent: recent.items.map(view),
      };
    },
    "export-page": async (ctx, input) => {
      const store = ctx.store("orders");
      const total = await store.aggregate();
      const page = await store.query({
        cursor: input.cursor,
        limit: input.limit,
        orderBy: [{ field: "number", direction: "asc" }],
      });
      return {
        total: total.count,
        items: page.items.map(({ data }) => ({
          number: data.number,
          customerName: data.customerName,
          status: data.status,
          totalMinor: data.totalMinor,
        })),
        nextCursor: page.next,
      };
    },
    list: async (ctx, input) => {
      const page = await ctx.store("orders").query({
        cursor: input.cursor,
        ...(input.search?.trim()
          ? { search: { fields: ["customerName"], text: input.search.trim() } }
          : {}),
        limit: input.limit,
        ...(input.status ? { where: { status: input.status } } : {}),
      });
      return { items: page.items.map(view), nextCursor: page.next };
    },
  },
  {
    "import-v1": async (ctx) => {
      let highest = 0,
        importedCounter = false;
      for (const name of ["orders", "counters"] as const) {
        let cursor: string | undefined;
        do {
          const page = await ctx.store(`legacy-${name}`).scan(cursor);
          for (const row of page.items) {
            assertSchema(module.stores[name].schema, row.data);
            if (name === "orders") {
              assertSchema(module.stores.orders.schema, row.data);
              const total = row.data.lines.reduce(
                (sum, line) => sum + line.quantity * line.priceMinor,
                0,
              );
              if (
                total !== row.data.totalMinor ||
                new Set(
                  row.data.lines.map((line) => line.productId.toLowerCase()),
                ).size !== row.data.lines.length
              )
                throw Error("Imported order lines and total are inconsistent.");
              if (row.data.status === "fulfilled") {
                const date = new Date(row.data.updatedAt);
                if (!Number.isFinite(date.getTime()))
                  throw Error("Imported fulfillment date is invalid.");
                row.data.fulfilledOn = date.toISOString().slice(0, 10);
              }
              highest = Math.max(highest, row.data.number);
            } else {
              assertSchema(module.stores.counters.schema, row.data);
              importedCounter = true;
              if (
                row.id !== counterId ||
                row.archived ||
                row.data.next <= highest
              )
                throw Error("Imported order counter is inconsistent.");
            }
            const created = await ctx.store(name).create(row.data, row.id);
            if (row.archived)
              await ctx.store(name).archive(created.id, created.version);
            await ctx.store(`legacy-${name}`).archive(row.id, row.version);
          }
          cursor = page.next ?? undefined;
        } while (cursor);
      }
      if (highest && !importedCounter)
        throw Error("Imported orders require their authoritative counter.");
    },
  },
);

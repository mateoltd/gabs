import { expect, it } from "vitest";
import {
  defineModule,
  operation,
  resource,
  store,
  field,
  serviceReference,
  Type,
} from "@suite/module-sdk";
import { defineModuleServer } from "@suite/module-sdk/server";
import {
  createModuleSimulator,
  defineSimulationModule,
  grantSimulationServices,
} from "@suite/module-sdk/simulator";
import orders from "../../modules/orders/releases/2.0.0/module";
import ordersServer from "../../modules/orders/releases/2.0.0/module-server";
import inventory from "../../modules/inventory/releases/2.0.0/module";
import inventoryServer from "../../modules/inventory/releases/2.0.0/module-server";

const productId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const inventoryFixture = defineSimulationModule(inventory, {
  server: inventoryServer,
  stores: {
    products: [
      {
        id: productId,
        data: {
          sku: "DESK",
          name: "Office desk",
          priceMinor: 20000,
          active: true,
          productVersion: 1,
          stockVersion: 1,
          onHand: 5,
          reserved: 0,
          available: 5,
          lowStock: true,
        },
      },
    ],
  },
});
const grants = grantSimulationServices(
  orders,
  "products",
  "reserve",
  "release",
  "consume",
);
const business = () =>
  createModuleSimulator(orders, {
    server: ordersServer,
    providers: [inventoryFixture],
    grants,
  });
const draft = {
  customerName: "Customer",
  lines: [{ productId, quantity: 3, priceMinor: 20000 }],
};

it("runs actual scoped Orders and Inventory handlers with atomic cross-module effects and retry receipts", async () => {
  const simulation = business();
  const first = await simulation.client.call("draft", draft),
    second = await simulation.client.call("draft", draft);
  const key = crypto.randomUUID();
  const results = await Promise.all([
    simulation.client.attempt(
      "confirm",
      { id: first.id, version: first.version },
      key,
    ),
    simulation.client.attempt("confirm", {
      id: second.id,
      version: second.version,
    }),
  ]);
  expect(results[0]).toMatchObject({
    ok: true,
    value: { status: "confirmed" },
  });
  expect(results[1]).toMatchObject({
    ok: false,
    error: { code: "STOCK_REJECTED", stock: { code: "INSUFFICIENT_STOCK" } },
  });
  expect(simulation.inspect(inventory).stores.products[0].data).toMatchObject({
    onHand: 5,
    reserved: 3,
    available: 2,
  });
  const accepted = simulation.snapshot();
  await simulation.client.call(
    "confirm",
    { id: first.id, version: first.version },
    key,
  );
  expect(simulation.snapshot()).toEqual(accepted);
  const fulfillmentKey = crypto.randomUUID();
  const fulfilled = await simulation.client.call(
    "fulfill",
    { id: first.id, version: first.version + 1 },
    fulfillmentKey,
  );
  expect(fulfilled.status).toBe("fulfilled");
  expect(simulation.inspect(inventory).stores.products[0].data).toMatchObject({
    onHand: 2,
    reserved: 0,
    available: 2,
  });
  expect(
    simulation.inspect(inventory).stores.reservations[0].data,
  ).toMatchObject({ sourceModule: "orders", state: "consumed" });
  expect(simulation.inspect(inventory).stores.movements).toHaveLength(2);
  const audits = simulation
    .snapshot()
    .audits.filter((entry) => entry.requestId === fulfillmentKey);
  expect(new Set(audits.map((entry) => entry.moduleId))).toEqual(
    new Set(["orders", "inventory"]),
  );
  expect(
    audits.every(
      (entry) =>
        entry.actorId === simulation.snapshot().scope.userId &&
        entry.workspaceId === simulation.snapshot().scope.workspaceId,
    ),
  ).toBe(true);
  expect(
    simulation
      .snapshot()
      .events.some(
        (event) => event.moduleId === "orders" && event.name === "fulfilled",
      ),
  ).toBe(true);
});

it("rechecks service grants and provider permissions and rejects direct or incompatible provider access", async () => {
  const simulation = business();
  const order = await simulation.client.call("draft", draft);
  simulation.setGrants(grantSimulationServices(orders, "products"));
  const before = simulation.snapshot();
  await expect(
    simulation.client.call("confirm", { id: order.id, version: order.version }),
  ).rejects.toMatchObject({ code: "GRANT_REQUIRED" });
  expect(simulation.snapshot()).toEqual(before);
  simulation.setGrants(grants);
  simulation.setModulePermissions("inventory", ["inventory.read"]);
  await expect(
    simulation.client.call("confirm", { id: order.id, version: order.version }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    simulation.send({
      moduleId: "inventory",
      action: "operation",
      operation: "reserve",
      input: {},
    }),
  ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  const provider = createModuleSimulator(inventory, {
    server: inventoryServer,
  });
  await expect(
    provider.client.call("reserve", {
      referenceId: crypto.randomUUID(),
      lines: draft.lines.map(({ productId, quantity }) => ({
        productId,
        quantity,
      })),
    }),
  ).rejects.toMatchObject({ code: "SERVICE_ONLY" });
  const absent = createModuleSimulator(orders, { server: ordersServer });
  await expect(absent.client.call("draft", draft)).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
  expect(absent.inspect(orders).stores.orders).toEqual([]);
});

const provider = defineModule({
  id: "fixture-provider",
  name: "Provider",
  description: "Simulation provider",
  version: "1.0.0",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  permissions: [
    "fixture-provider.write",
    "fixture-provider.items.read",
    "fixture-provider.items.write",
  ],
  configuration: Type.Object({}),
  resources: { items: resource({ name: field.text() }, { title: "Items" }) },
  stores: { records: store({ name: field.text() }, { unique: ["name"] }) },
  audit: ["saved"],
  events: { saved: Type.String() },
  operations: {
    write: operation({
      title: "Write",
      permission: "fixture-provider.write",
      policy: "online",
      public: true,
      serviceOnly: true,
      input: Type.Object({ fail: Type.Boolean() }),
      output: Type.Boolean(),
      errors: Type.Literal("declined"),
    }),
  },
});
const providerServer = defineModuleServer(provider)({
  write: async (ctx, input) => {
    await ctx.store("records").create({ name: "Provider write" });
    await ctx.resource("items").create({ name: "Public record" });
    await ctx.emit("saved", ctx.caller!.moduleId);
    await ctx.audit("saved", ctx.requestId);
    if (input.fail) return ctx.reject("declined");
    return true;
  },
});
const consumer = defineModule({
  id: "fixture-consumer",
  name: "Consumer",
  description: "Simulation consumer",
  version: "1.0.0",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: { "fixture-provider": "^1.0.0" },
  permissions: ["fixture-consumer.run"],
  configuration: Type.Object({}),
  resources: {},
  stores: { records: store({ name: field.text() }) },
  services: { write: serviceReference(provider, "write") },
  operations: {
    run: operation({
      title: "Run",
      permission: "fixture-consumer.run",
      policy: "online",
      input: Type.Object({
        mode: Type.Union([
          Type.Literal("caught"),
          Type.Literal("detached"),
          Type.Literal("translated"),
          Type.Literal("success"),
        ]),
      }),
      output: Type.Boolean(),
      errors: Type.Literal("translated"),
    }),
  },
});
const consumerServer = defineModuleServer(consumer)({
  run: async (ctx, input) => {
    await ctx.store("records").create({ name: "Consumer write" });
    if (input.mode === "detached") void ctx.service("write", { fail: true });
    else {
      const result = await ctx.serviceAttempt("write", {
        fail: input.mode !== "success",
      });
      if (!result.ok && input.mode === "translated")
        return ctx.reject("translated");
    }
    return true;
  },
});
const integrated = () =>
  createModuleSimulator(consumer, {
    server: consumerServer,
    providers: [defineSimulationModule(provider, { server: providerServer })],
    grants: grantSimulationServices(consumer, "write"),
  });
it("rolls back caught and detached child failures and preserves explicitly translated business errors", async () => {
  for (const mode of ["caught", "detached", "translated"] as const) {
    const simulation = integrated(),
      before = simulation.snapshot();
    if (mode === "translated")
      expect(await simulation.client.attempt("run", { mode })).toEqual({
        ok: false,
        error: "translated",
      });
    else
      await expect(simulation.client.call("run", { mode })).rejects.toThrow(
        "dependent service rejected",
      );
    expect(simulation.snapshot()).toEqual(before);
    expect(await simulation.client.call("run", { mode: "success" })).toBe(true);
    expect(simulation.inspect(provider).stores.records).toHaveLength(1);
    expect(simulation.inspect(consumer).stores.records).toHaveLength(1);
    expect(simulation.snapshot().events[0]).toMatchObject({
      moduleId: provider.id,
      payload: consumer.id,
    });
  }
});

it("rejects version/contract mismatches and validates typed fixture data and grant aliases", async () => {
  const incompatible = { ...provider, version: "2.0.0" };
  const simulator = createModuleSimulator(consumer, {
    server: consumerServer,
    providers: [defineSimulationModule(incompatible)],
    grants: grantSimulationServices(consumer, "write"),
  });
  await expect(
    simulator.client.call("run", { mode: "success" }),
  ).rejects.toMatchObject({ code: "SERVICE_INCOMPATIBLE" });
  const changed = {
    ...provider,
    operations: {
      write: { ...provider.operations.write, output: Type.String() },
    },
  };
  const drift = createModuleSimulator(consumer, {
    server: consumerServer,
    providers: [defineSimulationModule(changed)],
    grants: grantSimulationServices(consumer, "write"),
  });
  await expect(
    drift.client.call("run", { mode: "success" }),
  ).rejects.toMatchObject({ code: "SERVICE_CONTRACT_MISMATCH" });
  expect(() =>
    defineSimulationModule(provider, {
      records: { items: [{ id: "invalid", data: { name: "Example" } }] },
    }),
  ).toThrow("Fixture fixture-provider.items[0]");
  if (false) {
    // @ts-expect-error Only declared service aliases may be granted.
    grantSimulationServices(consumer, "unknown");
    // @ts-expect-error A module without service declarations cannot grant arbitrary aliases.
    grantSimulationServices(provider, "write");
    defineSimulationModule(provider, {
      stores: {
        records: [
          {
            id: productId,
            data: {
              // @ts-expect-error Private fixture fields retain their schema types.
              name: 12,
            },
          },
        ],
      },
    });
    const inspect = integrated().inspect(provider);
    // @ts-expect-error Provider records retain their actual field types.
    const incorrect: number = inspect.stores.records[0].data.name;
    void incorrect;
  }
});

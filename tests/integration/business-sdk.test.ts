import { provisionLegacyWorkspace as provisionWorkspace } from "../fixtures/legacy-workspace";
import {
  reviewBusinessCutover,
  applyBusinessCutover,
} from "../../packages/server/src/governance/business-cutover";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createModuleClient,
  defineModule,
  hydrateModule,
  operation,
  serviceReference,
  Type,
  type ModuleCall,
} from "@suite/module-sdk";
import { defineModuleServer } from "@suite/module-sdk/server";
import { registerModule } from "@suite/module-catalog";
import { moduleServers } from "@suite/module-catalog/server";
import legacyOrders from "../../modules/orders/releases/1.1.0/module";
import legacyInventory from "../../modules/inventory/releases/1.2.0/module";
import { migrateLegacyBusinessStorage } from "../../packages/server/src/governance/legacy-business-migration";
import { sql } from "kysely";
import ordersCandidate from "../../modules/orders/releases/2.0.0/module";
import { serviceContractSource } from "../../packages/sdk/node/service-contracts";
import candidate from "../../modules/inventory/releases/2.0.0/module";
import { buildServerPackage } from "../../packages/sdk/node/build-server";
import { signPackage } from "../../packages/sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  stageRelease,
  publishRelease,
} from "../../tooling/modules/registry-review";
import {
  connectDatabase,
  identify,
  inWorkspace,
  authorize,
  type Actor,
} from "../../composition/src/server/product";
import { migrateModuleStorage } from "../../packages/server/src/persistence/module-migrations";
import { createApp } from "../../apps/api/src/app";
import { orderExportPages } from "../../apps/worker/src/order-export";
import { runBatch } from "../../apps/worker/src/worker";

// Exercise the actual signed candidate source. A unique prerelease plus workspace pins
// keeps this test from selecting a candidate for any existing company or other test.
const version = `2.0.0-acceptance.${randomUUID().slice(0, 8)}`;
const inventory = hydrateModule(
  JSON.parse(JSON.stringify({ ...candidate, version })),
) as typeof candidate;
const ordersDefinition = hydrateModule(
  JSON.parse(
    JSON.stringify({
      ...ordersCandidate,
      version,
      dependencies: { inventory: version },
      services: Object.fromEntries(
        Object.entries(ordersCandidate.services).map(([key, service]) => [
          key,
          { ...service, version },
        ]),
      ),
    }),
  ),
) as typeof ordersCandidate;
const actions = ["reserve", "release", "consume", "resolve-products"] as const;
function consumer(id: string) {
  return defineModule({
    id,
    name: "Inventory service acceptance",
    version: "1.0.0",
    description: "Explicitly granted stock consumer",
    host: "^1.0.0",
    backend: "^1.0.0",
    publisher: "suite",
    dependencies: { inventory: version },
    permissions: [`${id}.run`],
    configuration: Type.Object({}),
    resources: {},
    services: {
      reserve: serviceReference(inventory, "reserve"),
      release: serviceReference(inventory, "release"),
      consume: serviceReference(inventory, "consume"),
      resolve: serviceReference(inventory, "resolve-products"),
    },
    operations: {
      reserve: operation({
        title: "Reserve",
        policy: "online",
        permission: `${id}.run`,
        input: inventory.operations.reserve.input,
        output: inventory.operations.reserve.output,
      }),
      release: operation({
        title: "Release",
        policy: "online",
        permission: `${id}.run`,
        input: inventory.operations.release.input,
        output: inventory.operations.release.output,
      }),
      consume: operation({
        title: "Consume",
        policy: "online",
        permission: `${id}.run`,
        input: inventory.operations.consume.input,
        output: inventory.operations.consume.output,
      }),
      resolve: operation({
        title: "Resolve",
        policy: "online",
        permission: `${id}.run`,
        input: inventory.operations["resolve-products"].input,
        output: inventory.operations["resolve-products"].output,
      }),
      rollback: operation({
        title: "Reject after reservation",
        policy: "online",
        permission: `${id}.run`,
        input: inventory.operations.reserve.input,
        output: Type.Boolean(),
        errors: Type.Literal("cancelled"),
      }),
    },
  });
}
const first = consumer(`stock-consumer-${randomUUID().slice(0, 8)}`);
const second = consumer(`other-consumer-${randomUUID().slice(0, 8)}`);
const servers = [first, second].map((module) =>
  defineModuleServer(module)({
    reserve: (ctx, input) => ctx.service("reserve", input),
    release: (ctx, input) => ctx.service("release", input),
    consume: (ctx, input) => ctx.service("consume", input),
    resolve: (ctx, input) => ctx.service("resolve", input),
    rollback: async (ctx, input) => {
      await ctx.service("reserve", input);
      return ctx.reject("cancelled");
    },
  }),
);
const db = connectDatabase();
const worker = connectDatabase(
  process.env.DATABASE_URL!.replace("suite_app:", "suite_worker:"),
);
const registry = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  options: "-c role=suite_registry",
});
const workspace = randomUUID(),
  foreign = randomUUID();
let app: Awaited<ReturnType<typeof createApp>>;
let headers: Record<string, string>, directory: string;
let authenticatedActor: Actor;
beforeAll(async () => {
  directory = await mkdtemp(resolve(".local/inventory-sdk-"));
  const source = resolve("modules/inventory/releases/2.0.0");
  await writeFile(
    resolve(directory, "module.ts"),
    (await readFile(resolve(source, "module.ts"), "utf8")).replace(
      'version: "2.0.0"',
      `version: "${version}"`,
    ),
  );
  await writeFile(
    resolve(directory, "module-server.ts"),
    await readFile(resolve(source, "module-server.ts")),
  );
  const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
  const privateKey = await readFile(`${keys}/private.pem`, "utf8");
  const publicKey = await readFile(`${keys}/public.pem`, "utf8");
  const server = await buildServerPackage(inventory, directory, privateKey);
  const submission = await submitRelease(
    registry,
    signPackage(inventory, privateKey),
    server,
    publicKey,
  );
  await reviewRelease(
    registry,
    submission,
    "approved",
    "Actual Inventory SDK candidate acceptance",
    publicKey,
  );
  await stageRelease(registry, submission, publicKey);
  await publishRelease(registry, submission, publicKey);
  const ordersDirectory = resolve(directory, "orders");
  await mkdir(ordersDirectory);
  const ordersSource = resolve("modules/orders/releases/2.0.0");
  await writeFile(
    resolve(ordersDirectory, "module.ts"),
    (await readFile(resolve(ordersSource, "module.ts"), "utf8"))
      .replace('version: "2.0.0"', `version: "${version}"`)
      .replace('inventory: "^2.0.0"', `inventory: "${version}"`),
  );
  await writeFile(
    resolve(ordersDirectory, "module-server.ts"),
    await readFile(resolve(ordersSource, "module-server.ts")),
  );
  await writeFile(
    resolve(ordersDirectory, "inventory-services.ts"),
    serviceContractSource(inventory),
  );
  const ordersServer = await buildServerPackage(
    ordersDefinition,
    ordersDirectory,
    privateKey,
  );
  const ordersSubmission = await submitRelease(
    registry,
    signPackage(ordersDefinition, privateKey),
    ordersServer,
    publicKey,
  );
  await reviewRelease(
    registry,
    ordersSubmission,
    "approved",
    "Actual Orders SDK candidate acceptance",
    publicKey,
  );
  await stageRelease(registry, ordersSubmission, publicKey);
  await publishRelease(registry, ordersSubmission, publicKey);
  for (const module of [first, second]) registerModule(module);
  moduleServers.push(...servers);
  app = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
  const actor = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    name: "Inventory SDK owner",
    email: `${randomUUID()}@test.local`,
    emailVerified: true,
  });
  for (const id of [workspace, foreign])
    await inWorkspace(db, id, async (tx) => {
      await provisionWorkspace(tx, {
        id,
        userId: actor.id,
        name: "Inventory SDK",
        kind: "company",
        modules: ["inventory", "orders", first.id, second.id],
      });
      await tx
        .insertInto("suite.module_storage")
        .values({
          workspace_id: id,
          module_id: "inventory",
          schema_version: 2,
          release_version: version,
        })
        .execute();
      await tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: id,
          key: "pin:inventory",
          value: { version },
          version: 1,
        })
        .execute();
      await tx
        .insertInto("suite.module_storage")
        .values({
          workspace_id: id,
          module_id: "orders",
          schema_version: 2,
          release_version: version,
        })
        .execute();
      await tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: id,
          key: "pin:orders",
          value: { version },
          version: 1,
        })
        .execute();
      await tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: id,
          key: "grant:orders:inventory",
          value: { services: [...actions] },
          version: 1,
        })
        .execute();
      const role = await tx
        .selectFrom("suite.roles")
        .select(["id", "permissions"])
        .where("workspace_id", "=", id)
        .where("name", "=", "Owner")
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("suite.roles")
        .set({
          permissions: [
            ...new Set([
              ...role.permissions,
              ...candidate.permissions,
              ...ordersCandidate.permissions,
              ...first.permissions,
              ...second.permissions,
            ]),
          ],
        })
        .where("workspace_id", "=", id)
        .where("id", "=", role.id)
        .execute();
      for (const module of [first, second])
        await tx
          .insertInto("suite.platform_settings")
          .values({
            workspace_id: id,
            key: `grant:${module.id}:inventory`,
            value: { services: [...actions] },
            version: 1,
          })
          .execute();
    });
  const session = await app.auth.issue(actor.id, true);
  authenticatedActor = await app.auth.session(session.token);
  headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
});
afterAll(async () => {
  for (const server of servers) {
    const index = moduleServers.indexOf(server);
    if (index >= 0) moduleServers.splice(index, 1);
  }
  if (app) await app.app.close();
  await db.destroy();
  await worker.destroy();
  await registry.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const send =
  (target = workspace) =>
  async (call: ModuleCall) => {
    const response = await app.app.inject({
      method: "POST",
      url: `/api/v1/module/${call.moduleId}/workspaces/${target}/${call.kind === "query" ? "queries" : "operations"}/${call.operation}`,
      headers: {
        ...headers,
        ...(call.key ? { "idempotency-key": call.key } : {}),
        ...(call.moduleVersion
          ? { "x-module-version": call.moduleVersion }
          : {}),
      },
      payload: call.input as object,
    });
    if (response.statusCode !== 200)
      throw Object.assign(new Error(response.json().message), response.json(), {
        status: response.statusCode,
      });
    return response.json();
  };
const businessOrders = () => createModuleClient(ordersDefinition, send());

async function legacyFixture() {
  const target = randomUUID();
  await inWorkspace(db, target, (tx) =>
    provisionWorkspace(tx, {
      id: target,
      userId: authenticatedActor.id,
      name: "Legacy conversion",
      kind: "company",
      modules: ["inventory", "orders"],
    }),
  );
  const stock = createModuleClient(legacyInventory, send(target));
  const orders = createModuleClient(legacyOrders, send(target));
  let product = await stock.call("create-product", {
    sku: "LEGACY",
    name: "Historical product",
    priceMinor: 200,
  });
  product = await stock.call("stock", {
    id: product.id,
    kind: "receipt",
    quantity: 50,
    reason: "Opening receipt",
  });
  const input = {
    customerName: "Historical customer",
    lines: [{ productId: product.id, quantity: 2, priceMinor: 200 }],
  };
  const draft = await orders.call("draft", input);
  const key = randomUUID();
  const confirmInput = { id: draft.id, version: draft.version };
  const confirmed = await orders.call("confirm", confirmInput, key);
  return {
    target,
    stock,
    orders,
    product,
    input,
    confirmed,
    key,
    confirmInput,
  };
}
async function convertLegacy(target: string) {
  return inWorkspace(db, target, async (tx) => {
    const ctx = await authorize(
      tx,
      authenticatedActor,
      target,
      randomUUID(),
      "modules.manage",
    );
    return migrateLegacyBusinessStorage(
      tx,
      ctx,
      { inventory: version, orders: version },
      moduleServers,
    );
  });
}
async function conversionState(target: string) {
  return inWorkspace(db, target, async (tx) => ({
    storage: await tx
      .selectFrom("suite.module_storage")
      .selectAll()
      .where("workspace_id", "=", target)
      .orderBy("module_id")
      .execute(),
    records: await tx
      .selectFrom("suite.module_records")
      .selectAll()
      .where("workspace_id", "=", target)
      .orderBy("module_id")
      .orderBy("resource")
      .orderBy("id")
      .execute(),
    revisions: await tx
      .selectFrom("suite.module_revisions")
      .selectAll()
      .where("workspace_id", "=", target)
      .orderBy("module_id")
      .orderBy("resource")
      .orderBy("record_id")
      .orderBy("version")
      .execute(),
    migrations: await tx
      .selectFrom("suite.module_migrations")
      .selectAll()
      .where("workspace_id", "=", target)
      .orderBy("module_id")
      .execute(),
    settings: await tx
      .selectFrom("suite.platform_settings")
      .selectAll()
      .where("workspace_id", "=", target)
      .orderBy("key")
      .execute(),
    audits: await tx
      .selectFrom("suite.audit")
      .selectAll()
      .where("workspace_id", "=", target)
      .orderBy("id")
      .execute(),
    events: await tx
      .selectFrom("suite.outbox")
      .selectAll()
      .where("workspace_id", "=", target)
      .orderBy("id")
      .execute(),
    receipts: await tx
      .selectFrom("suite.idempotency")
      .selectAll()
      .where("workspace_id", "=", target)
      .orderBy("key")
      .execute(),
  }));
}

it("atomically converts authoritative legacy commitments, preserves identities/history/retries, and resumes through the public SDK", async () => {
  const f = await legacyFixture();
  const initialProduct = await f.stock.call("count", {
    id: f.product.id,
    stockVersion: f.product.stockVersion + 1,
    counted: 49,
    reason: "Physical count",
  });
  const draft = await f.orders.call("draft", f.input);
  let fulfilled = await f.orders.call("draft", f.input);
  fulfilled = await f.orders.call("confirm", {
    id: fulfilled.id,
    version: fulfilled.version,
  });
  fulfilled = await f.orders.call("fulfill", {
    id: fulfilled.id,
    version: fulfilled.version,
  });
  let cancelled = await f.orders.call("draft", f.input);
  cancelled = await f.orders.call("confirm", {
    id: cancelled.id,
    version: cancelled.version,
  });
  cancelled = await f.orders.call("cancel", {
    id: cancelled.id,
    version: cancelled.version,
  });
  const draftCancel = await f.orders.call("draft", f.input);
  await f.orders.call("cancel", {
    id: draftCancel.id,
    version: draftCancel.version,
  });
  // Explicit authority/grants are provisioned independently of data conversion.
  await inWorkspace(db, f.target, async (tx) => {
    const roles = await tx
      .selectFrom("suite.roles")
      .select(["id", "permissions"])
      .where("workspace_id", "=", f.target)
      .where("protected", "=", true)
      .execute();
    for (const role of roles)
      await tx
        .updateTable("suite.roles")
        .set({
          permissions: [
            ...new Set([...role.permissions, ...inventory.permissions]),
          ],
        })
        .where("workspace_id", "=", f.target)
        .where("id", "=", role.id)
        .execute();
    await tx
      .insertInto("suite.platform_settings")
      .values({
        workspace_id: f.target,
        key: "grant:orders:inventory",
        value: { services: [...actions] },
        version: 1,
      })
      .execute();
  });
  const foreignBefore = await snapshots();
  const sourceBefore = await inWorkspace(db, f.target, async (tx) => ({
    products: await tx
      .selectFrom("suite.products")
      .selectAll()
      .where("workspace_id", "=", f.target)
      .execute(),
    orders: await tx
      .selectFrom("suite.orders")
      .selectAll()
      .where("workspace_id", "=", f.target)
      .orderBy("id")
      .execute(),
    movements: await tx
      .selectFrom("suite.stock_movements")
      .selectAll()
      .where("workspace_id", "=", f.target)
      .orderBy("id")
      .execute(),
  }));
  const results = await Promise.all([
    convertLegacy(f.target.toUpperCase()),
    convertLegacy(f.target),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    state: "completed",
    counts: { products: 1, orders: 5, reservations: 3, counts: 1, counters: 1 },
  });
  const snapshot = await conversionState(f.target);
  expect(snapshot.migrations).toHaveLength(2);
  expect(snapshot.storage.every((r) => r.schema_version === 2)).toBe(true);
  expect(
    snapshot.audits.filter(
      (r) => r.action === "modules.business-storage.migrated",
    ),
  ).toHaveLength(1);
  expect(
    snapshot.records
      .filter((r) => r.resource.startsWith("$legacy-"))
      .every((r) => r.archived),
  ).toBe(true);
  const orders = createModuleClient(ordersDefinition, send(f.target));
  const stock = createModuleClient(inventory, send(f.target));
  expect(await orders.call("get", { id: f.confirmed.id })).toMatchObject(
    f.confirmed,
  );
  expect(await orders.call("get", { id: fulfilled.id })).toMatchObject(
    fulfilled,
  );
  expect(await orders.call("get", { id: cancelled.id })).toMatchObject(
    cancelled,
  );
  expect(await stock.call("get", { id: f.product.id })).toMatchObject({
    onHand: 47,
    reserved: 2,
    available: 45,
    version: initialProduct.version,
  });
  expect(await f.orders.call("confirm", f.confirmInput, f.key)).toEqual(
    f.confirmed,
  );
  expect(await conversionState(f.target)).toEqual(snapshot);
  await orders.call("fulfill", {
    id: f.confirmed.id,
    version: f.confirmed.version,
  });
  expect(await stock.call("get", { id: f.product.id })).toMatchObject({
    onHand: 45,
    reserved: 0,
    available: 45,
  });
  expect(await orders.call("draft", f.input)).toMatchObject({
    number: f.confirmed.number + 5,
  });
  const read = async (path: string, target = f.target) => {
    const response = await app.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${target}/${path}`,
      headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    return response.json();
  };
  const overview = await read("overview");
  expect(overview.orders).toMatchObject({
    draft: 2,
    confirmed: 0,
    fulfilled: 2,
    cancelled: 2,
  });
  expect(overview.inventory).toEqual(await stock.call("overview", {}));
  expect(await read(`orders/${f.confirmed.id}`)).toMatchObject({
    status: "fulfilled",
    version: f.confirmed.version + 1,
  });
  const page = await read("orders?limit=2");
  expect(page.items).toHaveLength(2);
  expect(page.nextCursor.length).toBeGreaterThan(36);
  const next = await read(
    `orders?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`,
  );
  expect(next.items).toHaveLength(2);
  expect(
    next.items.every(
      (row: { id: string }) =>
        !page.items.some((prior: { id: string }) => prior.id === row.id),
    ),
  ).toBe(true);
  const rejectedCursor = await app.app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${foreign}/orders?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`,
    headers,
  });
  expect(rejectedCursor.statusCode).toBe(400);
  expect((await read("products")).items).toContainEqual(
    expect.objectContaining({ id: f.product.id, onHand: 45, reserved: 0 }),
  );
  expect(
    (await read("movements")).items.filter(
      (m: { kind: string }) => m.kind === "fulfillment",
    ),
  ).toHaveLength(2);
  await expect(
    f.orders.call("confirm", { id: draft.id, version: draft.version }),
  ).rejects.toMatchObject({ code: "MODULE_UPDATE_REQUIRED" });
  const sourceAfter = await inWorkspace(db, f.target, async (tx) => ({
    products: await tx
      .selectFrom("suite.products")
      .selectAll()
      .where("workspace_id", "=", f.target)
      .execute(),
    orders: await tx
      .selectFrom("suite.orders")
      .selectAll()
      .where("workspace_id", "=", f.target)
      .orderBy("id")
      .execute(),
    movements: await tx
      .selectFrom("suite.stock_movements")
      .selectAll()
      .where("workspace_id", "=", f.target)
      .orderBy("id")
      .execute(),
  }));
  expect(sourceAfter).toEqual(sourceBefore);
  expect(await snapshots()).toEqual(foreignBefore);
  await expect(
    inWorkspace(db, f.target, (tx) =>
      tx
        .updateTable("suite.stock")
        .set({ on_hand: 48 })
        .where("workspace_id", "=", f.target)
        .execute(),
    ),
  ).rejects.toMatchObject({ code: "55000" });
  await expect(
    inWorkspace(db, f.target, (tx) =>
      tx
        .updateTable("suite.workspaces")
        .set({ next_order_number: 50 })
        .where("id", "=", f.target)
        .execute(),
    ),
  ).rejects.toMatchObject({ code: "55000" });
});

it("rejects contradictory balances, totals, and counters without leaving prepared data or target pins", async () => {
  const f = await legacyFixture();
  await expect(
    inWorkspace(db, f.target, async (tx) =>
      migrateModuleStorage(
        tx,
        await authorize(
          tx,
          authenticatedActor,
          f.target,
          randomUUID(),
          "modules.manage",
        ),
        "inventory",
        version,
        moduleServers,
      ),
    ),
  ).rejects.toMatchObject({ code: "BUSINESS_MIGRATION_REQUIRED" });
  for (const fault of ["balance", "total", "counter"] as const) {
    await inWorkspace(db, f.target, async (tx) => {
      if (fault === "balance")
        await tx
          .updateTable("suite.stock")
          .set({ on_hand: 51 })
          .where("workspace_id", "=", f.target)
          .execute();
      if (fault === "total")
        await tx
          .updateTable("suite.orders")
          .set({ total_minor: 1 })
          .where("workspace_id", "=", f.target)
          .execute();
      if (fault === "counter")
        await tx
          .updateTable("suite.workspaces")
          .set({ next_order_number: 1 })
          .where("id", "=", f.target)
          .execute();
    });
    const before = await conversionState(f.target);
    await expect(convertLegacy(f.target)).rejects.toMatchObject({
      code:
        fault === "balance"
          ? "BUSINESS_STOCK_MISMATCH"
          : fault === "total"
            ? "BUSINESS_TOTAL_MISMATCH"
            : "BUSINESS_COUNTER_MISMATCH",
    });
    expect(await conversionState(f.target)).toEqual(before);
    await inWorkspace(db, f.target, async (tx) => {
      await tx
        .updateTable("suite.stock")
        .set({ on_hand: 50 })
        .where("workspace_id", "=", f.target)
        .execute();
      await tx
        .updateTable("suite.orders")
        .set({ total_minor: 400 })
        .where("workspace_id", "=", f.target)
        .execute();
      await tx
        .updateTable("suite.workspaces")
        .set({ next_order_number: f.confirmed.number + 1 })
        .where("id", "=", f.target)
        .execute();
    });
  }
  expect(await convertLegacy(f.target)).toMatchObject({ state: "completed" });
});

it("rolls back both modules when the second migration fails, even if its caller catches the error", async () => {
  const f = await legacyFixture();
  await inWorkspace(db, f.target, (tx) =>
    tx
      .updateTable("suite.entitlements")
      .set({ active: false })
      .where("workspace_id", "=", f.target)
      .where("module_id", "=", "orders")
      .execute(),
  );
  const before = await conversionState(f.target);
  await inWorkspace(db, f.target, async (tx) => {
    const ctx = await authorize(
      tx,
      authenticatedActor,
      f.target,
      randomUUID(),
      "modules.manage",
    );
    await expect(
      migrateLegacyBusinessStorage(
        tx,
        ctx,
        { inventory: version, orders: version },
        moduleServers,
      ),
    ).rejects.toMatchObject({ code: "NOT_ENTITLED" });
    // The transaction can continue; the outer migration savepoint removed all partial work.
    await sql`select 1`.execute(tx);
  });
  expect(await conversionState(f.target)).toEqual(before);
  await inWorkspace(db, f.target, (tx) =>
    tx
      .updateTable("suite.entitlements")
      .set({ active: true })
      .where("workspace_id", "=", f.target)
      .where("module_id", "=", "orders")
      .execute(),
  );
  expect(await convertLegacy(f.target)).toMatchObject({ state: "completed" });
});

it("checks individual order reservations even when aggregate stock still balances", async () => {
  const f = await legacyFixture();
  const draft = await f.orders.call("draft", f.input);
  await f.orders.call("confirm", { id: draft.id, version: draft.version });
  await inWorkspace(db, f.target, async (tx) => {
    for (const [id, quantity] of [
      [f.confirmed.id, 3],
      [draft.id, 1],
    ] as const) {
      await tx
        .updateTable("suite.order_lines")
        .set({ quantity })
        .where("workspace_id", "=", f.target)
        .where("order_id", "=", id)
        .execute();
      await tx
        .updateTable("suite.orders")
        .set({ total_minor: quantity * 200 })
        .where("workspace_id", "=", f.target)
        .where("id", "=", id)
        .execute();
    }
  });
  const before = await conversionState(f.target);
  await expect(convertLegacy(f.target)).rejects.toMatchObject({
    code: "BUSINESS_RESERVATION_MISMATCH",
  });
  expect(await conversionState(f.target)).toEqual(before);
  // Restore this intentionally invalid fixture so restore drills retain meaningful invariants.
  await inWorkspace(db, f.target, async (tx) => {
    await tx
      .updateTable("suite.order_lines")
      .set({ quantity: 2 })
      .where("workspace_id", "=", f.target)
      .execute();
    await tx
      .updateTable("suite.orders")
      .set({ total_minor: 400 })
      .where("workspace_id", "=", f.target)
      .execute();
  });
});

it("converts all pages of legacy products and movements without touching another workspace", async () => {
  const f = await legacyFixture();
  const ids = Array.from({ length: 205 }, () => randomUUID());
  await inWorkspace(db, f.target, async (tx) => {
    await tx
      .insertInto("suite.products")
      .values(
        ids.map((id, index) => ({
          id,
          workspace_id: f.target,
          sku: `BULK-${index}`,
          name: `Product ${index}`,
          price_minor: index,
        })),
      )
      .execute();
    await tx
      .insertInto("suite.stock")
      .values(
        ids.map((product_id) => ({
          workspace_id: f.target,
          product_id,
          on_hand: 10,
          version: 2,
        })),
      )
      .execute();
    await tx
      .insertInto("suite.stock_movements")
      .values(
        ids.map((product_id) => ({
          id: randomUUID(),
          workspace_id: f.target,
          product_id,
          kind: "receipt",
          on_hand_delta: 10,
          reserved_delta: 0,
          reason: "Opening receipt",
          actor_id: authenticatedActor.id,
        })),
      )
      .execute();
  });
  const result = await convertLegacy(f.target);
  expect(result).toMatchObject({ counts: { products: 206, movements: 207 } });
  const migrated = await conversionState(f.target);
  expect(
    migrated.records.filter((r) => r.resource === "$products"),
  ).toHaveLength(206);
  expect(
    migrated.records.filter((r) => r.resource === "$movements"),
  ).toHaveLength(207);
  const stock = createModuleClient(inventory, send(f.target));
  expect(await stock.call("get", { id: ids.at(-1)! })).toMatchObject({
    onHand: 10,
    reserved: 0,
  });
}, 60000);

it("fences a legacy SQL write already waiting at cutover and rejects stale transaction isolation", async () => {
  const f = await legacyFixture();
  let unlock!: () => void, locked!: () => void, started!: (pid: number) => void;
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const writerReady = new Promise<number>((resolve) => {
    started = resolve;
  });
  const migration = inWorkspace(db, f.target, async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`module-storage:${f.target}`},0))`.execute(
      tx,
    );
    locked();
    await gate;
    const ctx = await authorize(
      tx,
      authenticatedActor,
      f.target,
      randomUUID(),
      "modules.manage",
    );
    return migrateLegacyBusinessStorage(
      tx,
      ctx,
      { inventory: version, orders: version },
      moduleServers,
    );
  });
  await ready;
  const writer = inWorkspace(db, f.target, async (tx) => {
    started(
      (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx))
        .rows[0].pid,
    );
    await tx
      .updateTable("suite.products")
      .set({ name: "Stale writer" })
      .where("workspace_id", "=", f.target)
      .execute();
  });
  const rejected = expect(writer).rejects.toMatchObject({ code: "55000" });
  try {
    const pid = await writerReady;
    await expect
      .poll(
        async () =>
          (
            await sql<{
              blocked: boolean;
            }>`select cardinality(pg_blocking_pids(${pid}))>0 as blocked`.execute(
              db,
            )
          ).rows[0].blocked,
      )
      .toBe(true);
  } finally {
    unlock();
  }
  await migration;
  await rejected;
  expect(
    await createModuleClient(inventory, send(f.target)).call("get", {
      id: f.product.id,
    }),
  ).toMatchObject({ name: "Historical product" });
  await expect(
    db
      .transaction()
      .setIsolationLevel("repeatable read")
      .execute(async (tx) => {
        await sql`select set_config('app.workspace_id',${f.target},true)`.execute(
          tx,
        );
        await tx
          .updateTable("suite.products")
          .set({ name: "Stale snapshot" })
          .where("workspace_id", "=", f.target)
          .execute();
      }),
  ).rejects.toMatchObject({ code: "55000" });
});
const stock = () => createModuleClient(inventory, send());
const orders = () => createModuleClient(first, send());
async function product(units = 10) {
  const created = await stock().call("create-product", {
    sku: `SKU-${randomUUID()}`,
    name: "SDK product",
    priceMinor: 1800,
  });
  return stock().call("receipt", {
    id: created.id,
    quantity: units,
    reason: "Supplier delivery",
  });
}
const snapshots = () =>
  inWorkspace(db, workspace, async (tx) => ({
    records: await tx
      .selectFrom("suite.module_records")
      .selectAll()
      .where("workspace_id", "=", workspace)
      .orderBy("module_id")
      .orderBy("resource")
      .orderBy("id")
      .execute(),
    audits: await tx
      .selectFrom("suite.audit")
      .selectAll()
      .where("workspace_id", "=", workspace)
      .orderBy("id")
      .execute(),
    outbox: await tx
      .selectFrom("suite.outbox")
      .selectAll()
      .where("workspace_id", "=", workspace)
      .orderBy("id")
      .execute(),
    receipts: await tx
      .selectFrom("suite.idempotency")
      .selectAll()
      .where("workspace_id", "=", workspace)
      .orderBy("key")
      .execute(),
  }));
it("rejects direct stock-service requests even from an administrator", async () => {
  const p = await product();
  const before = await snapshots();
  await expect(
    stock().call("reserve", {
      referenceId: randomUUID(),
      lines: [{ productId: p.id, quantity: 4 }],
    }),
  ).rejects.toMatchObject({ code: "SERVICE_ONLY", status: 403 });
  await expect(
    stock().call("resolve-products", { ids: [p.id] }),
  ).rejects.toMatchObject({ code: "SERVICE_ONLY" });
  expect(await snapshots()).toEqual(before);
});
it("cannot oversell under concurrent reservations and retries cannot duplicate fulfillment effects", async () => {
  const p = await product();
  const references = [randomUUID(), randomUUID()];
  const input = references.map((referenceId) => ({
    referenceId,
    lines: [{ productId: p.id, quantity: 7 }],
  }));
  const result = await Promise.allSettled(
    input.map((body) => orders().call("reserve", body)),
  );
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await stock().call("get", { id: p.id })).toMatchObject({
    onHand: 10,
    reserved: 7,
    available: 3,
  });
  const referenceId =
    references[result.findIndex((r) => r.status === "fulfilled")];
  const key = randomUUID();
  expect(await orders().call("consume", { referenceId }, key)).toEqual({
    state: "consumed",
  });
  const once = await snapshots();
  expect(await orders().call("consume", { referenceId }, key)).toEqual({
    state: "consumed",
  });
  expect(await snapshots()).toEqual(once);
  expect(await stock().call("get", { id: p.id })).toMatchObject({
    onHand: 3,
    reserved: 0,
    available: 3,
  });
  const completed = await snapshots();
  await expect(orders().call("consume", { referenceId })).rejects.toThrow();
  expect(await snapshots()).toEqual(completed);
  expect(
    completed.audits.filter(
      (a) => a.action === "inventory.consumed" && a.target_id === referenceId,
    ),
  ).toHaveLength(1);
});
it("rolls back partial multi-product reservations and a rejected caller together with audits and events", async () => {
  const products = (await Promise.all([product(), product()])).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const lines = products.map((p, i) => ({
    productId: p.id,
    quantity: i ? 11 : 4,
  }));
  const before = await snapshots();
  await expect(
    orders().call("reserve", { referenceId: randomUUID(), lines }),
  ).rejects.toThrow();
  expect(await snapshots()).toEqual(before);
  expect(
    await orders().attempt("rollback", {
      referenceId: randomUUID(),
      lines: [{ productId: products[0].id, quantity: 4 }],
    }),
  ).toEqual({ ok: false, error: "cancelled" });
  expect(await snapshots()).toEqual(before);
});
it("binds reservations to the actual calling module, rechecks grants, and isolates workspaces", async () => {
  const p = await product(),
    referenceId = randomUUID();
  await orders().call("reserve", {
    referenceId,
    lines: [{ productId: p.id, quantity: 4 }],
  });
  const before = await snapshots();
  await expect(
    createModuleClient(second, send()).call("release", { referenceId }),
  ).rejects.toThrow();
  expect(await snapshots()).toEqual(before);
  expect(
    await createModuleClient(inventory, send(foreign)).attempt("get", {
      id: p.id,
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.platform_settings")
      .set({ value: { services: [] } })
      .where("workspace_id", "=", workspace)
      .where("key", "=", `grant:${first.id}:inventory`)
      .execute(),
  );
  await expect(orders().call("release", { referenceId })).rejects.toMatchObject(
    { code: "GRANT_REQUIRED" },
  );
  expect(await snapshots()).toEqual(before);
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.platform_settings")
      .set({ value: { services: [...actions] } })
      .where("workspace_id", "=", workspace)
      .where("key", "=", `grant:${first.id}:inventory`)
      .execute(),
  );
  await orders().call("release", { referenceId });
  expect(await stock().call("get", { id: p.id })).toMatchObject({
    onHand: 10,
    reserved: 0,
    available: 10,
  });
});
it("keeps count and product versions independent and rejects stale or reservation-breaking counts", async () => {
  const p = await product(),
    referenceId = randomUUID();
  const edited = await stock().call("edit-product", {
    id: p.id,
    version: p.version,
    sku: p.sku,
    name: "Renamed",
    priceMinor: p.priceMinor,
    active: true,
  });
  expect(edited).toMatchObject({
    version: p.version + 1,
    stockVersion: p.stockVersion,
  });
  await orders().call("reserve", {
    referenceId,
    lines: [{ productId: p.id, quantity: 6 }],
  });
  expect(
    await stock().attempt("count", {
      id: p.id,
      stockVersion: p.stockVersion,
      counted: 10,
      reason: "Counted shelf",
    }),
  ).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
  const current = await stock().call("get", { id: p.id });
  expect(
    await stock().attempt("count", {
      id: p.id,
      stockVersion: current.stockVersion,
      counted: 5,
      reason: "Counted shelf",
    }),
  ).toMatchObject({ ok: false, error: { code: "RESERVED_STOCK" } });
  const key = randomUUID();
  const input = {
    id: p.id,
    stockVersion: current.stockVersion,
    counted: 8,
    reason: "x".repeat(500),
  };
  expect(await stock().call("count", input, key)).toMatchObject({
    version: edited.version,
    stockVersion: current.stockVersion + 1,
    onHand: 8,
    reserved: 6,
    available: 2,
  });
  const once = await snapshots();
  await stock().call("count", input, key);
  expect(await snapshots()).toEqual(once);
});
it("normalizes SKU uniqueness, refuses duplicate reservation lines, and prevents inactive stock commitments", async () => {
  const sku = `case-${randomUUID()}`;
  await stock().call("create-product", {
    sku,
    name: "Case proof",
    priceMinor: 0,
  });
  await expect(
    stock().call("create-product", {
      sku: ` ${sku.toUpperCase()} `,
      name: "Duplicate",
      priceMinor: 0,
    }),
  ).rejects.toMatchObject({ code: "STORE_UNIQUE_CONFLICT" });
  const p = await product();
  const before = await snapshots();
  await expect(
    orders().call("reserve", {
      referenceId: randomUUID(),
      lines: [
        { productId: p.id, quantity: 1 },
        { productId: p.id.toUpperCase(), quantity: 1 },
      ],
    }),
  ).rejects.toThrow();
  expect(await snapshots()).toEqual(before);
  await stock().call("edit-product", {
    id: p.id,
    version: p.version,
    sku: p.sku,
    name: p.name,
    priceMinor: p.priceMinor,
    active: false,
  });
  await expect(
    orders().call("reserve", {
      referenceId: randomUUID(),
      lines: [{ productId: p.id, quantity: 1 }],
    }),
  ).rejects.toThrow();
  expect(await stock().call("get", { id: p.id })).toMatchObject({
    reserved: 0,
    available: 10,
    active: false,
  });
});
it("rechecks stock permissions before saved receipts and hides full balances from availability-only roles", async () => {
  const p = await product(),
    key = randomUUID();
  const input = { id: p.id, quantity: 2, reason: "Permission replay proof" };
  await stock().call("receipt", input, key);
  const before = await snapshots();
  const owner = await inWorkspace(db, workspace, async (tx) => {
    const role = await tx
      .selectFrom("suite.roles")
      .select(["id", "permissions"])
      .where("workspace_id", "=", workspace)
      .where("name", "=", "Owner")
      .executeTakeFirstOrThrow();
    await tx
      .updateTable("suite.roles")
      .set({
        permissions: role.permissions.filter(
          (p) =>
            ![
              "inventory.receive",
              "inventory.read",
              "inventory.reservations.write",
            ].includes(p),
        ),
      })
      .where("workspace_id", "=", workspace)
      .where("id", "=", role.id)
      .execute();
    return role;
  });
  try {
    await expect(stock().call("receipt", input, key)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(stock().call("receipt", input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      orders().call("reserve", {
        referenceId: randomUUID(),
        lines: [{ productId: p.id, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await snapshots()).toEqual(before);
    const visible = await stock().call("get", { id: p.id });
    expect(visible).toMatchObject({ available: 12 });
    expect(visible).not.toHaveProperty("onHand");
    expect(visible).not.toHaveProperty("reserved");
  } finally {
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.roles")
        .set({ permissions: owner.permissions })
        .where("workspace_id", "=", workspace)
        .where("id", "=", owner.id)
        .execute(),
    );
  }
  const restored = await snapshots();
  await stock().call("receipt", input, key);
  expect(await snapshots()).toEqual(restored);
});
it("validates imported balances atomically and preserves archived legacy history", async () => {
  const target = randomUUID();
  const ids = [randomUUID(), randomUUID()].sort();
  const data = {
    sku: "IMPORTED",
    name: "Imported product",
    priceMinor: 500,
    active: true,
    productVersion: 8,
    stockVersion: 12,
    onHand: 10,
    reserved: 0,
    available: 10,
    lowStock: true,
  };
  await inWorkspace(db, target, async (tx) => {
    await provisionWorkspace(tx, {
      id: target,
      userId: authenticatedActor.id,
      name: "Inventory migration acceptance",
      kind: "company",
      modules: ["inventory"],
    });
    await tx
      .insertInto("suite.module_storage")
      .values({
        workspace_id: target,
        module_id: "inventory",
        schema_version: 1,
        release_version: "1.2.0",
      })
      .execute();
    await tx
      .insertInto("suite.module_records")
      .values(
        ids.map((id, index) => ({
          workspace_id: target,
          module_id: "inventory",
          resource: "$legacy-products",
          id,
          data: {
            ...data,
            sku: `IMPORTED-${index}`,
            available: index ? 11 : 10,
          },
          created_by: authenticatedActor.id,
          version: 3,
          archived: Boolean(index),
        })),
      )
      .execute();
  });
  const migrate = () =>
    inWorkspace(db, target, async (tx) =>
      migrateModuleStorage(
        tx,
        await authorize(tx, authenticatedActor, target, randomUUID()),
        "inventory",
        version,
      ),
    );
  await expect(migrate()).rejects.toThrow(
    "Imported product balances are inconsistent",
  );
  const snapshot = () =>
    inWorkspace(db, target, async (tx) => ({
      records: await tx
        .selectFrom("suite.module_records")
        .select(["id", "resource", "data", "version", "archived"])
        .where("workspace_id", "=", target)
        .orderBy("resource")
        .orderBy("id")
        .execute(),
      storage: await tx
        .selectFrom("suite.module_storage")
        .select("schema_version")
        .where("workspace_id", "=", target)
        .where("module_id", "=", "inventory")
        .executeTakeFirstOrThrow(),
      revisions: await tx
        .selectFrom("suite.module_revisions")
        .select("version")
        .where("workspace_id", "=", target)
        .execute(),
    }));
  expect(await snapshot()).toMatchObject({
    storage: { schema_version: 1 },
    revisions: [],
    records: [
      { resource: "$legacy-products", version: 3, archived: false },
      { resource: "$legacy-products", version: 3, archived: true },
    ],
  });
  await inWorkspace(db, target, (tx) =>
    tx
      .updateTable("suite.module_records")
      .set({ data: { ...data, sku: "IMPORTED-1" } })
      .where("workspace_id", "=", target)
      .where("id", "=", ids[1])
      .execute(),
  );
  expect(await migrate()).toMatchObject({
    schemaVersion: 2,
    applied: ["import-v1"],
  });
  const migrated = await snapshot();
  expect(
    migrated.records.filter((r) => r.resource === "$products"),
  ).toMatchObject([
    {
      id: ids[0],
      archived: false,
      data: { productVersion: 8, stockVersion: 12, available: 10 },
    },
    {
      id: ids[1],
      archived: true,
      data: { productVersion: 8, stockVersion: 12, available: 10 },
    },
  ]);
  expect(
    migrated.records
      .filter((r) => r.resource === "$legacy-products")
      .every((r) => r.archived),
  ).toBe(true);
  expect(await migrate()).toMatchObject({ applied: [] });
  expect(await snapshot()).toEqual(migrated);
});

it("creates simultaneous Orders drafts with unique numbers and server-derived totals and product snapshots", async () => {
  const p = await product(40);
  const input = {
    customerName: "  SDK customer  ",
    lines: [{ productId: p.id.toUpperCase(), quantity: 3, priceMinor: 1750 }],
  };
  const keys = Array.from({ length: 6 }, () => randomUUID());
  const drafts = await Promise.all(
    keys.map((key) => businessOrders().call("draft", input, key)),
  );
  expect(drafts.map((o) => o.number).sort((a, b) => a - b)).toEqual([
    1, 2, 3, 4, 5, 6,
  ]);
  for (const draft of drafts)
    expect(draft).toMatchObject({
      customerName: "SDK customer",
      status: "draft",
      totalMinor: 5250,
      version: 1,
      lines: [
        {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          quantity: 3,
          priceMinor: 1750,
        },
      ],
    });
  const once = await snapshots();
  expect(await businessOrders().call("draft", input, keys[0])).toEqual(
    drafts[0],
  );
  expect(await snapshots()).toEqual(once);
  const malicious = await app.app.inject({
    method: "POST",
    url: `/api/v1/module/orders/workspaces/${workspace}/operations/draft`,
    headers: {
      ...headers,
      "idempotency-key": randomUUID(),
      "x-module-version": version,
    },
    payload: { ...input, totalMinor: 1, status: "fulfilled" },
  });
  expect(malicious.statusCode).toBe(400);
  expect(
    await businessOrders().attempt("draft", {
      ...input,
      lines: [{ productId: p.id, quantity: 1000000, priceMinor: 100000000 }],
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_DRAFT" } });
  expect(await snapshots()).toEqual(once);
});
it("returns typed stock rejections during competing order confirmations and fulfills exactly once", async () => {
  const p = await product();
  const drafts = await Promise.all(
    ["First", "Second"].map((customerName) =>
      businessOrders().call("draft", {
        customerName,
        lines: [{ productId: p.id, quantity: 7, priceMinor: 900 }],
      }),
    ),
  );
  const confirmed = await Promise.all(
    drafts.map((draft) =>
      businessOrders().attempt("confirm", {
        id: draft.id,
        version: draft.version,
      }),
    ),
  );
  expect(confirmed.filter((r) => r.ok)).toHaveLength(1);
  expect(confirmed.find((r) => !r.ok)).toMatchObject({
    ok: false,
    error: { code: "STOCK_REJECTED", stock: { code: "INSUFFICIENT_STOCK" } },
  });
  const accepted = confirmed.find((r) => r.ok)!;
  if (!accepted.ok) throw Error("No accepted confirmation");
  const rejected = drafts[confirmed.findIndex((r) => !r.ok)];
  expect(await businessOrders().call("get", { id: rejected.id })).toMatchObject(
    { status: "draft", version: 1 },
  );
  expect(await stock().call("get", { id: p.id })).toMatchObject({
    onHand: 10,
    reserved: 7,
    available: 3,
  });
  const input = { id: accepted.value.id, version: accepted.value.version },
    key = randomUUID();
  const fulfilled = await businessOrders().call("fulfill", input, key);
  expect(fulfilled).toMatchObject({
    status: "fulfilled",
    version: 3,
    activity: [
      { action: "orders.fulfilled" },
      { action: "orders.confirmed" },
      { action: "orders.created" },
    ],
  });
  const once = await snapshots();
  expect(await businessOrders().call("fulfill", input, key)).toEqual(fulfilled);
  expect(await snapshots()).toEqual(once);
  expect(
    once.audits.filter(
      (a) =>
        a.target_id === input.id &&
        ["orders.fulfilled", "inventory.consumed"].includes(a.action),
    ),
  ).toHaveLength(2);
  expect(await stock().call("get", { id: p.id })).toMatchObject({
    onHand: 3,
    reserved: 0,
    available: 3,
  });
  expect(
    await businessOrders().attempt("cancel", {
      id: fulfilled.id,
      version: fulfilled.version,
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});
it("keeps snapshots until draft edits and enforces versions, state and exact inventory release", async () => {
  const p = await product();
  const input = {
    customerName: "Edit proof",
    lines: [{ productId: p.id, quantity: 4, priceMinor: 700 }],
  };
  const draft = await businessOrders().call("draft", input);
  await stock().call("edit-product", {
    id: p.id,
    version: p.version,
    name: "Updated product",
    sku: p.sku,
    priceMinor: p.priceMinor,
    active: true,
  });
  expect(
    (await businessOrders().call("get", { id: draft.id })).lines[0].name,
  ).toBe(p.name);
  const edited = await businessOrders().call("edit", {
    ...input,
    id: draft.id,
    version: draft.version,
  });
  expect(edited).toMatchObject({
    version: 2,
    lines: [{ name: "Updated product" }],
  });
  expect(
    await businessOrders().attempt("edit", {
      ...input,
      id: draft.id,
      version: 1,
    }),
  ).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
  const confirmed = await businessOrders().call("confirm", {
    id: edited.id,
    version: edited.version,
  });
  expect(
    await businessOrders().attempt("edit", {
      ...input,
      id: confirmed.id,
      version: confirmed.version,
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
  const cancelled = await businessOrders().call("cancel", {
    id: confirmed.id,
    version: confirmed.version,
  });
  expect(cancelled).toMatchObject({ status: "cancelled", version: 4 });
  expect(await stock().call("get", { id: p.id })).toMatchObject({
    onHand: 10,
    reserved: 0,
    available: 10,
  });
  const fresh = await businessOrders().call("draft", input);
  const before = (await snapshots()).records.filter(
    (r) => r.module_id === "inventory",
  );
  await businessOrders().call("cancel", {
    id: fresh.id,
    version: fresh.version,
  });
  expect(
    (await snapshots()).records.filter((r) => r.module_id === "inventory"),
  ).toEqual(before);
  expect(
    await createModuleClient(ordersDefinition, send(foreign)).attempt("get", {
      id: fresh.id,
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
});
it("rolls back an entire Orders confirmation when a later product fails and rejects missing service grants", async () => {
  const products = (await Promise.all([product(), product()])).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const draft = await businessOrders().call("draft", {
    customerName: "Atomic proof",
    lines: products.map((p, index) => ({
      productId: p.id,
      quantity: index ? 11 : 4,
      priceMinor: 500,
    })),
  });
  const before = await snapshots();
  expect(
    await businessOrders().attempt("confirm", {
      id: draft.id,
      version: draft.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "STOCK_REJECTED", stock: { code: "INSUFFICIENT_STOCK" } },
  });
  expect(await snapshots()).toEqual(before);
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.platform_settings")
      .set({ value: { services: [] } })
      .where("workspace_id", "=", workspace)
      .where("key", "=", "grant:orders:inventory")
      .execute(),
  );
  try {
    await expect(
      businessOrders().call("confirm", {
        id: draft.id,
        version: draft.version,
      }),
    ).rejects.toMatchObject({ code: "GRANT_REQUIRED" });
    expect(await snapshots()).toEqual(before);
  } finally {
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.platform_settings")
        .set({ value: { services: [...actions] } })
        .where("workspace_id", "=", workspace)
        .where("key", "=", "grant:orders:inventory")
        .execute(),
    );
  }
  expect(
    await businessOrders().attempt("draft", {
      customerName: "Missing product",
      lines: [{ productId: randomUUID(), quantity: 1, priceMinor: 1 }],
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "STOCK_REJECTED", stock: { code: "NOT_FOUND" } },
  });
  expect(await snapshots()).toEqual(before);
});
it("preserves imported order versions, history and numbering, rejecting inconsistent totals or counters atomically", async () => {
  const target = randomUUID(),
    ids = [randomUUID(), randomUUID()].sort();
  const counter = "00000000-0000-4000-8000-000000000001";
  const data = {
    orderVersion: 7,
    number: 20,
    customerName: "Imported customer",
    status: "draft",
    totalMinor: 20,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    lines: [
      {
        productId: randomUUID(),
        quantity: 2,
        priceMinor: 10,
        sku: "OLD",
        name: "Historical snapshot",
      },
    ],
    activity: [
      { action: "orders.created", createdAt: "2026-09-01T00:00:00.000Z" },
    ],
  };
  await inWorkspace(db, target, async (tx) => {
    await provisionWorkspace(tx, {
      id: target,
      userId: authenticatedActor.id,
      name: "Orders migration acceptance",
      kind: "company",
      modules: ["inventory", "orders"],
    });
    await tx
      .insertInto("suite.module_storage")
      .values([
        {
          workspace_id: target,
          module_id: "inventory",
          schema_version: 2,
          release_version: version,
        },
        {
          workspace_id: target,
          module_id: "orders",
          schema_version: 1,
          release_version: "1.1.0",
        },
      ])
      .execute();
    await tx
      .insertInto("suite.platform_settings")
      .values([
        {
          workspace_id: target,
          key: "pin:inventory",
          value: { version },
          version: 1,
        },
        {
          workspace_id: target,
          key: "grant:orders:inventory",
          value: { services: [...actions] },
          version: 1,
        },
      ])
      .execute();
    await tx
      .insertInto("suite.module_records")
      .values([
        ...ids.map((id, index) => ({
          workspace_id: target,
          module_id: "orders",
          resource: "$legacy-orders",
          id,
          data: { ...data, number: 20 + index, totalMinor: index ? 21 : 20 },
          created_by: authenticatedActor.id,
          version: 1,
          archived: Boolean(index),
        })),
        {
          workspace_id: target,
          module_id: "orders",
          resource: "$legacy-counters",
          id: counter,
          data: { next: 20 },
          created_by: authenticatedActor.id,
          version: 1,
          archived: false,
        },
      ])
      .execute();
  });
  const migrate = () =>
    inWorkspace(db, target, async (tx) =>
      migrateModuleStorage(
        tx,
        await authorize(tx, authenticatedActor, target, randomUUID()),
        "orders",
        version,
      ),
    );
  const records = () =>
    inWorkspace(db, target, (tx) =>
      tx
        .selectFrom("suite.module_records")
        .selectAll()
        .where("workspace_id", "=", target)
        .where("module_id", "=", "orders")
        .orderBy("resource")
        .orderBy("id")
        .execute(),
    );
  const before = await records();
  await expect(migrate()).rejects.toThrow(
    "Imported order lines and total are inconsistent",
  );
  expect(await records()).toEqual(before);
  await inWorkspace(db, target, (tx) =>
    tx
      .updateTable("suite.module_records")
      .set({ data: { ...data, number: 21 } })
      .where("workspace_id", "=", target)
      .where("id", "=", ids[1])
      .execute(),
  );
  const fixedLines = await records();
  await expect(migrate()).rejects.toThrow(
    "Imported order counter is inconsistent",
  );
  expect(await records()).toEqual(fixedLines);
  await inWorkspace(db, target, (tx) =>
    tx
      .updateTable("suite.module_records")
      .set({ data: { next: 100 } })
      .where("workspace_id", "=", target)
      .where("id", "=", counter)
      .execute(),
  );
  expect(await migrate()).toMatchObject({
    applied: ["import-v1"],
    schemaVersion: 2,
  });
  const imported = (await records()).filter((r) => r.resource === "$orders");
  expect(imported).toMatchObject([
    { id: ids[0], archived: false, data: { orderVersion: 7, number: 20 } },
    { id: ids[1], archived: true, data: { orderVersion: 7, number: 21 } },
  ]);
  const after = await records();
  expect(await migrate()).toMatchObject({ applied: [] });
  expect(await records()).toEqual(after);
  await inWorkspace(db, target, (tx) =>
    tx
      .insertInto("suite.platform_settings")
      .values({
        workspace_id: target,
        key: "pin:orders",
        value: { version },
        version: 1,
      })
      .execute(),
  );
  const client = createModuleClient(ordersDefinition, send(target));
  expect(await client.call("get", { id: ids[0] })).toMatchObject({
    version: 7,
    number: 20,
    activity: data.activity,
    lines: data.lines,
  });
  const p = await createModuleClient(inventory, send(target)).call(
    "create-product",
    { sku: "POST-IMPORT", name: "New product", priceMinor: 10 },
  );
  const fresh = await client.call("draft", {
    customerName: "After import",
    lines: [{ productId: p.id, quantity: 1, priceMinor: 10 }],
  });
  expect(fresh).toMatchObject({ number: 100, version: 1 });
});
it("queries all matching Inventory products and computes summaries beyond one page", async () => {
  const before = await stock().call("overview", {});
  const products = [];
  for (let start = 0; start < 55; start += 5)
    products.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(5, 55 - start) }, (_, offset) =>
          stock().call("create-product", {
            sku: `AAA-QUERY-${String(start + offset).padStart(3, "0")}`,
            name: `Query 100%_item ${start + offset}`,
            priceMinor: 100,
          }),
        ),
      )),
    );
  await stock().call("create-product", {
    sku: "CONTROL-QUERY",
    name: "Query 100anythingXitem",
    priceMinor: 100,
  });
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await stock().call("products", {
      search: "100%_ITEM",
      limit: 7,
      cursor,
    });
    seen.push(...page.items.map((p) => p.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(new Set(seen)).toEqual(new Set(products.map((p) => p.id)));
  const summary = await stock().call("overview", {});
  expect(summary).toMatchObject({
    products: before.products + 56,
    available: before.available,
    lowStock: before.lowStock + 56,
  });
  expect(summary.lowStockItems.map((p) => p.sku)).toEqual(
    products.slice(0, 5).map((p) => p.sku),
  );
  expect(
    await createModuleClient(inventory, send(foreign)).call("overview", {}),
  ).toEqual({ products: 0, available: 0, lowStock: 0, lowStockItems: [] });
  const p = await product(12);
  await stock().call("adjustment", {
    id: p.id,
    quantity: -2,
    reason: "History adjustment",
  });
  const firstPage = await stock().call("movements", {
    productId: p.id.toUpperCase(),
    limit: 1,
  });
  expect(firstPage.items).toMatchObject([
    { kind: "adjustment", onHandDelta: -2, reason: "History adjustment" },
  ]);
  const secondPage = await stock().call("movements", {
    productId: p.id.toUpperCase(),
    limit: 1,
    cursor: firstPage.nextCursor!,
  });
  expect(secondPage.items).toMatchObject([
    { kind: "receipt", onHandDelta: 12 },
  ]);
  expect(secondPage.nextCursor).toBeNull();
});
it("queries Orders with complete status/daily summaries and numerically ordered bounded exports", async () => {
  const before = await businessOrders().call("overview", {}),
    p = await product();
  const drafts = [];
  for (let start = 0; start < 55; start += 5)
    drafts.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(5, 55 - start) }, (_, offset) =>
          businessOrders().call("draft", {
            customerName: `Search customer ${start + offset}`,
            lines: [{ productId: p.id, quantity: 1, priceMinor: 300 }],
          }),
        ),
      )),
    );
  for (let i = 0; i < 3; i++) {
    const confirmed = await businessOrders().call("confirm", {
      id: drafts[i].id,
      version: drafts[i].version,
    });
    if (i < 2)
      await businessOrders().call("fulfill", {
        id: confirmed.id,
        version: confirmed.version,
      });
  }
  await businessOrders().call("cancel", {
    id: drafts[3].id,
    version: drafts[3].version,
  });
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await businessOrders().call("list", {
      search: "SEARCH CUSTOMER",
      limit: 7,
      cursor,
    });
    seen.push(...page.items.map((o) => o.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(new Set(seen)).toEqual(new Set(drafts.map((o) => o.id)));
  const summary = await businessOrders().call("overview", {});
  expect(summary).toMatchObject({
    draft: before.draft + 51,
    confirmed: before.confirmed + 1,
    fulfilled: before.fulfilled + 2,
    cancelled: before.cancelled + 1,
  });
  expect(summary.fulfilledDaily.slice(0, 6)).toEqual(
    before.fulfilledDaily.slice(0, 6),
  );
  expect(summary.fulfilledDaily[6].count).toBe(
    before.fulfilledDaily[6].count + 2,
  );
  expect(summary.ready.map((o) => o.id)).toContain(drafts[2].id);
  expect(summary.recent.map((o) => o.id)).toEqual(
    [...drafts]
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      )
      .slice(0, 6)
      .map((o) => o.id),
  );
  const numbers: number[] = [];
  let exportCursor: string | undefined;
  do {
    const page = await businessOrders().call("export-page", {
      cursor: exportCursor,
      limit: 7,
    });
    expect(page.items.length).toBeLessThanOrEqual(7);
    expect(page.total).toBe(
      summary.draft + summary.confirmed + summary.fulfilled + summary.cancelled,
    );
    numbers.push(...page.items.map((o) => o.number));
    exportCursor = page.nextCursor ?? undefined;
  } while (exportCursor);
  expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  expect(new Set(numbers).size).toBe(
    summary.draft + summary.confirmed + summary.fulfilled + summary.cancelled,
  );
});

it("exports every migrated order from one snapshot, processes SDK events, and rechecks export access", async () => {
  const f = await legacyFixture();
  await convertLegacy(f.target);
  const lastId = randomUUID();
  await inWorkspace(worker, foreign, async (tx) => {
    const leaked = await tx
      .selectFrom("suite.module_records")
      .select("id")
      .where("workspace_id", "=", f.target)
      .execute();
    expect(leaked).toEqual([]);
  });
  await expect(
    inWorkspace(worker, f.target, (tx) =>
      tx
        .updateTable("suite.module_records")
        .set({ archived: true })
        .where("workspace_id", "=", f.target)
        .execute(),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  const template = await inWorkspace(db, f.target, async (tx) => {
    const row = await tx
      .selectFrom("suite.module_records")
      .selectAll()
      .where("workspace_id", "=", f.target)
      .where("module_id", "=", "orders")
      .where("resource", "=", "$orders")
      .where("id", "=", f.confirmed.id)
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("suite.module_records")
      .values(
        Array.from({ length: 202 }, (_, index) => ({
          ...row,
          id: index === 201 ? lastId : randomUUID(),
          data: {
            ...row.data,
            number: f.confirmed.number + index + 1,
            status: "draft",
            customerName: `Snapshot ${index}`,
            orderVersion: 1,
          },
        })),
      )
      .execute();
    await tx
      .updateTable("suite.module_records")
      .set({ data: { next: f.confirmed.number + 203 } })
      .where("workspace_id", "=", f.target)
      .where("module_id", "=", "orders")
      .where("resource", "=", "$counters")
      .execute();
    return row;
  });
  await expect(
    inWorkspace(db, f.target, async (tx) => {
      const ctx = await authorize(
        tx,
        authenticatedActor,
        f.target,
        randomUUID(),
        "orders.export",
        "orders",
      );
      await orderExportPages(tx, ctx).next();
    }),
  ).rejects.toMatchObject({ code: "EXPORT_SNAPSHOT_REQUIRED" });
  await inWorkspace(
    db,
    f.target,
    async (tx) => {
      const ctx = await authorize(
        tx,
        authenticatedActor,
        f.target,
        randomUUID(),
        "orders.export",
        "orders",
      );
      const pages = orderExportPages(tx, ctx);
      const first = await pages.next();
      expect(first.done).toBe(false);
      expect(first.value).toHaveLength(200);
      // Commit a change to an unread page and a new row after the first page.
      await inWorkspace(db, f.target, async (other) => {
        await other
          .updateTable("suite.module_records")
          .set({
            data: {
              ...template.data,
              number: f.confirmed.number + 202,
              status: "draft",
              customerName: "Changed after snapshot",
              orderVersion: 1,
            },
          })
          .where("workspace_id", "=", f.target)
          .where("module_id", "=", "orders")
          .where("resource", "=", "$orders")
          .where("id", "=", lastId)
          .execute();
        await other
          .insertInto("suite.module_records")
          .values({
            ...template,
            id: randomUUID(),
            data: {
              ...template.data,
              number: f.confirmed.number + 203,
              status: "draft",
              customerName: '=HYPERLINK("example")',
              orderVersion: 1,
            },
          })
          .execute();
        await other
          .updateTable("suite.module_records")
          .set({ data: { next: f.confirmed.number + 204 } })
          .where("workspace_id", "=", f.target)
          .where("module_id", "=", "orders")
          .where("resource", "=", "$counters")
          .execute();
      });
      const remaining = [];
      for await (const page of pages) remaining.push(...page);
      expect(remaining).toHaveLength(3);
      expect(remaining.at(-1)?.customerName).toBe("Snapshot 201");
    },
    { readOnly: true },
  );

  const orders = createModuleClient(ordersDefinition, send(f.target));
  await orders.call("cancel", { id: lastId, version: 1 });
  const requestExport = (key = randomUUID()) =>
    app.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${f.target}/exports`,
      headers: { ...headers, "idempotency-key": key },
      payload: {},
    });
  const prioritize = () =>
    inWorkspace(db, f.target, (tx) =>
      tx
        .updateTable("suite.outbox")
        .set({ created_at: new Date(0) })
        .where("workspace_id", "=", f.target)
        .where("completed_at", "is", null)
        .execute(),
    );
  const key = randomUUID(),
    created = await requestExport(key);
  expect(created.statusCode, created.body).toBe(200);
  expect((await requestExport(key)).json()).toEqual(created.json());
  await prioritize();
  await runBatch(worker);
  const download = await app.app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${f.target}/exports/${created.json().id}/download`,
    headers,
  });
  expect(download.statusCode, download.body).toBe(200);
  const lines = download.json().content.split("\r\n");
  expect(lines).toHaveLength(205);
  expect(lines.at(-2)).toContain('"Changed after snapshot","cancelled"');
  expect(lines.at(-1)).toContain('"\'=HYPERLINK(""example"")"');
  const list = await app.app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${f.target}/exports`,
    headers,
  });
  expect(list.json()).toContainEqual(
    expect.objectContaining({ id: created.json().id, state: "ready" }),
  );
  await inWorkspace(db, f.target, async (tx) => {
    const notifications = await tx
      .selectFrom("suite.notifications")
      .select(["title", "event_id"])
      .where("workspace_id", "=", f.target)
      .execute();
    expect(
      notifications.filter(
        (n) => n.title === `Order ${f.confirmed.number + 202} cancelled`,
      ),
    ).toHaveLength(1);
    expect(
      notifications.filter((n) => n.title === "Order export ready"),
    ).toHaveLength(1);
    // Reclaim the accepted export event: delivery and output remain idempotent.
    await tx
      .updateTable("suite.outbox")
      .set({
        completed_at: null,
        available_at: new Date(0),
        created_at: new Date(0),
      })
      .where("workspace_id", "=", f.target)
      .where("event_type", "=", "export.orders")
      .execute();
  });
  await runBatch(worker);
  await inWorkspace(db, f.target, async (tx) => {
    const notifications = await tx
      .selectFrom("suite.notifications")
      .select("id")
      .where("workspace_id", "=", f.target)
      .where("title", "=", "Order export ready")
      .execute();
    expect(notifications).toHaveLength(1);
  });
  const denied = await requestExport();
  expect(denied.statusCode).toBe(200);
  await inWorkspace(db, f.target, (tx) =>
    tx
      .updateTable("suite.module_activations")
      .set({ state: "suspended" })
      .where("workspace_id", "=", f.target)
      .where("module_id", "=", "orders")
      .execute(),
  );
  await prioritize();
  await runBatch(worker);
  await inWorkspace(db, f.target, async (tx) => {
    const rejected = await tx
      .selectFrom("suite.exports")
      .select(["state", "object_key"])
      .where("workspace_id", "=", f.target)
      .where("id", "=", denied.json().id)
      .executeTakeFirstOrThrow();
    expect(rejected).toEqual({ state: "failed", object_key: null });
  });
  const revokedDownload = await app.app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${f.target}/exports/${created.json().id}/download`,
    headers,
  });
  expect(revokedDownload.statusCode).toBe(403);
});

it("reviews coordinated cutover without writes, requires explicit grants, detects stale policy and recovers the exact receipt", async () => {
  const f = await legacyFixture();
  const base = {
    inventory: version,
    orders: version,
    roleGrants: [] as { roleId: string; permissions: string[] }[],
    grantServices: false,
  };
  const review = (selection = base) =>
    app.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${f.target}/business-upgrade/review`,
      headers,
      payload: selection,
    });
  const before = await conversionState(f.target);
  const first = await review();
  expect(first.statusCode, first.body).toBe(200);
  expect(first.headers["cache-control"]).toBe("no-store");
  expect(first.json()).toMatchObject({
    ready: false,
    completed: false,
    restrictedCount: 1,
    counts: { products: 1, orders: 1, movements: 2 },
  });
  expect(first.json().issues.map((i: { code: string }) => i.code)).toEqual(
    expect.arrayContaining(["GRANT_REQUIRED", "PERMISSIONS_REQUIRED"]),
  );
  expect(await conversionState(f.target)).toEqual(before);
  const owner = first
    .json()
    .roles.find((r: { name: string }) => r.name === "Owner");
  const selection = {
    ...base,
    grantServices: true,
    roleGrants: [
      {
        roleId: owner.id,
        permissions: [
          "inventory.availability.read",
          "inventory.reservations.write",
        ],
      },
    ],
  };
  const ready = await review(selection);
  expect(ready.statusCode, ready.body).toBe(200);
  expect(ready.json(), ready.body).toMatchObject({
    ready: true,
    restrictedCount: 0,
  });
  expect((await review(selection)).json().token).toBe(ready.json().token);
  const submit = (token: string, key = randomUUID()) =>
    app.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${f.target}/platform`,
      headers: { ...headers, "idempotency-key": key },
      payload: {
        action: "business-cutover",
        value: { ...selection, reviewToken: token },
      },
    });
  await inWorkspace(db, f.target, (tx) =>
    tx
      .updateTable("suite.roles")
      .set({ name: "Owner updated" })
      .where("id", "=", owner.id)
      .execute(),
  );
  const stale = await submit(ready.json().token);
  expect(stale.statusCode, stale.body).toBe(409);
  expect(stale.json().code).toBe("BUSINESS_REVIEW_STALE");
  const refreshed = await review(selection);
  expect(refreshed.json().ready, refreshed.body).toBe(true);
  const key = randomUUID(),
    applied = await submit(refreshed.json().token, key);
  expect(applied.statusCode, applied.body).toBe(200);
  expect(applied.json()).toMatchObject({ state: "completed" });
  const after = await conversionState(f.target);
  expect(after.storage.map((r) => r.schema_version)).toEqual([2, 2]);
  expect(
    after.settings.find((r) => r.key === "business-upgrade-review")?.value
      .reviewToken,
  ).toBe(refreshed.json().token);
  expect(
    after.audits.filter((r) => r.action === "roles.business-upgrade.granted"),
  ).toHaveLength(1);
  expect(
    after.audits.filter(
      (r) => r.action === "modules.business-upgrade.services-granted",
    ),
  ).toHaveLength(1);
  expect((await submit(refreshed.json().token, key)).json()).toEqual(
    applied.json(),
  );
  expect(await conversionState(f.target)).toEqual(after);
  expect((await review(base)).json().completed).toBe(true);
  const stock = createModuleClient(inventory, send(f.target));
  expect(await stock.call("products", { limit: 10 })).toMatchObject({
    items: [expect.objectContaining({ id: f.product.id })],
  });
});

it("rejects foreign roles and unrelated permission grants during business cutover review", async () => {
  const f = await legacyFixture();
  const request = (roleGrants: { roleId: string; permissions: string[] }[]) =>
    app.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${f.target}/business-upgrade/review`,
      headers,
      payload: {
        inventory: version,
        orders: version,
        roleGrants,
        grantServices: true,
      },
    });
  const roles = await inWorkspace(db, f.target, (tx) =>
    tx
      .selectFrom("suite.roles")
      .selectAll()
      .where("workspace_id", "=", f.target)
      .execute(),
  );
  for (const grants of [
    [{ roleId: randomUUID(), permissions: ["inventory.availability.read"] }],
    [
      {
        roleId: roles.find((r) => r.name === "Sales")!.id,
        permissions: ["roles.manage"],
      },
    ],
  ]) {
    const response = await request(grants);
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().code).toBe("INVALID_ROLE_GRANTS");
  }
});

it("preserves explicit denials and rechecks role administration authority in cutover review", async () => {
  const f = await legacyFixture();
  const { owner, sales, member } = await inWorkspace(
    db,
    f.target,
    async (tx) => {
      const roles = await tx
        .selectFrom("suite.roles")
        .selectAll()
        .where("workspace_id", "=", f.target)
        .execute();
      const owner = roles.find((r) => r.name === "Owner")!,
        sales = roles.find((r) => r.name === "Sales")!;
      const member = await tx
        .selectFrom("suite.memberships")
        .selectAll()
        .where("workspace_id", "=", f.target)
        .where("user_id", "=", authenticatedActor.id)
        .executeTakeFirstOrThrow();
      return { owner, sales, member };
    },
  );
  const selection = {
    inventory: version,
    orders: version,
    roleGrants: [
      { roleId: sales.id, permissions: ["inventory.reservations.write"] },
    ],
    grantServices: true,
  };
  // The same member has ordinary grants and a denial from Sales. Protected root is unassigned.
  await inWorkspace(db, f.target, async (tx) => {
    await tx
      .deleteFrom("suite.role_assignments")
      .where("workspace_id", "=", f.target)
      .where("membership_id", "=", member.id)
      .execute();
    await tx
      .insertInto("suite.role_assignments")
      .values({
        workspace_id: f.target,
        membership_id: member.id,
        role_id: sales.id,
      })
      .execute();
    await tx
      .updateTable("suite.roles")
      .set({
        permissions: [...sales.permissions, "modules.manage", "roles.manage"],
      })
      .where("id", "=", sales.id)
      .execute();
    await tx
      .insertInto("suite.platform_settings")
      .values({
        workspace_id: f.target,
        key: "organization",
        version: 1,
        value: {
          rootId: owner.id,
          ranks: (
            await tx
              .selectFrom("suite.roles")
              .selectAll()
              .where("workspace_id", "=", f.target)
              .execute()
          ).map((r) => ({
            id: r.id,
            name: r.id === owner.id ? "Administrador" : r.name,
            parents: r.id === owner.id ? [] : [owner.id],
            inherit: false,
            denies: r.id === sales.id ? ["inventory.reservations.write"] : [],
            x: 0,
            y: 0,
          })),
          groups: [],
        },
      })
      .execute();
  });
  const request = () =>
    app.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${f.target}/business-upgrade/review`,
      headers,
      payload: selection,
    });
  const denied = await request();
  expect(denied.statusCode).toBe(200);
  expect(denied.json()).toMatchObject({
    ready: false,
    restrictedCount: 1,
    restrictedMembers: [
      { id: member.id, missing: ["inventory.reservations.write"] },
    ],
  });
  await inWorkspace(db, f.target, (tx) =>
    tx
      .updateTable("suite.roles")
      .set({ permissions: [...sales.permissions, "modules.manage"] })
      .where("id", "=", sales.id)
      .execute(),
  );
  expect((await request()).statusCode).toBe(403);
  await inWorkspace(db, f.target, (tx) =>
    tx
      .updateTable("suite.roles")
      .set({ permissions: sales.permissions })
      .where("id", "=", sales.id)
      .execute(),
  );
  expect((await request()).statusCode).toBe(403);
});

it("rolls back selected permissions and service grants when source conversion fails, even when caught", async () => {
  const f = await legacyFixture();
  const owner = await inWorkspace(db, f.target, (tx) =>
    tx
      .selectFrom("suite.roles")
      .selectAll()
      .where("workspace_id", "=", f.target)
      .where("name", "=", "Owner")
      .executeTakeFirstOrThrow(),
  );
  const selection = {
    inventory: version,
    orders: version,
    roleGrants: [
      { roleId: owner.id, permissions: ["inventory.reservations.write"] },
    ],
    grantServices: true,
  };
  // A malformed historical name is not a balance mismatch. Final import validation must reject it.
  await inWorkspace(db, f.target, (tx) =>
    tx
      .updateTable("suite.products")
      .set({ name: "" })
      .where("id", "=", f.product.id)
      .execute(),
  );
  const before = await conversionState(f.target);
  const review = await inWorkspace(
    db,
    f.target,
    async (tx) =>
      reviewBusinessCutover(
        tx,
        await authorize(tx, authenticatedActor, f.target, randomUUID()),
        selection,
        moduleServers,
      ),
    { readOnly: true },
  );
  expect(review.ready, JSON.stringify(review.issues)).toBe(true);
  await inWorkspace(db, f.target, async (tx) => {
    await expect(
      applyBusinessCutover(
        tx,
        await authorize(tx, authenticatedActor, f.target, randomUUID()),
        { ...selection, reviewToken: review.token },
        moduleServers,
      ),
    ).rejects.toThrow();
    await sql`select 1`.execute(tx);
    expect(
      (
        await tx
          .selectFrom("suite.roles")
          .select("permissions")
          .where("id", "=", owner.id)
          .executeTakeFirstOrThrow()
      ).permissions,
    ).toEqual(owner.permissions);
  });
  expect(await conversionState(f.target)).toEqual(before);
});

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
import ordersCandidate from "../modules/orders/releases/2.0.0/module";
import { serviceContractSource } from "../packages/module-sdk/node/service-contracts";
import candidate from "../modules/inventory/releases/2.0.0/module";
import { buildServerPackage } from "../packages/module-sdk/node/build-server";
import { signPackage } from "../packages/module-sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  stageRelease,
  publishRelease,
} from "../tooling/registry-review";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
  authorize,
  type Actor,
} from "../packages/server-core/src";
import { migrateModuleStorage } from "../packages/server-core/src/module-migrations";
import { createApp } from "../apps/api/src/app";

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
  await registry.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const send =
  (target = workspace) =>
  async (call: ModuleCall) => {
    const response = await app.app.inject({
      method: "POST",
      url: `/api/v1/module/${call.moduleId}/workspaces/${target}/operations/${call.operation}`,
      headers: {
        ...headers,
        "idempotency-key": call.key!,
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

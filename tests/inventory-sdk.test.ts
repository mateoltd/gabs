import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
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
        modules: ["inventory", first.id, second.id],
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

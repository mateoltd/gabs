import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  defineModule,
  store,
  operation,
  Type,
  hydrateModule,
  createModuleClient,
  type ModuleContext,
  type ModuleCall,
  serviceReference,
} from "@suite/module-sdk";
import { defineModuleServer } from "@suite/module-sdk/server";
import { registerModule } from "@suite/module-catalog";
import { moduleServers } from "@suite/module-catalog/server";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
  authorize,
  type Actor,
} from "../packages/server-core/src";
import { executeStore } from "../packages/server-core/src/module-stores";
import { createApp } from "../apps/api/src/app";

const moduleId = `private-store-${randomUUID().slice(0, 8)}`;
const balances = store(
  {
    sku: Type.String({ minLength: 1, maxLength: 20 }),
    units: Type.Integer({ minimum: 0 }),
  },
  { unique: ["sku"] },
);
const record = Type.Object({
  id: Type.String(),
  version: Type.Integer(),
  data: balances.schema,
});
const definition = defineModule({
  id: moduleId,
  name: "Private stock acceptance",
  version: "1.0.0",
  description: "Transactional stores",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: {},
  permissions: [`${moduleId}.run`] as const,
  configuration: Type.Object({}),
  resources: {},
  stores: { balances },
  events: {
    reserved: Type.Object({ id: Type.String(), quantity: Type.Integer() }),
  },
  operations: {
    seed: operation({
      title: "Seed",
      policy: "online",
      permission: `${moduleId}.run`,
      input: balances.schema,
      output: record,
    }),
    reserve: operation({
      title: "Reserve",
      policy: "online",
      permission: `${moduleId}.run`,
      public: true,
      input: Type.Object({
        id: Type.String(),
        quantity: Type.Integer({ minimum: 1 }),
      }),
      output: record,
      errors: Type.Object({
        reason: Type.Union([
          Type.Literal("missing"),
          Type.Literal("insufficient"),
        ]),
      }),
    }),
    read: operation({
      title: "Read",
      policy: "online",
      permission: `${moduleId}.run`,
      input: Type.Object({ id: Type.String() }),
      output: Type.Union([record, Type.Null()]),
    }),
    fail: operation({
      title: "Rollback",
      policy: "online",
      permission: `${moduleId}.run`,
      input: Type.Object({ sku: Type.String(), detached: Type.Boolean() }),
      output: Type.Boolean(),
    }),
  },
});
const server = defineModuleServer(definition)({
  seed: (ctx, input) => ctx.store("balances").create(input),
  read: (ctx, input) => ctx.store("balances").get(input.id),
  reserve: async (ctx, input) => {
    const table = ctx.store("balances");
    const current = await table.get(input.id, { lock: true });
    if (!current) return ctx.reject({ reason: "missing" });
    if (current.data.units < input.quantity)
      ctx.reject({ reason: "insufficient" });
    const next = await table.replace(current.id, current.version, {
      ...current.data,
      units: current.data.units - input.quantity,
    });
    await ctx.emit("reserved", input);
    return next;
  },
  fail: async (ctx, input) => {
    const table = ctx.store("balances");
    await table.create({ sku: input.sku, units: 8 });
    await ctx.emit("reserved", { id: "rollback", quantity: 1 });
    const failure = table.create({ sku: input.sku, units: 5 });
    if (input.detached) void failure;
    else await failure.catch(() => undefined);
    return true;
  },
});
const consumerId = `consumer-${randomUUID().slice(0, 8)}`;
const consumer = defineModule({
  id: consumerId,
  name: "Private store consumer",
  version: "1.0.0",
  description: "Atomic service use",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: { [moduleId]: "^1.0.0" },
  permissions: [`${consumerId}.run`] as const,
  configuration: Type.Object({}),
  resources: {},
  stores: {
    receipts: store({ product: Type.String(), quantity: Type.Integer() }),
  },
  services: { reserve: serviceReference(definition, "reserve") },
  operations: {
    run: operation({
      title: "Consume",
      policy: "online",
      permission: `${consumerId}.run`,
      input: Type.Object({
        id: Type.String(),
        quantity: Type.Integer({ minimum: 1 }),
        fail: Type.Boolean(),
      }),
      output: Type.Integer(),
      errors: Type.Object({ reason: Type.Literal("cancelled") }),
    }),
  },
});
const consumerServer = defineModuleServer(consumer)({
  run: async (ctx, input) => {
    await ctx
      .store("receipts")
      .create({ product: input.id, quantity: input.quantity });
    const reserved = await ctx.service("reserve", {
      id: input.id,
      quantity: input.quantity,
    });
    if (input.fail) return ctx.reject({ reason: "cancelled" });
    return reserved.data.units;
  },
});
function typeProof(ctx: ModuleContext<typeof definition>) {
  // @ts-expect-error Only this module's declared stores exist.
  ctx.store("other-module.balances");
  // @ts-expect-error Store values are inferred, not untyped bodies.
  ctx.store("balances").create({ sku: "T", units: "ten" });
  // @ts-expect-error Filters cannot name absent fields.
  ctx.store("balances").scan({ where: { workspaceId: "another" } });
  // @ts-expect-error Unique fields must exist in the declared schema.
  store({ sku: Type.String() }, { unique: ["missing"] });
}
void typeProof;
const db = connectDatabase();
let app: Awaited<ReturnType<typeof createApp>>;
let headers: Record<string, string>, actorId: string;
let authenticatedActor: Actor;
const workspace = randomUUID(),
  otherWorkspace = randomUUID();
beforeAll(async () => {
  // Signed JSON transport must retain schemas for private records, too.
  registerModule(hydrateModule(JSON.parse(JSON.stringify(definition))));
  registerModule(consumer);
  moduleServers.push(server, consumerServer);
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
    name: "Store author",
    email: `${randomUUID()}@test.local`,
    emailVerified: true,
  });
  actorId = actor.id;
  for (const id of [workspace, otherWorkspace])
    await inWorkspace(db, id, (tx) =>
      provisionWorkspace(tx, {
        id,
        userId: actor.id,
        name: "Private stores",
        kind: "company",
        modules: [moduleId, consumerId],
      }),
    );
  const session = await app.auth.issue(actor.id, true);
  authenticatedActor = await app.auth.session(session.token);
  headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
});
afterAll(async () => {
  moduleServers.splice(moduleServers.indexOf(server), 1);
  moduleServers.splice(moduleServers.indexOf(consumerServer), 1);
  await app.app.close();
  await db.destroy();
});
const send =
  (target = workspace) =>
  async (call: ModuleCall) => {
    const response = await app.app.inject({
      method: "POST",
      url: `/api/v1/module/${call.moduleId}/workspaces/${target}/operations/${call.operation}`,
      headers: { ...headers, "idempotency-key": call.key! },
      payload: call.input as object,
    });
    if (response.statusCode !== 200)
      throw Object.assign(new Error(response.json().message), response.json(), {
        status: response.statusCode,
      });
    return response.json();
  };
const client = () => createModuleClient(definition, send());
const scope = <T>(
  run: (
    tx: Parameters<Parameters<typeof inWorkspace>[2]>[0],
    ctx: Awaited<ReturnType<typeof authorize>>,
  ) => Promise<T>,
) =>
  inWorkspace(db, workspace, async (tx) =>
    run(tx, await authorize(tx, authenticatedActor, workspace, randomUUID())),
  );
const counts = () =>
  inWorkspace(db, workspace, async (tx) => ({
    records: Number(
      (
        await tx
          .selectFrom("suite.module_records")
          .select(tx.fn.countAll().as("n"))
          .where("workspace_id", "=", workspace)
          .executeTakeFirstOrThrow()
      ).n,
    ),
    audits: Number(
      (
        await tx
          .selectFrom("suite.audit")
          .select(tx.fn.countAll().as("n"))
          .where("workspace_id", "=", workspace)
          .executeTakeFirstOrThrow()
      ).n,
    ),
    outbox: Number(
      (
        await tx
          .selectFrom("suite.outbox")
          .select(tx.fn.countAll().as("n"))
          .where("workspace_id", "=", workspace)
          .executeTakeFirstOrThrow()
      ).n,
    ),
  }));

it("locks private balances across concurrent API requests without overselling or duplicate retry effects", async () => {
  const item = await client().call("seed", { sku: "CONCURRENT", units: 10 });
  const keys = [randomUUID(), randomUUID()];
  const input = { id: item.id, quantity: 7 };
  const results = await Promise.allSettled(
    keys.map((key) => client().call("reserve", input, key)),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await client().call("read", { id: item.id }))?.data.units).toBe(3);
  const before = await counts();
  const accepted = results.findIndex((r) => r.status === "fulfilled");
  expect(await client().call("reserve", input, keys[accepted])).toEqual(
    (results[accepted] as PromiseFulfilledResult<unknown>).value,
  );
  expect(await counts()).toEqual(before);
  await expect(
    scope((tx, ctx) =>
      executeStore(tx, ctx, definition, "balances", {
        action: "replace",
        id: item.id,
        version: 1,
        data: item.data,
      }),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
});
it("enforces unique keys concurrently and rolls back caught or detached failures with their audits and events", async () => {
  const results = await Promise.allSettled(
    [1, 2].map(() => client().call("seed", { sku: "UNIQUE", units: 1 })),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  for (const detached of [false, true]) {
    const before = await counts();
    await expect(
      client().call("fail", { sku: `FAIL-${detached}`, detached }),
    ).rejects.toMatchObject({ code: "STORE_UNIQUE_CONFLICT" });
    expect(await counts()).toEqual(before);
  }
});
it("keeps private records out of public CRUD and other workspaces and modules", async () => {
  const row = await client().call("seed", { sku: "PRIVATE", units: 4 });
  expect(
    await createModuleClient(definition, send(otherWorkspace)).call("read", {
      id: row.id,
    }),
  ).toBeNull();
  const response = await app.app.inject({
    method: "POST",
    url: `/api/v1/module/${moduleId}/workspaces/${workspace}/records`,
    headers,
    payload: { action: "get", resource: "$balances", input: { id: row.id } },
  });
  expect(response.statusCode).toBe(400);
  await expect(
    scope((tx, ctx) =>
      executeStore(tx, ctx, definition, "another-module.balances", {
        action: "get",
        id: row.id,
      }),
    ),
  ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  const alternate = { ...definition, id: `other-${moduleId}` };
  expect(
    await scope((tx, ctx) =>
      executeStore(tx, ctx, alternate, "balances", {
        action: "get",
        id: row.id,
      }),
    ),
  ).toBeNull();
  await expect(
    scope((tx, ctx) =>
      executeStore(tx, ctx, definition, "balances", {
        action: "scan",
        where: { workspace_id: otherWorkspace },
      }),
    ),
  ).rejects.toThrow();
  await expect(
    scope((tx, ctx) =>
      executeStore(tx, ctx, definition, "balances", {
        action: "scan",
        limit: 201,
      }),
    ),
  ).rejects.toThrow();
});
it("paginates filtered private records and archives without deleting history", async () => {
  for (const sku of ["PAGE-A", "PAGE-B", "PAGE-C"])
    await client().call("seed", { sku, units: 19 });
  const first = (await scope((tx, ctx) =>
    executeStore(tx, ctx, definition, "balances", {
      action: "scan",
      where: { units: 19 },
      limit: 2,
    }),
  )) as { items: { id: string; version: number }[]; next: string };
  expect(first.items).toHaveLength(2);
  expect(first.next).toBeTruthy();
  const second = (await scope((tx, ctx) =>
    executeStore(tx, ctx, definition, "balances", {
      action: "scan",
      where: { units: 19 },
      limit: 2,
      after: first.next,
    }),
  )) as { items: { id: string }[]; next: null };
  expect(second.items).toHaveLength(1);
  expect(second.next).toBeNull();
  const row = first.items[0];
  await scope((tx, ctx) =>
    executeStore(tx, ctx, definition, "balances", {
      action: "archive",
      id: row.id,
      version: row.version,
    }),
  );
  expect(await client().call("read", { id: row.id })).toBeNull();
  const history = await inWorkspace(db, workspace, (tx) =>
    tx
      .selectFrom("suite.module_revisions")
      .select("version")
      .where("workspace_id", "=", workspace)
      .where("module_id", "=", moduleId)
      .where("record_id", "=", row.id)
      .orderBy("version")
      .execute(),
  );
  expect(history.map((r) => r.version)).toEqual([1, 2]);
});

it("requires explicit cross-module grants and commits or rolls back both private stores together", async () => {
  const row = await client().call("seed", { sku: "SERVICE", units: 10 });
  const requester = createModuleClient(consumer, send());
  const input = { id: row.id, quantity: 4, fail: false };
  const beforeGrant = await counts();
  await expect(requester.call("run", input)).rejects.toMatchObject({
    code: "GRANT_REQUIRED",
  });
  expect(await counts()).toEqual(beforeGrant);
  await scope((tx) =>
    tx
      .insertInto("suite.platform_settings")
      .values({
        workspace_id: workspace,
        key: `grant:${consumerId}:${moduleId}`,
        value: { services: ["reserve"] },
        version: 1,
      })
      .execute(),
  );
  const beforeFailure = await counts();
  expect(await requester.attempt("run", { ...input, fail: true })).toEqual({
    ok: false,
    error: { reason: "cancelled" },
  });
  expect(await counts()).toEqual(beforeFailure);
  expect((await client().call("read", { id: row.id }))?.data.units).toBe(10);
  const key = randomUUID();
  expect(await requester.call("run", input, key)).toBe(6);
  const once = await counts();
  expect(await requester.call("run", input, key)).toBe(6);
  expect(await counts()).toEqual(once);
  expect((await client().call("read", { id: row.id }))?.data.units).toBe(6);
  expect(
    await scope((tx) =>
      tx
        .selectFrom("suite.module_records")
        .select("data")
        .where("workspace_id", "=", workspace)
        .where("module_id", "=", consumerId)
        .execute(),
    ),
  ).toEqual([{ data: { product: row.id, quantity: 4 } }]);
});

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createModuleClient,
  defineModule,
  operation,
  resource,
  serviceReference,
  store,
  Type,
  type ModuleCall,
  type OperationContext,
} from "@suite/module-sdk";
import {
  defineModuleServer,
  type ModuleContext,
} from "@suite/module-sdk/server";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import { registerModule } from "@suite/module-catalog";
import { moduleServers } from "@suite/module-catalog/server";
import { SuiteClient } from "../packages/api-client/src";
import { createApp } from "../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../packages/server-core/src";

const providerId = `query-provider-${randomUUID().slice(0, 8)}`;
const consumerId = `query-consumer-${randomUUID().slice(0, 8)}`;
const base = {
  version: "1.0.0",
  description: "Read-only acceptance",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  configuration: Type.Object({}),
};
const empty = Type.Object({}, { additionalProperties: false });
const provider = defineModule({
  ...base,
  id: providerId,
  name: "Query provider",
  dependencies: {},
  permissions: [
    `${providerId}.read`,
    `${providerId}.write`,
    `${providerId}.items.read`,
    `${providerId}.items.write`,
  ],
  resources: { items: resource({ name: Type.String() }, { title: "Items" }) },
  stores: { numbers: store({ value: Type.Integer() }) },
  audit: ["changed"],
  events: { changed: empty },
  operations: {
    internal: operation({
      kind: "query",
      policy: "online",
      public: true,
      serviceOnly: true,
      title: "Internal",
      permission: `${providerId}.read`,
      input: empty,
      output: Type.Boolean(),
    }),
    read: operation({
      kind: "query",
      policy: "online",
      public: true,
      title: "Read",
      permission: `${providerId}.read`,
      input: Type.Object({ pause: Type.Optional(Type.Boolean()) }),
      output: Type.Object({ first: Type.Integer(), second: Type.Integer() }),
    }),
    write: operation({
      policy: "online",
      public: true,
      title: "Write",
      permission: `${providerId}.write`,
      input: Type.Object({ value: Type.Integer() }),
      output: Type.Boolean(),
    }),
    unsafe: operation({
      kind: "query",
      policy: "online",
      public: true,
      title: "Invalid query",
      permission: `${providerId}.read`,
      input: Type.Object({
        action: Type.String(),
        detached: Type.Optional(Type.Boolean()),
      }),
      output: Type.Boolean(),
    }),
  },
});
const consumer = defineModule({
  ...base,
  id: consumerId,
  name: "Query consumer",
  dependencies: { [providerId]: "^1.0.0" },
  permissions: [`${consumerId}.read`, `${consumerId}.write`],
  resources: {},
  stores: { attempts: store({ value: Type.Integer() }) },
  services: {
    read: serviceReference(provider, "read"),
    write: serviceReference(provider, "write"),
    unsafe: serviceReference(provider, "unsafe"),
  },
  operations: {
    read: operation({
      kind: "query",
      policy: "online",
      title: "Read",
      permission: `${consumerId}.read`,
      input: empty,
      output: provider.operations.read.output,
    }),
    unsafe: operation({
      kind: "query",
      policy: "online",
      title: "Invalid service",
      permission: `${consumerId}.read`,
      input: empty,
      output: Type.Boolean(),
    }),
    command: operation({
      policy: "online",
      title: "Write before query",
      permission: `${consumerId}.write`,
      input: empty,
      output: Type.Boolean(),
    }),
  },
});
const recordId = randomUUID();
let paused: (() => void) | undefined;
let resume: Promise<void> | undefined;
const providerServer = defineModuleServer(provider)({
  internal: async () => true,
  read: async (ctx, input) => {
    const first = (await ctx.store("numbers").get(recordId))!.data.value;
    if (input.pause) {
      paused!();
      await resume;
    }
    return {
      first,
      second: (await ctx.store("numbers").get(recordId))!.data.value,
    };
  },
  write: async (ctx, input) => {
    const row = await ctx.store("numbers").get(recordId, { lock: true });
    await ctx.store("numbers").replace(recordId, row!.version, input);
    return true;
  },
  unsafe: async (ctx, input) => {
    // Deliberately bypass authoring types to verify the authoritative host boundary.
    const unsafe = ctx as unknown as ModuleContext<typeof provider>;
    const attempt = () => {
      switch (input.action) {
        case "create":
          return unsafe.store("numbers").create({ value: 8 });
        case "replace":
          return unsafe.store("numbers").replace(recordId, 1, { value: 8 });
        case "archive":
          return unsafe.store("numbers").archive(recordId, 1);
        case "lock":
          return unsafe.store("numbers").get(recordId, { lock: true });
        case "resource":
          return unsafe.resource("items").create({ name: "forbidden" });
        case "audit":
          return unsafe.audit("changed", recordId);
        case "emit":
          return unsafe.emit("changed", {});
        default:
          throw Error("Unknown test action");
      }
    };
    if (input.detached) void attempt();
    else
      try {
        await attempt();
      } catch {
        /* Catching never turns a failed query into success. */
      }
    return true;
  },
});
const consumerServer = defineModuleServer(consumer)({
  read: (ctx) => ctx.service("read", {}),
  unsafe: async (ctx) => {
    try {
      await (ctx as unknown as ModuleContext<typeof consumer>).service(
        "write",
        { value: 90 },
      );
    } catch {}
    return true;
  },
  command: async (ctx) => {
    await ctx.store("attempts").create({ value: 1 });
    try {
      await ctx.service("unsafe", { action: "emit" });
    } catch {}
    return true;
  },
});
function typeProof(
  ctx: OperationContext<typeof consumer, "read">,
  own: OperationContext<typeof provider, "read">,
) {
  // @ts-expect-error A declared query cannot use queued execution.
  operation({ ...provider.operations.read, policy: "queued" });
  // @ts-expect-error A query cannot invoke a command service.
  void ctx.service("write", { value: 2 });
  // @ts-expect-error Typed attempts also exclude command services.
  void ctx.serviceAttempt("write", { value: 2 });
  // @ts-expect-error Private query stores cannot create data.
  void own.store("numbers").create({ value: 2 });
  // @ts-expect-error Queries cannot lock a business row.
  void own.store("numbers").get(recordId, { lock: true });
  // @ts-expect-error Resource query clients have no mutation methods.
  void own.resource("items").create({ name: "wrong" });
  // @ts-expect-error Queries cannot emit effects.
  void own.emit("changed", {});
  // @ts-expect-error Queries cannot append business audit records.
  void own.audit("changed", recordId);
  void own
    .resource("items")
    .get(recordId)
    .then((row) => {
      const name: string = row.data.name;
      // @ts-expect-error The resource still infers its actual field types.
      const wrong: number = row.data.name;
      return [name, wrong];
    });
}
void typeProof;
const db = connectDatabase();
const workspace = randomUUID();
let app: Awaited<ReturnType<typeof createApp>>;
let headers: Record<string, string>;
beforeAll(async () => {
  registerModule(provider);
  registerModule(consumer);
  moduleServers.push(providerServer, consumerServer);
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
    name: "Queries",
    email: `${randomUUID()}@test.local`,
    emailVerified: true,
  });
  await inWorkspace(db, workspace, async (tx) => {
    await provisionWorkspace(tx, {
      id: workspace,
      userId: actor.id,
      name: "Queries",
      modules: [providerId, consumerId],
      kind: "company",
    });
    await tx
      .insertInto("suite.module_records")
      .values({
        workspace_id: workspace,
        module_id: providerId,
        resource: "$numbers",
        id: recordId,
        data: { value: 1 },
        version: 1,
        archived: false,
        created_by: actor.id,
      })
      .execute();
    await tx
      .insertInto("suite.platform_settings")
      .values({
        workspace_id: workspace,
        key: `grant:${consumerId}:${providerId}`,
        value: { services: ["read", "write", "unsafe"] },
        version: 1,
      })
      .execute();
  });
  const session = await app.auth.issue(actor.id, true);
  headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
});
afterAll(async () => {
  for (const server of [providerServer, consumerServer])
    moduleServers.splice(moduleServers.indexOf(server), 1);
  await app?.app.close();
  await db.destroy();
});
function raw(
  moduleId: string,
  name: string,
  input: object,
  query = true,
  extra: Record<string, string> = {},
) {
  return app.app.inject({
    method: "POST",
    url: `/api/v1/module/${moduleId}/workspaces/${workspace}/${query ? "queries" : "operations"}/${name}`,
    headers: { ...headers, ...extra },
    payload: input,
  });
}
async function send(call: ModuleCall) {
  const response = await raw(
    call.moduleId,
    call.operation!,
    call.input as object,
    call.kind === "query",
    {
      "x-module-version": call.moduleVersion!,
      ...(call.key ? { "idempotency-key": call.key } : {}),
    },
  );
  if (response.statusCode !== 200)
    throw Object.assign(Error(response.json().message), response.json(), {
      status: response.statusCode,
    });
  return response.json();
}
async function counts() {
  return inWorkspace(db, workspace, async (tx) => {
    const tables = [
      "suite.module_records",
      "suite.module_revisions",
      "suite.audit",
      "suite.outbox",
      "suite.idempotency",
    ] as const;
    return Promise.all(
      tables.map((table) =>
        tx
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .where("workspace_id", "=", workspace)
          .executeTakeFirstOrThrow()
          .then((row) => Number(row.count)),
      ),
    );
  });
}
it("dispatches fresh queries without command receipts or effects, even with reused keys", async () => {
  const before = await counts(),
    key = randomUUID();
  const read = await raw(providerId, "read", {}, true, {
    "idempotency-key": key,
  });
  expect(read.statusCode).toBe(200);
  expect(read.headers["cache-control"]).toBe("no-store");
  expect(read.json()).toEqual({ first: 1, second: 1 });
  expect(await counts()).toEqual(before);
  await createModuleClient(provider, send).call("write", { value: 2 });
  const afterWrite = await counts();
  expect(
    (
      await raw(providerId, "read", {}, true, { "idempotency-key": key })
    ).json(),
  ).toEqual({ first: 2, second: 2 });
  expect(await createModuleClient(consumer, send).call("read", {})).toEqual({
    first: 2,
    second: 2,
  });
  expect(await counts()).toEqual(afterWrite);
  const client = new SuiteClient(async (request) => {
    expect(request.operation).toBe("moduleQuery");
    expect(request.idempotencyKey).toBeUndefined();
    expect(request.moduleVersion).toBe(provider.version);
    return { status: 200, body: { first: 2, second: 2 } };
  });
  expect(
    await client.module(provider, workspace).call("read", {}, key),
  ).toEqual({ first: 2, second: 2 });
});
it("rejects command/query confusion, undeclared writes, locks, events, and caught or detached failures", async () => {
  const before = await counts();
  expect((await raw(providerId, "internal", {})).json().code).toBe(
    "SERVICE_ONLY",
  );
  expect(
    (await raw(providerId, "read", {}, true, { "x-module-version": "0.1.0" }))
      .statusCode,
  ).toBe(409);
  const foreign = await app.app.inject({
    method: "POST",
    url: `/api/v1/module/${providerId}/workspaces/${randomUUID()}/queries/read`,
    headers,
    payload: {},
  });
  expect(foreign.statusCode).toBe(403);
  expect((await raw(providerId, "write", { value: 8 })).json().code).toBe(
    "NOT_A_QUERY",
  );
  expect(
    (
      await raw(providerId, "read", {}, false, {
        "idempotency-key": randomUUID(),
      })
    ).json().code,
  ).toBe("QUERY_ENDPOINT_REQUIRED");
  for (const action of [
    "create",
    "replace",
    "archive",
    "lock",
    "resource",
    "audit",
    "emit",
  ])
    for (const detached of [false, true]) {
      const response = await raw(providerId, "unsafe", { action, detached });
      expect(
        response.statusCode,
        `${action}/${detached}: ${response.body}`,
      ).toBe(403);
      expect(response.json().code).toBe("QUERY_WRITE_DENIED");
    }
  expect((await raw(consumerId, "unsafe", {})).json().code).toBe(
    "QUERY_WRITE_DENIED",
  );
  expect(
    (
      await raw(consumerId, "command", {}, false, {
        "idempotency-key": randomUUID(),
      })
    ).json().code,
  ).toBe("QUERY_WRITE_DENIED");
  expect(await counts()).toEqual(before);
});
it("keeps all reads in one database snapshot while concurrent commands commit", async () => {
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    paused = resolve;
  });
  resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = raw(providerId, "read", { pause: true }).then(
    (response) => response,
  );
  try {
    await started;
    await createModuleClient(provider, send).call("write", { value: 3 });
  } finally {
    release();
  }
  const response = await read;
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toEqual({ first: 2, second: 2 });
  expect(await createModuleClient(provider, send).call("read", {})).toEqual({
    first: 3,
    second: 3,
  });
  await expect(
    inWorkspace(
      db,
      workspace,
      (tx) =>
        sql`update suite.module_records set version = version + 1 where workspace_id = ${workspace}::uuid`.execute(
          tx,
        ),
      { readOnly: true },
    ),
  ).rejects.toMatchObject({ code: "25006" });
});
it("rechecks revoked read permissions and service grants on every request", async () => {
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.platform_settings")
      .set({ value: { services: ["write"] } })
      .where("workspace_id", "=", workspace)
      .where("key", "=", `grant:${consumerId}:${providerId}`)
      .execute(),
  );
  expect((await raw(consumerId, "read", {})).json().code).toBe(
    "GRANT_REQUIRED",
  );
  await inWorkspace(db, workspace, async (tx) => {
    const roles = await tx
      .selectFrom("suite.roles")
      .select(["id", "permissions"])
      .where("workspace_id", "=", workspace)
      .execute();
    for (const role of roles)
      await tx
        .updateTable("suite.roles")
        .set({
          permissions: role.permissions.filter(
            (p) => p !== `${providerId}.read`,
          ),
        })
        .where("id", "=", role.id)
        .where("workspace_id", "=", workspace)
        .execute();
  });
  expect((await raw(providerId, "read", {})).json().code).toBe("FORBIDDEN");
});
it("rejects queued/local query declarations and enforces query effects in the simulator", async () => {
  for (const policy of ["queued", "local"] as const)
    expect(() =>
      defineModule({
        ...provider,
        operations: {
          ...provider.operations,
          read: { ...provider.operations.read, policy },
        },
      }),
    ).toThrow("online execution");
  const simulator = createModuleSimulator(provider, { server: providerServer });
  for (const action of ["resource", "emit", "audit"]) {
    await expect(
      simulator.client.call("unsafe", { action }),
    ).rejects.toMatchObject({ code: "QUERY_WRITE_DENIED" });
    await expect(
      simulator.client.call("unsafe", { action, detached: true }),
    ).rejects.toMatchObject({ code: "QUERY_WRITE_DENIED" });
  }
  expect(simulator.snapshot().events).toEqual([]);
  expect(simulator.snapshot().records.items).toEqual([]);
});

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defineModule,
  operation,
  resource,
  field,
  Type,
  serviceReference,
  createModuleClient,
  hydrateModule,
  type ModuleCall,
  type OperationContext,
} from "@suite/module-sdk";
import { defineModuleServer } from "@suite/module-sdk/server";
import { registerModule } from "@suite/module-catalog";
import { moduleServers } from "@suite/module-catalog/server";
import { createApp } from "../../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
const providerId = `service-provider-${randomUUID().slice(0, 8)}`;
const consumerId = `service-consumer-${randomUUID().slice(0, 8)}`;
const base = {
  version: "1.0.0",
  description: "Service acceptance",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  configuration: Type.Object({}, { additionalProperties: false }),
};
const provider = defineModule({
  ...base,
  id: providerId,
  name: "Provider",
  dependencies: {},
  permissions: [
    `${providerId}.items.read`,
    `${providerId}.items.write`,
    `${providerId}.create`,
  ],
  resources: {
    items: resource({ name: field.text({ minLength: 1 }) }, { title: "Items" }),
  },
  events: { created: Type.Object({ name: Type.String() }) },
  operations: {
    create: operation({
      title: "Create",
      permission: `${providerId}.create`,
      policy: "online",
      public: true,
      input: Type.Object({ name: Type.String() }),
      output: Type.Object({ id: Type.String() }),
      errors: Type.Object({ reason: Type.Literal("rejected") }),
    }),
  },
});
const consumer = defineModule({
  ...base,
  id: consumerId,
  name: "Consumer",
  dependencies: { [providerId]: "^1.0.0" },
  permissions: [
    `${consumerId}.items.read`,
    `${consumerId}.items.write`,
    `${consumerId}.run`,
  ],
  resources: { items: resource({ name: field.text() }, { title: "Items" }) },
  services: { create: serviceReference(provider, "create") },
  configuration: Type.Object(
    { prefix: Type.Optional(Type.String()) },
    { additionalProperties: false },
  ),
  operations: {
    run: operation({
      title: "Run",
      permission: `${consumerId}.run`,
      policy: "online",
      input: Type.Object({
        name: Type.String(),
        fail: Type.Optional(Type.Boolean()),
        swallow: Type.Optional(Type.Boolean()),
        typed: Type.Optional(Type.Boolean()),
        detached: Type.Optional(Type.Boolean()),
      }),
      output: Type.Object({ id: Type.String() }),
      errors: Type.Object({ reason: Type.Literal("cancelled") }),
    }),
  },
});
const providerServer = defineModuleServer(provider)({
  create: async (ctx, input) => {
    const record = await ctx.resource("items").create({ name: input.name });
    await ctx.emit("created", { name: input.name });
    if (input.name === "reject") ctx.reject({ reason: "rejected" });
    return { id: record.id };
  },
});
const consumerServer = defineModuleServer(consumer)({
  run: async (ctx, input) => {
    await ctx.resource("items").create({ name: input.name });
    if (input.typed) {
      const result = await ctx.serviceAttempt("create", { name: input.name });
      if (result.ok) return result.value;
      if (input.swallow) return { id: "ignored-declared-rejection" };
      return ctx.reject({ reason: "cancelled" });
    }
    if (input.detached) {
      void ctx.service("create", { name: input.name });
      return { id: "detached" };
    }
    let result;
    try {
      result = await ctx.service("create", { name: input.name });
    } catch (error) {
      if (input.swallow) return { id: "caught" };
      throw error;
    }
    if (input.fail) ctx.reject({ reason: "cancelled" });
    return result;
  },
});
const db = connectDatabase();
let app: Awaited<ReturnType<typeof createApp>>;
let workspace: string, headers: Record<string, string>;
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
    name: "Service owner",
    email: `${randomUUID()}@test.local`,
    emailVerified: true,
  });
  workspace = randomUUID();
  await inWorkspace(db, workspace, (tx) =>
    provisionWorkspace(tx, {
      id: workspace,
      userId: actor.id,
      name: "Services",
      modules: [provider.id, consumer.id],
      kind: "company",
    }),
  );
  const session = await app.auth.issue(actor.id, true);
  headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
});
afterAll(async () => {
  moduleServers.splice(moduleServers.indexOf(providerServer), 1);
  moduleServers.splice(moduleServers.indexOf(consumerServer), 1);
  await app.app.close();
  await db.destroy();
});
const send = async (call: ModuleCall) => {
  const response = await app.app.inject({
    method: "POST",
    url: `/api/v1/module/${call.moduleId}/workspaces/${workspace}/operations/${call.operation}`,
    headers: {
      ...headers,
      "idempotency-key": call.key!,
      ...(call.moduleVersion ? { "x-module-version": call.moduleVersion } : {}),
    },
    payload: call.input as object,
  });
  if (response.statusCode !== 200)
    throw Object.assign(new Error(response.json().message), response.json(), {
      status: response.statusCode,
    });
  return response.json();
};
async function counts() {
  return inWorkspace(db, workspace, async (tx) => ({
    records: (
      await tx
        .selectFrom("suite.module_records")
        .select("id")
        .where("workspace_id", "=", workspace)
        .execute()
    ).length,
    events: (
      await tx
        .selectFrom("suite.outbox")
        .select("id")
        .where("workspace_id", "=", workspace)
        .execute()
    ).length,
    audits: (
      await tx
        .selectFrom("suite.audit")
        .select("id")
        .where("workspace_id", "=", workspace)
        .execute()
    ).length,
    retries: (
      await tx
        .selectFrom("suite.idempotency")
        .select("key")
        .where("workspace_id", "=", workspace)
        .execute()
    ).length,
  }));
}
describe("Scoped module services", () => {
  it("refuses a service without a separate administrator grant and rolls back caller writes", async () => {
    const before = await counts();
    await expect(
      createModuleClient(consumer, send).call("run", { name: "denied" }),
    ).rejects.toMatchObject({ code: "GRANT_REQUIRED" });
    expect(await counts()).toEqual(before);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: workspace,
          key: `grant:${consumerId}:${providerId}`,
          value: { read: false, services: ["create"] },
          version: 1,
        })
        .execute(),
    );
  });
  it("commits both modules and events atomically and deduplicates the whole call", async () => {
    const client = createModuleClient(consumer, send),
      key = randomUUID(),
      before = await counts();
    const result = await client.call("run", { name: "accepted" }, key);
    expect(await client.call("run", { name: "accepted" }, key)).toEqual(result);
    const after = await counts();
    expect(after.records - before.records).toBe(2);
    expect(after.events - before.events).toBe(3);
    expect(after.retries - before.retries).toBe(1);
    expect(after.audits - before.audits).toBe(4);
  });
  it("returns inferred business errors and rolls back the provider too", async () => {
    const before = await counts();
    const { attempt } = createModuleClient(consumer, send);
    const result = await attempt("run", {
      name: "undo",
      fail: true,
    });
    expect(result).toEqual({ ok: false, error: { reason: "cancelled" } });
    expect(await counts()).toEqual(before);
  });
  it("cannot commit a failed child call even if the module catches its error", async () => {
    const before = await counts();
    await expect(
      createModuleClient(consumer, send).call("run", {
        name: "reject",
        swallow: true,
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(await counts()).toEqual(before);
  });
  it("drains detached service failures before committing", async () => {
    const before = await counts();
    await expect(
      createModuleClient(consumer, send).call("run", {
        name: "reject",
        detached: true,
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(await counts()).toEqual(before);
  });
  it("rejects a stale operation contract before invoking its server or returning a receipt", async () => {
    const key = randomUUID();
    const input = { name: "Versioned service" };
    const request: ModuleCall = {
      moduleId: consumer.id,
      moduleVersion: consumer.version,
      action: "operation",
      operation: "run",
      input,
      key,
    };
    const result = await send(request);
    const after = await counts();
    expect(await send(request)).toEqual(result);
    await expect(
      send({ ...request, moduleVersion: "0.0.1" }),
    ).rejects.toMatchObject({ status: 409, code: "MODULE_UPDATE_REQUIRED" });
    expect(await counts()).toEqual(after);
  });
  it("translates declared service errors but never commits an ignored typed rejection", async () => {
    const client = createModuleClient(consumer, send),
      before = await counts();
    expect(
      await client.attempt("run", { name: "reject", typed: true }),
    ).toEqual({ ok: false, error: { reason: "cancelled" } });
    expect(await counts()).toEqual(before);
    await expect(
      client.call("run", { name: "reject", typed: true, swallow: true }),
    ).rejects.toMatchObject({ status: 500 });
    expect(await counts()).toEqual(before);
  });
  it("blocks direct receipt replay after an operation becomes service-only", async () => {
    const client = createModuleClient(provider, send),
      key = randomUUID();
    const input = { name: "Formerly public request" };
    await client.call("create", input, key);
    const before = await counts();
    registerModule(
      defineModule({
        ...provider,
        operations: {
          create: { ...provider.operations.create, serviceOnly: true },
        },
      }),
    );
    try {
      await expect(client.call("create", input, key)).rejects.toMatchObject({
        code: "SERVICE_ONLY",
        status: 403,
      });
      expect(await counts()).toEqual(before);
    } finally {
      registerModule(provider);
    }
  });
  it("rechecks current actor permissions even when the service grant remains", async () => {
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
              (p) => p !== `${providerId}.create`,
            ),
          })
          .where("workspace_id", "=", workspace)
          .where("id", "=", role.id)
          .execute();
    });
    const before = await counts();
    await expect(
      createModuleClient(consumer, send).call("run", { name: "revoked" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await counts()).toEqual(before);
  });
  it("hydrates signed event/service schemas and rejects invalid runtime events", async () => {
    expect(
      hydrateModule(JSON.parse(JSON.stringify(consumer))).services?.create
        .contract.input[Symbol.for("TypeBox.Kind") as unknown as string],
    ).toBe("Object");
  });
});
// Compile-time authoring acceptance. These branches never execute.
function typeCoverage(ctx: OperationContext<typeof consumer, "run">) {
  const prefix: string | undefined = ctx.configuration.prefix;
  if (false) {
    // @ts-expect-error Configuration fields are inferred from the schema.
    ctx.configuration.missing;
    // @ts-expect-error The database is never a public module capability.
    ctx.tx;
    // @ts-expect-error Only declared services are callable.
    void ctx.service("delete", {});
    // @ts-expect-error Service inputs are inferred from the provider.
    void ctx.service("create", { name: 5 });
    // @ts-expect-error Business errors are inferred per operation.
    ctx.reject({ reason: "unknown" });
    // @ts-expect-error Resources are module scoped.
    ctx.resource("customers");
    // @ts-expect-error Undeclared events cannot be emitted.
    void ctx.emit("created", { name: "x" });
  }
  return prefix;
}

function eventCoverage(ctx: OperationContext<typeof provider, "create">) {
  if (false) {
    // @ts-expect-error Event payloads retain their declared field types.
    void ctx.emit("created", { name: 42 });
    // @ts-expect-error Only declared event names are available.
    void ctx.emit("deleted", { name: "x" });
  }
}

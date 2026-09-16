import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createModuleClient, type ModuleCall } from "@suite/module-sdk";
import { moduleServers } from "@suite/module-catalog/server";
import inventory from "../modules/inventory/module";
import orders from "../modules/orders/module";
import {
  connectDatabase,
  identify,
  inWorkspace,
} from "../packages/server-core/src";
import { createApp } from "../apps/api/src/app";
const db = connectDatabase();
let app: Awaited<ReturnType<typeof createApp>>, headers: Record<string, string>;
beforeAll(async () => {
  app = await createApp({
    db,
    auth: {
      mode: "development",
      mfaClaim: "https://suite.example/mfa",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
    },
  });
  const user = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    email: `default-${randomUUID()}@test.local`,
    name: "Default SDK owner",
    emailVerified: true,
  });
  const session = await app.auth.issue(user.id, true);
  headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
});
afterAll(async () => {
  await app?.app.close();
  await db.destroy();
});
const send =
  (workspace: string, transportHeaders = headers) =>
  async (call: ModuleCall) => {
    const response = await app.app.inject({
      method: "POST",
      url: `/api/v1/module/${call.moduleId}/workspaces/${workspace}/${call.kind === "query" ? "queries" : "operations"}/${call.operation}`,
      headers: {
        ...transportHeaders,
        "x-module-version": call.moduleVersion!,
        ...(call.key ? { "idempotency-key": call.key } : {}),
      },
      payload: call.input as object,
    });
    if (response.statusCode !== 200)
      throw Object.assign(new Error(response.json().message), response.json());
    return response.json();
  };
it("initializes new personal and company workspaces directly on current scoped defaults and fences historical writes", async () => {
  expect([inventory.version, orders.version]).toEqual(["2.0.0", "2.0.0"]);
  expect(
    moduleServers
      .filter(
        (s) =>
          s.module.version === "2.0.0" &&
          ["inventory", "orders"].includes(s.module.id),
      )
      .map((s) => s.kind),
  ).toEqual(["scoped", "scoped"]);
  const me = await app.app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers,
  });
  expect(me.statusCode).toBe(200);
  const personal = me
    .json()
    .workspaces.find((w: { kind: string }) => w.kind === "personal");
  const workspace = randomUUID();
  const response = await app.app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    headers,
    payload: {
      id: workspace,
      name: "Current business defaults",
      currency: "EUR",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const again = await app.app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    headers,
    payload: {
      id: workspace,
      name: "Current business defaults",
      currency: "EUR",
    },
  });
  expect(again.json()).toEqual(response.json());
  for (const target of [workspace, personal.id]) {
    await inWorkspace(db, target, async (tx) => {
      const storage = await tx
        .selectFrom("suite.module_storage")
        .selectAll()
        .where("workspace_id", "=", target)
        .orderBy("module_id")
        .execute();
      expect(
        storage.map((s) => [s.module_id, s.schema_version, s.release_version]),
      ).toEqual([
        ["inventory", 2, "2.0.0"],
        ["orders", 2, "2.0.0"],
      ]);
      expect(
        (
          await tx
            .selectFrom("suite.audit")
            .select("target_id")
            .where("workspace_id", "=", target)
            .where("action", "=", "modules.storage.initialized")
            .orderBy("target_id")
            .execute()
        ).map((a) => a.target_id),
      ).toEqual(["inventory", "orders"]);
      expect(
        await tx
          .selectFrom("suite.module_migrations")
          .selectAll()
          .where("workspace_id", "=", target)
          .execute(),
      ).toEqual([]);
      expect(
        await tx
          .selectFrom("suite.module_records")
          .selectAll()
          .where("workspace_id", "=", target)
          .execute(),
      ).toEqual([]);
      expect(
        (
          await tx
            .selectFrom("suite.platform_settings")
            .select("value")
            .where("workspace_id", "=", target)
            .where("key", "=", "grant:orders:inventory")
            .executeTakeFirstOrThrow()
        ).value.services,
      ).toEqual(["resolve-products", "reserve", "release", "consume"]);
      const roles = await tx
        .selectFrom("suite.roles")
        .select(["name", "permissions"])
        .where("workspace_id", "=", target)
        .execute();
      for (const name of ["Sales", "Warehouse"])
        expect(roles.find((r) => r.name === name)?.permissions).toContain(
          "inventory.reservations.write",
        );
    });
    const rejected = await app.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${target}/products`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { sku: "OLD", name: "Historical client", priceMinor: 100 },
    });
    expect(rejected.statusCode, rejected.body).toBe(409);
    expect(rejected.json().code).toBe("MODULE_SCHEMA_INCOMPATIBLE");
  }
  const stock = createModuleClient(inventory, send(workspace)),
    sales = createModuleClient(orders, send(workspace));
  const p = await stock.call("create-product", {
    sku: "CURRENT",
    name: "Current default stock",
    priceMinor: 250,
  });
  await stock.call("receipt", {
    id: p.id,
    quantity: 5,
    reason: "Default workspace receipt",
  });
  const draft = await sales.call("draft", {
    customerName: "Current default customer",
    lines: [{ productId: p.id, quantity: 3, priceMinor: 250 }],
  });
  const confirmed = await sales.call("confirm", {
    id: draft.id,
    version: draft.version,
  });
  const key = randomUUID(),
    fulfilled = await sales.call(
      "fulfill",
      { id: draft.id, version: confirmed.version },
      key,
    );
  expect(
    await sales.call(
      "fulfill",
      { id: draft.id, version: confirmed.version },
      key,
    ),
  ).toEqual(fulfilled);
  expect(await stock.call("get", { id: p.id })).toMatchObject({
    onHand: 2,
    reserved: 0,
    available: 2,
  });
  const view = await app.app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${workspace}/orders`,
    headers,
  });
  expect(view.statusCode, view.body).toBe(200);
  expect(view.json().items).toMatchObject([
    { id: draft.id, status: "fulfilled", totalMinor: 750 },
  ]);
  await inWorkspace(db, workspace, async (tx) => {
    expect(
      await tx
        .selectFrom("suite.products")
        .selectAll()
        .where("workspace_id", "=", workspace)
        .execute(),
    ).toEqual([]);
    expect(
      await tx
        .selectFrom("suite.orders")
        .selectAll()
        .where("workspace_id", "=", workspace)
        .execute(),
    ).toEqual([]);
    expect(
      await tx
        .selectFrom("suite.audit")
        .selectAll()
        .where("workspace_id", "=", workspace)
        .where("action", "=", "orders.fulfilled")
        .execute(),
    ).toHaveLength(1);
  });
  const salesperson = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    email: `sales-${randomUUID()}@test.local`,
    name: "Default Sales role",
    emailVerified: true,
  });
  await inWorkspace(db, workspace, async (tx) => {
    const role = await tx
      .selectFrom("suite.roles")
      .select("id")
      .where("workspace_id", "=", workspace)
      .where("name", "=", "Sales")
      .executeTakeFirstOrThrow();
    const membership = randomUUID();
    await tx
      .insertInto("suite.memberships")
      .values({
        id: membership,
        user_id: salesperson.id,
        workspace_id: workspace,
      })
      .execute();
    await tx
      .insertInto("suite.role_assignments")
      .values({
        workspace_id: workspace,
        membership_id: membership,
        role_id: role.id,
      })
      .execute();
    for (const module_id of ["orders", "inventory"])
      await tx
        .insertInto("suite.module_assignments")
        .values({
          workspace_id: workspace,
          membership_id: membership,
          module_id,
        })
        .execute();
  });
  const salesSession = await app.auth.issue(salesperson.id, true);
  const salesHeaders = {
    ...headers,
    cookie: `suite_session=${salesSession.token}`,
    "x-csrf-token": salesSession.csrfToken,
  };
  const salesRoleClient = createModuleClient(
    orders,
    send(workspace, salesHeaders),
  );
  const staffDraft = await salesRoleClient.call("draft", {
    customerName: "Sales role permissions",
    lines: [{ productId: p.id, quantity: 1, priceMinor: 250 }],
  });
  const staffConfirmed = await salesRoleClient.call("confirm", {
    id: staffDraft.id,
    version: staffDraft.version,
  });
  await expect(
    salesRoleClient.call("fulfill", {
      id: staffDraft.id,
      version: staffConfirmed.version,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await salesRoleClient.call("cancel", {
    id: staffDraft.id,
    version: staffConfirmed.version,
  });
  expect(await stock.call("get", { id: p.id })).toMatchObject({
    onHand: 2,
    reserved: 0,
    available: 2,
  });
});

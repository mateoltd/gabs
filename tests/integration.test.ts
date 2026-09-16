import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { sql } from "kysely";
import { createApp } from "../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
  authorize,
  assignModules,
  type Actor,
} from "../packages/server-core/src";
import { runBatch } from "../apps/worker/src/worker";
const db = connectDatabase(),
  worker = connectDatabase(
    process.env.DATABASE_URL!.replace("suite_app:", "suite_worker:"),
  );
const admin = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let server: Awaited<ReturnType<typeof createApp>>;
let owner: Actor, other: Actor;
let workspace: string, foreignWorkspace: string;
let headers: Record<string, string>;
async function request(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const res = await server.app.inject({
    method,
    url: "/api/v1" + path,
    headers: {
      ...headers,
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
      ...extra,
    },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, body: res.json() };
}
const path = (suffix: string) => `/workspaces/${workspace}${suffix}`;
async function product(quantity = 1) {
  const p = await request("POST", path("/products"), {
    sku: "TEST-" + randomUUID().slice(0, 8),
    name: "Test product",
    priceMinor: 1000,
  });
  expect(p.status).toBe(200);
  if (quantity) {
    const r = await request("POST", path(`/products/${p.body.id}/stock`), {
      kind: "receipt",
      quantity,
      reason: "Test receipt",
    });
    expect(r.status).toBe(200);
  }
  return p.body;
}
async function draft(products: { id: string; quantity?: number }[]) {
  const r = await request("POST", path("/orders"), {
    customerName: "Test customer",
    lines: products.map((p) => ({
      productId: p.id,
      quantity: p.quantity ?? 1,
      priceMinor: 1000,
    })),
  });
  expect(r.status).toBe(200);
  return r.body;
}
beforeAll(async () => {
  server = await createApp({
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
    email: `owner-${randomUUID()}@test.local`,
    name: "Test owner",
    emailVerified: true,
  });
  owner = {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    mfa: true,
  };
  const otherUser = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    email: `other-${randomUUID()}@test.local`,
    name: "Other owner",
    emailVerified: true,
  });
  other = {
    id: otherUser.id,
    name: otherUser.name,
    email: otherUser.email,
    emailVerified: true,
    mfa: true,
  };
  workspace = randomUUID();
  foreignWorkspace = randomUUID();
  await inWorkspace(db, workspace, (tx) =>
    provisionWorkspace(tx, {
      id: workspace,
      name: "Integration test",
      kind: "company",
      userId: owner.id,
    }),
  );
  await inWorkspace(db, foreignWorkspace, (tx) =>
    provisionWorkspace(tx, {
      id: foreignWorkspace,
      name: "Other tenant",
      kind: "company",
      userId: other.id,
    }),
  );
  const session = await server.auth.issue(owner.id, true);
  headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
});
afterAll(async () => {
  await server?.app.close();
  await db.destroy();
  await worker.destroy();
  await admin.end();
});
describe("real PostgreSQL transactions and tenant security", () => {
  it("summarizes the entire workspace and filters orders and low stock before pagination", async () => {
    const available = await product(100),
      low = await product(3);
    let last: { id: string } | undefined;
    for (let i = 0; i < 55; i++) last = await draft([available]);
    const confirmed = await request(
      "POST",
      path(`/orders/${last!.id}/confirm`),
      {},
      { "if-match": '"1"' },
    );
    expect(confirmed.status).toBe(200);
    const overview = await request("GET", path("/overview"));
    expect(overview.status).toBe(200);
    expect(overview.body.orders).toMatchObject({
      draft: 54,
      confirmed: 1,
      fulfilled: 0,
      cancelled: 0,
    });
    expect(overview.body.orders.ready.map((o: { id: string }) => o.id)).toEqual(
      [last!.id],
    );
    expect(overview.body.orders.recent).toHaveLength(6);
    expect(overview.body.orders.fulfilledDaily).toHaveLength(7);
    expect(
      overview.body.orders.fulfilledDaily.every(
        (day: { count: number }) => day.count === 0,
      ),
    ).toBe(true);
    expect(
      confirmed.body.activity.map((event: { action: string }) => event.action),
    ).toContain("orders.confirmed");
    expect(overview.body.inventory).toMatchObject({
      products: 2,
      available: 102,
      lowStock: 1,
    });
    expect(overview.body.inventory.lowStockItems[0].id).toBe(low.id);
    const queue = await request(
      "GET",
      path("/orders?status=confirmed&limit=1"),
    );
    expect(queue.body.items.map((o: { id: string }) => o.id)).toEqual([
      last!.id,
    ]);
    expect(queue.body.nextCursor).toBeNull();
    const drafts = await request("GET", path("/orders?status=draft&limit=50"));
    expect(drafts.body.items).toHaveLength(50);
    const remaining = await request(
      "GET",
      path(`/orders?status=draft&cursor=${drafts.body.nextCursor}`),
    );
    expect(remaining.body.items).toHaveLength(4);
    const stock = await request("GET", path("/products?stock=low&limit=1"));
    expect(stock.body.items.map((p: { id: string }) => p.id)).toEqual([low.id]);
    expect(stock.body.nextCursor).toBeNull();
    expect((await request("GET", path("/orders?status=invalid"))).status).toBe(
      400,
    );
    expect(
      (await request("GET", `/workspaces/${foreignWorkspace}/overview`)).status,
    ).toBe(403);
  });
  it("excludes modules from the overview when assignment or permission is missing", async () => {
    const member = await inWorkspace(db, workspace, (tx) =>
      tx
        .selectFrom("suite.memberships")
        .select("id")
        .where("user_id", "=", owner.id)
        .executeTakeFirstOrThrow(),
    );
    await inWorkspace(db, workspace, (tx) =>
      assignModules(tx, workspace, member.id, ["inventory"]),
    );
    try {
      const result = await request("GET", path("/overview"));
      expect(result.status).toBe(200);
      expect(result.body.orders).toBeNull();
      expect(result.body.inventory.products).toBe(2);
      await inWorkspace(db, workspace, (tx) =>
        assignModules(tx, workspace, member.id, []),
      );
      expect((await request("GET", path("/overview"))).body).toEqual({
        orders: null,
        inventory: null,
      });
    } finally {
      await inWorkspace(db, workspace, (tx) =>
        assignModules(tx, workspace, member.id, ["inventory", "orders"]),
      );
    }
    const role = await inWorkspace(db, workspace, (tx) =>
      tx
        .selectFrom("suite.roles")
        .select(["id", "permissions"])
        .where("name", "=", "Owner")
        .executeTakeFirstOrThrow(),
    );
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.roles")
        .set({ permissions: [] })
        .where("id", "=", role.id)
        .execute(),
    );
    try {
      expect((await request("GET", path("/overview"))).body).toEqual({
        orders: null,
        inventory: null,
      });
    } finally {
      await inWorkspace(db, workspace, (tx) =>
        tx
          .updateTable("suite.roles")
          .set({ permissions: role.permissions })
          .where("id", "=", role.id)
          .execute(),
      );
    }
  });
  it("runs as a non-owner without bypass privileges and denies DDL/ledger edits", async () => {
    const r = await sql<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(
      db,
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await expect(
      sql`create table suite.forbidden(id int)`.execute(db),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      inWorkspace(db, workspace, (tx) =>
        sql`delete from suite.audit`.execute(tx),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      inWorkspace(db, workspace, (tx) =>
        sql`update suite.stock_movements set reason='rewritten'`.execute(tx),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("isolates unscoped queries, guessed workspace IDs and cross-tenant references", async () => {
    expect(
      (await db.selectFrom("suite.products").selectAll().execute()).length,
    ).toBe(0);
    expect(
      (await request("GET", `/workspaces/${foreignWorkspace}/bootstrap`))
        .status,
    ).toBe(403);
    const p = await product();
    await inWorkspace(db, foreignWorkspace, async (tx) => {
      expect(
        await tx
          .selectFrom("suite.products")
          .selectAll()
          .where("id", "=", p.id)
          .execute(),
      ).toEqual([]);
      await expect(
        tx
          .insertInto("suite.stock")
          .values({ workspace_id: foreignWorkspace, product_id: p.id })
          .execute(),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });
  it("protects cookie-authenticated mutations against CSRF", async () => {
    expect(
      (
        await request(
          "POST",
          path("/products"),
          { sku: "X", name: "X", priceMinor: 1 },
          { "x-csrf-token": "bad" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "POST",
          path("/products"),
          { sku: "X", name: "X", priceMinor: 1 },
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
  });
  it("allows only one concurrent reservation of the last unit", async () => {
    const p = await product(1),
      a = await draft([p]),
      b = await draft([p]);
    const results = await Promise.all(
      [a, b].map((o) =>
        request(
          "POST",
          path(`/orders/${o.id}/confirm`),
          {},
          { "if-match": `"${o.version}"` },
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const balance = await inWorkspace(db, workspace, (tx) =>
      tx
        .selectFrom("suite.stock")
        .selectAll()
        .where("product_id", "=", p.id)
        .executeTakeFirstOrThrow(),
    );
    expect(balance.on_hand).toBe(1);
    expect(balance.reserved).toBe(1);
  });
  it("rolls back the first stock change when a later line fails", async () => {
    const products = [await product(1), await product(1)].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const o = await draft([
      { id: products[0].id, quantity: 1 },
      { id: products[1].id, quantity: 2 },
    ]);
    const r = await request(
      "POST",
      path(`/orders/${o.id}/confirm`),
      {},
      { "if-match": '"1"' },
    );
    expect(r.status).toBe(409);
    await inWorkspace(db, workspace, async (tx) => {
      const stock = await tx
        .selectFrom("suite.stock")
        .selectAll()
        .where(
          "product_id",
          "in",
          products.map((p) => p.id),
        )
        .execute();
      expect(stock.map((s) => s.reserved)).toEqual([0, 0]);
      expect(
        await tx
          .selectFrom("suite.stock_movements")
          .selectAll()
          .where("order_id", "=", o.id)
          .execute(),
      ).toEqual([]);
      expect(
        await tx
          .selectFrom("suite.audit")
          .selectAll()
          .where("target_id", "=", o.id)
          .where("action", "=", "orders.confirmed")
          .execute(),
      ).toEqual([]);
      expect(
        await tx
          .selectFrom("suite.outbox")
          .selectAll()
          .where(sql<boolean>`payload->>'recordId' = ${o.id}`)
          .execute(),
      ).toEqual([]);
    });
  });
  it("stores idempotent results and rejects keys reused with different input", async () => {
    const p = await product(10),
      body = {
        customerName: "Retry customer",
        lines: [{ productId: p.id, quantity: 2, priceMinor: 100 }],
      },
      key = randomUUID();
    const a = await request("POST", path("/orders"), body, {
      "idempotency-key": key,
    });
    const b = await request("POST", path("/orders"), body, {
      "idempotency-key": key,
    });
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(
      (
        await request(
          "POST",
          path("/orders"),
          { ...body, customerName: "Different" },
          { "idempotency-key": key },
        )
      ).status,
    ).toBe(409);
    const confirmationKey = randomUUID();
    const x = await request(
      "POST",
      path(`/orders/${a.body.id}/confirm`),
      {},
      { "idempotency-key": confirmationKey, "if-match": '"1"' },
    );
    const y = await request(
      "POST",
      path(`/orders/${a.body.id}/confirm`),
      {},
      { "idempotency-key": confirmationKey, "if-match": '"1"' },
    );
    expect(y.body).toEqual(x.body);
    expect(y.status).toBe(200);
  });
  it("rejects stale edits and consumes or releases reservations exactly once", async () => {
    const p = await product(10),
      o = await draft([p]);
    const body = {
      customerName: "Edited",
      lines: [{ productId: p.id, quantity: 3, priceMinor: 1000 }],
    };
    expect(
      (
        await request("PUT", path(`/orders/${o.id}`), body, {
          "if-match": '"1"',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "PUT",
          path(`/orders/${o.id}`),
          { ...body, customerName: "Stale" },
          { "if-match": '"1"' },
        )
      ).status,
    ).toBe(412);
    expect(
      (
        await request(
          "POST",
          path(`/orders/${o.id}/confirm`),
          {},
          { "if-match": '"2"' },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "POST",
          path(`/orders/${o.id}/fulfill`),
          {},
          { "if-match": '"3"' },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "POST",
          path(`/orders/${o.id}/cancel`),
          {},
          { "if-match": '"4"' },
        )
      ).status,
    ).toBe(409);
    const balance = await inWorkspace(db, workspace, (tx) =>
      tx
        .selectFrom("suite.stock")
        .selectAll()
        .where("product_id", "=", p.id)
        .executeTakeFirstOrThrow(),
    );
    expect(balance.on_hand).toBe(7);
    expect(balance.reserved).toBe(0);
    const detail = await request("GET", path(`/orders/${o.id}`));
    expect(
      detail.body.activity.map((event: { action: string }) => event.action),
    ).toContain("orders.fulfilled");
    const summary = await request("GET", path("/overview"));
    expect(summary.body.orders.fulfilledDaily.at(-1).count).toBeGreaterThan(0);
    const cancel = await draft([p]);
    await request(
      "POST",
      path(`/orders/${cancel.id}/confirm`),
      {},
      { "if-match": '"1"' },
    );
    expect(
      (
        await request(
          "POST",
          path(`/orders/${cancel.id}/cancel`),
          {},
          { "if-match": '"2"' },
        )
      ).status,
    ).toBe(200);
  });
  it("suspends dependencies without discarding existing reservations", async () => {
    const p = await product(),
      o = await draft([p]);
    await request(
      "POST",
      path(`/orders/${o.id}/confirm`),
      {},
      { "if-match": '"1"' },
    );
    expect(
      (
        await request("PATCH", path("/modules/inventory"), {
          state: "suspended",
          accessPolicy: "admin",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "POST",
          path(`/orders/${o.id}/fulfill`),
          {},
          { "if-match": '"2"' },
        )
      ).status,
    ).toBe(403);
    const balance = await inWorkspace(db, workspace, (tx) =>
      tx
        .selectFrom("suite.stock")
        .selectAll()
        .where("product_id", "=", p.id)
        .executeTakeFirstOrThrow(),
    );
    expect(balance.reserved).toBe(1);
    await request("PATCH", path("/modules/inventory"), {
      state: "enabled",
      accessPolicy: "admin",
    });
  });
  it("protects the last owner and restricts custom roles to business permissions", async () => {
    const members = await request("GET", path("/members"));
    const own = members.body.find(
      (m: { userId: string }) => m.userId === owner.id,
    );
    expect(
      (
        await request("PATCH", path(`/members/${own.id}`), {
          active: false,
          roleIds: [],
          modules: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request("POST", path("/roles"), {
          name: "Escalation",
          permissions: ["members.manage"],
        })
      ).status,
    ).toBe(400);
  });
  it("enforces invitation identity, expiry, duplicate acceptance and the last seat concurrently", async () => {
    const roles = await request("GET", path("/roles")),
      viewer = roles.body.find((r: { name: string }) => r.name === "Viewer");
    const users = await Promise.all(
      [1, 2].map(async (n) => {
        const u = await identify(db, {
          issuer: "test",
          subject: randomUUID(),
          email: `invite-${n}-${randomUUID()}@test.local`,
          name: "Invitee",
          emailVerified: true,
        });
        const s = await server.auth.issue(u.id, true);
        return { u, s };
      }),
    );
    const invites = await Promise.all(
      users.map(({ u }) =>
        request("POST", path("/invitations"), {
          email: u.email,
          roleId: viewer.id,
        }),
      ),
    );
    expect(invites.every((i) => i.status === 200)).toBe(true);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.workspaces")
        .set({ seat_limit: 2 })
        .where("id", "=", workspace)
        .execute(),
    );
    expect(
      (await request("POST", `/invitations/${invites[0].body.id}/accept`, {}))
        .status,
    ).toBe(404);
    const responses = await Promise.all(
      users.map(({ s }, i) =>
        request(
          "POST",
          `/invitations/${invites[i].body.id}/accept`,
          {},
          { cookie: `suite_session=${s.token}`, "x-csrf-token": s.csrfToken },
        ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const accepted = responses.findIndex((r) => r.status === 200),
      s = users[accepted].s;
    expect(
      (
        await request(
          "POST",
          `/invitations/${invites[accepted].body.id}/accept`,
          {},
          { cookie: `suite_session=${s.token}`, "x-csrf-token": s.csrfToken },
        )
      ).status,
    ).toBe(200);
    const declined = accepted === 0 ? 1 : 0;
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.invitations")
        .set({ expires_at: new Date(0) })
        .where("id", "=", invites[declined].body.id)
        .execute(),
    );
    const t = users[declined].s;
    expect(
      (
        await request(
          "POST",
          `/invitations/${invites[declined].body.id}/accept`,
          {},
          { cookie: `suite_session=${t.token}`, "x-csrf-token": t.csrfToken },
        )
      ).status,
    ).toBe(409);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.workspaces")
        .set({ seat_limit: 10 })
        .where("id", "=", workspace)
        .execute(),
    );
  });
  it("rechecks revoked access before replaying an old successful command", async () => {
    const p = await product(5),
      key = randomUUID(),
      body = {
        customerName: "Before revocation",
        lines: [{ productId: p.id, quantity: 1, priceMinor: 100 }],
      };
    const r = await request("POST", path("/orders"), body, {
      "idempotency-key": key,
    });
    expect(r.status).toBe(200);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.memberships")
        .set({ active: false })
        .where("user_id", "=", owner.id)
        .execute(),
    );
    expect(
      (await request("POST", path("/orders"), body, { "idempotency-key": key }))
        .status,
    ).toBe(403);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.memberships")
        .set({ active: true })
        .where("user_id", "=", owner.id)
        .execute(),
    );
  });
  it("retries expired worker leases and deduplicates notifications", async () => {
    const p = await product(),
      o = await draft([p]);
    await request(
      "POST",
      path(`/orders/${o.id}/confirm`),
      {},
      { "if-match": '"1"' },
    );
    const job = await inWorkspace(db, workspace, (tx) =>
      tx
        .selectFrom("suite.outbox")
        .selectAll()
        .where("event_type", "=", "orders.confirmed")
        .where(sql<boolean>`payload->>'recordId'=${o.id}`)
        .executeTakeFirstOrThrow(),
    );
    // Prioritize this fixture's event, independently of unrelated work already queued locally.
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.outbox")
        .set({ created_at: new Date(0) })
        .where("id", "=", job.id)
        .execute(),
    );
    const claims = await sql<{
      id: string;
      workspace_id: string;
    }>`select * from suite.claim_jobs(1)`.execute(worker);
    expect(claims.rows.map((c) => c.id)).toEqual([job.id]);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.outbox")
        .set({ locked_until: new Date(0) })
        .where("id", "=", job.id)
        .execute(),
    );
    await runBatch(worker);
    const notifications = () =>
      inWorkspace(db, workspace, (tx) =>
        tx
          .selectFrom("suite.notifications")
          .selectAll()
          .where("event_id", "=", job.id)
          .execute(),
      );
    const first = await notifications();
    expect(first).toHaveLength(1);
    expect(first[0].user_id).toBe(owner.id);
    // Re-deliver the same event after a simulated lost acknowledgement, not a different job.
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.outbox")
        .set({
          completed_at: null,
          locked_until: null,
          available_at: new Date(0),
          attempts: 0,
        })
        .where("id", "=", job.id)
        .execute(),
    );
    await runBatch(worker);
    expect(await notifications()).toEqual(first);
    await expect(
      inWorkspace(worker, workspace, (tx) =>
        tx.updateTable("suite.stock").set({ on_hand: 100 }).execute(),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("rechecks export access before processing and before downloading", async () => {
    const exportJob = await request("POST", path("/exports"), {});
    expect(exportJob.status).toBe(200);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.module_activations")
        .set({ state: "suspended" })
        .where("module_id", "=", "orders")
        .execute(),
    );
    for (let i = 0; i < 10; i++) if ((await runBatch(worker)) === 0) break;
    await inWorkspace(db, workspace, async (tx) => {
      expect(
        (
          await tx
            .selectFrom("suite.exports")
            .select("state")
            .where("id", "=", exportJob.body.id)
            .executeTakeFirstOrThrow()
        ).state,
      ).toBe("failed");
    });
    expect(
      (await request("GET", path(`/exports/${exportJob.body.id}/download`)))
        .status,
    ).toBe(403);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.module_activations")
        .set({ state: "enabled" })
        .where("module_id", "=", "orders")
        .execute(),
    );
  });
  it("shows exports as failed after repeatedly crashed leases exhaust retries", async () => {
    const created = await request("POST", path("/exports"), {});
    await admin.query(
      "UPDATE suite.outbox SET attempts=5,locked_until=now()-interval '1 minute' WHERE workspace_id=$1 AND payload->>'recordId'=$2",
      [workspace, created.body.id],
    );
    await runBatch(worker);
    const list = await request("GET", path("/exports"));
    expect(
      list.body.find((e: { id: string }) => e.id === created.body.id).state,
    ).toBe("failed");
  });
  it("does not let an unrelated Authorization header bypass cookie CSRF", async () => {
    const response = await server.app.inject({
      method: "POST",
      url: "/api/v1" + path("/exports"),
      headers: {
        cookie: headers.cookie,
        authorization: "Basic invalid",
        "idempotency-key": randomUUID(),
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });
  it("filters customer names before order pagination and keeps customer details scoped", async () => {
    const p = await product(10);
    const prefix = `Page customer ${randomUUID()}`;
    const created: { id: string; customerName: string }[] = [];
    for (const suffix of ["Alpha", "Beta", "Gamma"]) {
      const response = await request("POST", path("/orders"), {
        customerName: `${prefix} ${suffix}`,
        lines: [{ productId: p.id, quantity: 1, priceMinor: 1000 }],
      });
      expect(response.status).toBe(200);
      created.push(response.body);
    }
    created.sort((a, b) => a.id.localeCompare(b.id));
    let cursor: string | null = null;
    for (const expected of created) {
      const response = await request(
        "GET",
        path(
          `/orders?search=${encodeURIComponent(prefix.toLowerCase())}&status=draft&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
        ),
      );
      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({
        id: expected.id,
        customerName: expected.customerName,
        lines: [{ productId: p.id }],
      });
      cursor = response.body.nextCursor;
    }
    expect(cursor).toBeNull();
    const last = created.at(-1)!;
    const exact = await request(
      "GET",
      path(`/orders?search=${encodeURIComponent(last.customerName)}&limit=1`),
    );
    expect(exact.body.items.map((o: { id: string }) => o.id)).toEqual([
      last.id,
    ]);
    expect(
      (
        await request(
          "GET",
          `/workspaces/${foreignWorkspace}/orders?search=${encodeURIComponent(prefix)}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request("GET", path(`/orders?search=absent-${randomUUID()}`))).body
        .items,
    ).toEqual([]);
  });
});

import { provisionLegacyWorkspace as provisionWorkspace } from "./fixtures/legacy-workspace";
import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import contacts from "../modules/contacts/module";
import projects from "../modules/projects/module";
import { createApp } from "../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
} from "../packages/server-core/src";
const db = connectDatabase();
let server: Awaited<ReturnType<typeof createApp>>,
  workspace: string,
  foreign: string,
  headers: Record<string, string>;
async function call(
  moduleId: string,
  resource: string,
  action: string,
  input: unknown,
  key = randomUUID(),
  moduleVersion?: string,
) {
  const res = await server.app.inject({
    method: "POST",
    url: `/api/v1/module/${moduleId}/workspaces/${workspace}/records`,
    headers: {
      ...headers,
      "idempotency-key": key,
      ...(moduleVersion === undefined
        ? {}
        : { "x-module-version": moduleVersion }),
    },
    payload: { action, resource, input },
  });
  return { status: res.statusCode, body: res.json() };
}
beforeAll(async () => {
  server = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
  const user = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    name: "Module owner",
    email: `${randomUUID()}@test.local`,
    emailVerified: true,
  });
  workspace = randomUUID();
  foreign = randomUUID();
  for (const id of [workspace, foreign])
    await inWorkspace(db, id, (tx) =>
      provisionWorkspace(tx, {
        id,
        userId: user.id,
        name: "Module test",
        kind: "company",
      }),
    );
  const session = await server.auth.issue(user.id, true);
  headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
});
afterAll(async () => {
  await server.app.close();
  await db.destroy();
});
describe("Public module runtime", () => {
  it("rejects stale new writes and attempts to relabel an idempotent request", async () => {
    const id = randomUUID(),
      key = randomUUID();
    const input = {
      id,
      data: {
        name: "Versioned company",
        kind: "organization",
        relationship: "customer",
      },
    };
    const stale = await call(
      "contacts",
      "contacts",
      "create",
      input,
      key,
      "0.0.1",
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("MODULE_UPDATE_REQUIRED");
    expect(
      await inWorkspace(db, workspace, (tx) =>
        tx
          .selectFrom("suite.module_records")
          .select("id")
          .where("id", "=", id)
          .execute(),
      ),
    ).toEqual([]);
    const accepted = await call(
      "contacts",
      "contacts",
      "create",
      input,
      key,
      contacts.version,
    );
    expect(accepted.status).toBe(200);
    expect(
      (
        await call(
          "contacts",
          "contacts",
          "create",
          input,
          key,
          contacts.version,
        )
      ).body,
    ).toEqual(accepted.body);
    expect(
      (await call("contacts", "contacts", "create", input, key, "0.0.1")).body
        .code,
    ).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      (await call("contacts", "contacts", "create", input, key)).body.code,
    ).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      (
        await call(
          "contacts",
          "contacts",
          "list",
          {},
          randomUUID(),
          "bad,version",
        )
      ).status,
    ).toBe(400);
    // Legacy persisted work keeps its original unversioned hash; never relabel it as a new release.
    const legacyId = randomUUID(),
      legacyKey = randomUUID();
    const legacy = { ...input, id: legacyId };
    const first = await call(
      "contacts",
      "contacts",
      "create",
      legacy,
      legacyKey,
    );
    expect(first.status).toBe(200);
    expect(
      (await call("contacts", "contacts", "create", legacy, legacyKey)).body,
    ).toEqual(first.body);
  });
  it("rechecks current resource permissions before replaying versioned and legacy receipts", async () => {
    const attempts = [];
    for (const version of [undefined, contacts.version]) {
      const input = {
        id: randomUUID(),
        data: {
          name: "Protected receipt",
          kind: "person",
          relationship: "customer",
        },
      };
      const key = randomUUID();
      const accepted = await call(
        "contacts",
        "contacts",
        "create",
        input,
        key,
        version,
      );
      expect(accepted.status).toBe(200);
      attempts.push({ input, key, version, accepted });
    }
    const roles = await inWorkspace(db, workspace, async (tx) => {
      const rows = await tx
        .selectFrom("suite.roles")
        .select(["id", "permissions"])
        .where("workspace_id", "=", workspace)
        .execute();
      for (const role of rows)
        await tx
          .updateTable("suite.roles")
          .set({
            permissions: role.permissions.filter(
              (p) => p !== "contacts.contacts.write",
            ),
          })
          .where("id", "=", role.id)
          .execute();
      return rows;
    });
    try {
      for (const attempt of attempts) {
        const denied = await call(
          "contacts",
          "contacts",
          "create",
          attempt.input,
          attempt.key,
          attempt.version,
        );
        expect(denied.status).toBe(403);
        expect(denied.body.code).toBe("FORBIDDEN");
        expect(denied.body.data).toBeUndefined();
      }
      // The remaining read permission still works independently.
      expect((await call("contacts", "contacts", "list", {})).status).toBe(200);
    } finally {
      await inWorkspace(db, workspace, async (tx) => {
        for (const role of roles)
          await tx
            .updateTable("suite.roles")
            .set({ permissions: role.permissions })
            .where("id", "=", role.id)
            .execute();
      });
    }
    for (const attempt of attempts) {
      const recovered = await call(
        "contacts",
        "contacts",
        "create",
        attempt.input,
        attempt.key,
        attempt.version,
      );
      expect(recovered.status).toBe(200);
      expect(recovered.body).toEqual(attempt.accepted.body);
      const records = await inWorkspace(db, workspace, (tx) =>
        tx
          .selectFrom("suite.module_records")
          .select("id")
          .where("id", "=", attempt.input.id)
          .execute(),
      );
      expect(records).toHaveLength(1);
    }
  });
  it("validates schemas before persistence", async () => {
    const result = await call("contacts", "contacts", "create", {
      id: randomUUID(),
      data: { name: "Bad", kind: "unknown", relationship: "customer" },
    });
    expect(result.status).toBe(400);
  });
  it("preserves tenant isolation and deduplicates queued writes", async () => {
    const id = randomUUID(),
      key = randomUUID(),
      input = {
        id,
        data: { name: "Acme", kind: "organization", relationship: "customer" },
      };
    const first = await call("contacts", "contacts", "create", input, key),
      retry = await call("contacts", "contacts", "create", input, key);
    expect(first.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    const rows = await inWorkspace(db, foreign, (tx) =>
      tx
        .selectFrom("suite.module_records")
        .selectAll()
        .where("id", "=", id)
        .execute(),
    );
    expect(rows).toEqual([]);
  });
  it("merges disjoint edits against server history and rejects conflicting writes", async () => {
    const data = {
      name: "Acme",
      kind: "organization",
      relationship: "customer",
      phone: "1",
    };
    const created = await call("contacts", "contacts", "create", {
      id: randomUUID(),
      data,
    });
    expect(created.status).toBe(200);
    const id = created.body.id;
    expect(
      (
        await call("contacts", "contacts", "update", {
          id,
          data: { ...data, phone: "2" },
          baseVersion: 1,
        })
      ).status,
    ).toBe(200);
    const merged = await call("contacts", "contacts", "update", {
      id,
      data: { ...data, name: "Acme Ltd" },
      baseVersion: 1,
      baseData: { fake: "ignored" },
    });
    expect(merged.status).toBe(200);
    expect(merged.body.data.phone).toBe("2");
    const conflict = await call("contacts", "contacts", "update", {
      id,
      data: { ...data, phone: "3" },
      baseVersion: 1,
    });
    expect(conflict.status).toBe(412);
  });
  it("enforces cross-module grants independently of module assignment", async () => {
    const contact = await call("contacts", "contacts", "create", {
      id: randomUUID(),
      data: { name: "Customer", kind: "person", relationship: "customer" },
    });
    const project = {
      id: randomUUID(),
      data: { name: "Project", status: "active", contactId: contact.body.id },
    };
    expect((await call("projects", "projects", "create", project)).status).toBe(
      403,
    );
    await inWorkspace(db, workspace, (tx) =>
      tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: workspace,
          key: "grant:projects:contacts",
          value: { read: true },
          version: 1,
        })
        .execute(),
    );
    expect((await call("projects", "projects", "create", project)).status).toBe(
      200,
    );
  });
  it("protects append-only notes and rechecks suspension", async () => {
    const contact = await call("contacts", "contacts", "create", {
      id: randomUUID(),
      data: { name: "Customer", kind: "person", relationship: "customer" },
    });
    const note = await call("contacts", "notes", "create", {
      id: randomUUID(),
      data: { contactId: contact.body.id, text: "Original" },
    });
    expect(note.status).toBe(200);
    expect(
      (
        await call("contacts", "notes", "update", {
          id: note.body.id,
          data: { contactId: contact.body.id, text: "Changed" },
          baseVersion: 1,
        })
      ).status,
    ).toBe(409);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.module_activations")
        .set({ state: "suspended" })
        .where("workspace_id", "=", workspace)
        .where("module_id", "=", "contacts")
        .execute(),
    );
    expect((await call("contacts", "contacts", "list", {})).status).toBe(403);
  });
});

describe("Subscription authority", () => {
  it("updates entitlements and seat limits from confirmed subscription state", async () => {
    const { applySubscription } = await import("../apps/api/src/billing");
    await inWorkspace(db, foreign, async (tx) => {
      await tx
        .insertInto("suite.billing_accounts")
        .values({
          workspace_id: foreign,
          customer_id: "cus_" + randomUUID(),
          subscription_id: null,
          status: "pending",
          last_event_at: 0,
          updated_at: new Date(),
        })
        .execute();
      await applySubscription(
        tx,
        foreign,
        {
          id: "sub_" + foreign,
          status: "active",
          items: { data: [{ price: { id: "price_contacts" }, quantity: 7 }] },
        },
        { contacts: "price_contacts", projects: "price_projects" },
      );
      const entitlements = await tx
        .selectFrom("suite.entitlements")
        .selectAll()
        .where("workspace_id", "=", foreign)
        .execute();
      expect(entitlements.find((e) => e.module_id === "contacts")?.active).toBe(
        true,
      );
      expect(entitlements.find((e) => e.module_id === "projects")?.active).toBe(
        false,
      );
      expect(
        (
          await tx
            .selectFrom("suite.workspaces")
            .select("seat_limit")
            .where("id", "=", foreign)
            .executeTakeFirstOrThrow()
        ).seat_limit,
      ).toBe(7);
      await applySubscription(
        tx,
        foreign,
        {
          id: "sub_" + foreign,
          status: "past_due",
          items: { data: [{ price: { id: "price_contacts" }, quantity: 7 }] },
        },
        { contacts: "price_contacts" },
      );
      expect(
        (
          await tx
            .selectFrom("suite.entitlements")
            .select("active")
            .where("workspace_id", "=", foreign)
            .where("module_id", "=", "contacts")
            .executeTakeFirstOrThrow()
        ).active,
      ).toBe(false);
    });
  });
});

describe("Typed business operations", () => {
  it("reserves atomically and makes SDK fulfillment retries idempotent", async () => {
    const { createModuleClient } = await import("@suite/module-sdk");
    const inventory = (
      await import("../modules/inventory/releases/1.2.0/module")
    ).default;
    const orders = (await import("../modules/orders/releases/1.1.0/module"))
      .default;
    const send = async (call: import("@suite/module-sdk").ModuleCall) => {
      const res = await server.app.inject({
        method: "POST",
        url: `/api/v1/module/${call.moduleId}/workspaces/${foreign}/operations/${call.operation}`,
        headers: { ...headers, "idempotency-key": call.key! },
        payload: call.input as object,
      });
      if (res.statusCode !== 200)
        throw Object.assign(new Error(res.json().message), {
          status: res.statusCode,
        });
      return res.json();
    };
    // The preceding billing exercise suspended Contacts only; Inventory and Orders retain their entitlements.
    const stock = createModuleClient(inventory, send),
      sales = createModuleClient(orders, send);
    const product = await stock.call("create-product", {
      sku: "SDK-" + randomUUID().slice(0, 8),
      name: "SDK stock",
      priceMinor: 100,
    });
    await stock.call("stock", {
      id: product.id,
      kind: "receipt",
      quantity: 3,
      reason: "Opening stock",
    });
    const draft = {
      customerName: "SDK buyer",
      lines: [{ productId: product.id, quantity: 2, priceMinor: 100 }],
    };
    const [a, b] = await Promise.all([
      sales.call("draft", draft),
      sales.call("draft", draft),
    ]);
    const reservations = await Promise.allSettled([
      sales.call("confirm", { id: a.id, version: a.version }),
      sales.call("confirm", { id: b.id, version: b.version }),
    ]);
    expect(reservations.filter((r) => r.status === "fulfilled")).toHaveLength(
      1,
    );
    const confirmed = reservations.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<typeof a>;
    const key = randomUUID();
    const input = { id: confirmed.value.id, version: confirmed.value.version };
    const first = await sales.call("fulfill", input, key),
      retry = await sales.call("fulfill", input, key);
    expect(retry).toEqual(first);
    expect(first.status).toBe("fulfilled");
    const audits = await inWorkspace(db, foreign, (tx) =>
      tx
        .selectFrom("suite.audit")
        .select("id")
        .where("workspace_id", "=", foreign)
        .where("target_id", "=", first.id)
        .where("action", "=", "orders.fulfilled")
        .execute(),
    );
    expect(audits).toHaveLength(1);
  });
});

describe("Physical stock counts and pinned backends", () => {
  it("rejects stale counts, preserves reservations, and records a zero-variance count once", async () => {
    const { createModuleClient } = await import("@suite/module-sdk");
    const inventory = (
      await import("../modules/inventory/releases/1.2.0/module")
    ).default;
    const send = async (call: import("@suite/module-sdk").ModuleCall) => {
      const response = await server.app.inject({
        method: "POST",
        url: `/api/v1/module/inventory/workspaces/${foreign}/operations/${call.operation}`,
        headers: { ...headers, "idempotency-key": call.key! },
        payload: call.input as object,
      });
      if (response.statusCode !== 200)
        throw Object.assign(Error(response.json().message), response.json(), {
          status: response.statusCode,
        });
      return response.json();
    };
    const stock = createModuleClient(inventory, send);
    const product = await stock.call("create-product", {
      sku: "COUNT-" + randomUUID().slice(0, 8),
      name: "Counted product",
      priceMinor: 1,
    });
    const received = await stock.call("stock", {
      id: product.id,
      kind: "receipt",
      quantity: 10,
      reason: "Opening count",
    });
    await expect(
      stock.call("count", {
        id: product.id,
        stockVersion: product.stockVersion,
        counted: 5,
        reason: "Stale count",
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const key = randomUUID(),
      input = {
        id: product.id,
        stockVersion: received.stockVersion,
        counted: 10,
        reason: "Physical count",
      };
    const counted = await stock.call("count", input, key);
    expect(counted.onHand).toBe(10);
    expect(counted.stockVersion).toBe(received.stockVersion + 1);
    expect(await stock.call("count", input, key)).toEqual(counted);
    const entries = await inWorkspace(db, foreign, (tx) =>
      tx
        .selectFrom("suite.stock_counts")
        .selectAll()
        .where("workspace_id", "=", foreign)
        .where("product_id", "=", product.id)
        .execute(),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].previous_on_hand).toBe(entries[0].counted_on_hand);
    // Use the actual Orders endpoint to establish reservations with a valid order reference.
    const order = await server.app.inject({
      method: "POST",
      url: `/api/v1/module/orders/workspaces/${foreign}/operations/draft`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: {
        customerName: "Count buyer",
        lines: [{ productId: product.id, quantity: 8, priceMinor: 1 }],
      },
    });
    expect(order.statusCode).toBe(200);
    const confirmed = await server.app.inject({
      method: "POST",
      url: `/api/v1/module/orders/workspaces/${foreign}/operations/confirm`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { id: order.json().id, version: order.json().version },
    });
    expect(confirmed.statusCode).toBe(200);
    await expect(
      stock.call("count", {
        id: product.id,
        stockVersion: counted.stockVersion + 1,
        counted: 7,
        reason: "Reserved shortfall",
      }),
    ).rejects.toMatchObject({ code: "RESERVED_STOCK" });
    const corrected = await stock.call("count", {
      id: product.id,
      stockVersion: counted.stockVersion + 1,
      counted: 9,
      reason: "One damaged unit",
    });
    expect(corrected.onHand).toBe(9);
    expect(corrected.reserved).toBe(8);
    expect(corrected.available).toBe(1);
  });
  it("continues serving the staged 1.1 backend while another workspace uses 1.2", async () => {
    await inWorkspace(db, foreign, (tx) =>
      tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: foreign,
          key: "pin:inventory",
          value: { version: "1.1.0" },
          version: 1,
        })
        .execute(),
    );
    try {
      const result = await server.app.inject({
        method: "POST",
        url: `/api/v1/module/inventory/workspaces/${foreign}/operations/products`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: {},
      });
      expect(result.statusCode).toBe(200);
      const unsupported = await server.app.inject({
        method: "POST",
        url: `/api/v1/module/inventory/workspaces/${foreign}/operations/count`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: {},
      });
      expect(unsupported.statusCode).toBe(404);
    } finally {
      await inWorkspace(db, foreign, (tx) =>
        tx
          .deleteFrom("suite.platform_settings")
          .where("workspace_id", "=", foreign)
          .where("key", "=", "pin:inventory")
          .execute(),
      );
    }
  });
});

describe("Workspace member references", () => {
  it("lists active members and rejects foreign assignees", async () => {
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.module_activations")
        .set({ state: "enabled" })
        .where("workspace_id", "=", workspace)
        .where("module_id", "=", "contacts")
        .execute(),
    );
    const directory = await server.app.inject({
      method: "GET",
      url: `/api/v1/module/projects/workspaces/${workspace}/members/tasks/assigneeId`,
      headers: { ...headers, "x-module-version": projects.version },
    });
    expect(directory.statusCode).toBe(200);
    const staleDirectory = await server.app.inject({
      method: "GET",
      url: `/api/v1/module/projects/workspaces/${workspace}/members/tasks/assigneeId`,
      headers: { ...headers, "x-module-version": "0.0.1" },
    });
    expect(staleDirectory.statusCode).toBe(409);
    expect(staleDirectory.json().code).toBe("MODULE_UPDATE_REQUIRED");
    expect(directory.json().items).toHaveLength(1);
    const memberId = directory.json().items[0].id;
    const project = await call("projects", "projects", "create", {
      data: { name: "Assigned project", status: "active" },
    });
    expect(project.status).toBe(200);
    const data = {
      projectId: project.body.id,
      title: "Assigned task",
      status: "todo",
      assigneeId: memberId,
    };
    expect((await call("projects", "tasks", "create", { data })).status).toBe(
      200,
    );
    const foreignMember = await inWorkspace(db, foreign, (tx) =>
      tx
        .selectFrom("suite.memberships")
        .select("id")
        .where("workspace_id", "=", foreign)
        .executeTakeFirstOrThrow(),
    );
    const invalid = await call("projects", "tasks", "create", {
      data: { ...data, assigneeId: foreignMember.id },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("INVALID_MEMBER");
    const unrelated = await server.app.inject({
      method: "GET",
      url: `/api/v1/module/projects/workspaces/${workspace}/members/projects/name`,
      headers,
    });
    expect(unrelated.statusCode).toBe(400);
  });
});

describe("Actionable notification inbox", () => {
  it("offers current access decisions and shows the authoritative result after approval", async () => {
    const requestId = randomUUID(),
      notificationId = randomUUID();
    // Seed delivered outbox evidence; the existing worker tests cover delivery and deduplication.
    await inWorkspace(db, workspace, async (tx) => {
      const member = await tx
        .selectFrom("suite.memberships")
        .selectAll()
        .where("workspace_id", "=", workspace)
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("suite.access_requests")
        .values({
          id: requestId,
          workspace_id: workspace,
          membership_id: member.id,
          module_id: "projects",
          reason: "Project planning",
          state: "pending",
        })
        .execute();
      const eventId = randomUUID();
      await tx
        .insertInto("suite.outbox")
        .values({
          id: eventId,
          workspace_id: workspace,
          actor_id: member.user_id,
          event_type: "access.requested",
          payload: { recordId: requestId },
          completed_at: new Date(),
          locked_until: null,
          claim_token: null,
          failed_at: null,
          last_error: null,
        })
        .execute();
      await tx
        .insertInto("suite.notifications")
        .values({
          id: notificationId,
          workspace_id: workspace,
          user_id: member.user_id,
          event_id: eventId,
          title: "Module access requested",
          message: "Review this request.",
          read_at: null,
        })
        .execute();
    });
    const inbox = () =>
      server.app.inject({
        method: "GET",
        url: `/api/v1/workspaces/${workspace}/notifications`,
        headers,
      });
    const before = (await inbox())
      .json()
      .find((n: { id: string }) => n.id === notificationId);
    expect(before.action).toMatchObject({
      id: requestId,
      state: "pending",
      moduleId: "projects",
      reason: "Project planning",
    });
    const decision = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/workspaces/${workspace}/access-requests/${requestId}`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { state: "approved" },
    });
    expect(decision.statusCode).toBe(200);
    const after = (await inbox())
      .json()
      .find((n: { id: string }) => n.id === notificationId);
    expect(after.action.state).toBe("approved");
  });
});

describe("Notification policy inheritance", () => {
  it("excludes a role whose ordinary notification grant is explicitly denied", async () => {
    const { permissionRecipients } =
      await import("../packages/server-core/src");
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      name: "Denied manager",
      email: `${randomUUID()}@test.local`,
      emailVerified: true,
    });
    await inWorkspace(db, foreign, async (tx) => {
      const membership = randomUUID(),
        role = randomUUID();
      await tx
        .insertInto("suite.memberships")
        .values({ id: membership, workspace_id: foreign, user_id: user.id })
        .execute();
      await tx
        .insertInto("suite.roles")
        .values({
          id: role,
          workspace_id: foreign,
          name: "Delegated manager",
          permissions: ["modules.manage"],
        })
        .execute();
      await tx
        .insertInto("suite.role_assignments")
        .values({
          workspace_id: foreign,
          membership_id: membership,
          role_id: role,
        })
        .execute();
      expect(
        await permissionRecipients(tx, foreign, "modules.manage"),
      ).toContain(user.id);
      const roles = await tx
        .selectFrom("suite.roles")
        .select(["id", "name"])
        .where("workspace_id", "=", foreign)
        .execute();
      const root = roles.find((r) => r.name === "Owner")!.id;
      await tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: foreign,
          key: "organization",
          version: 1,
          value: {
            rootId: root,
            ranks: roles.map((r) => ({
              id: r.id,
              name: r.id === root ? "Administrador" : r.name,
              parents: r.id === root ? [] : [root],
              inherit: false,
              denies: [],
              x: 0,
              y: 0,
            })),
            groups: [
              {
                id: randomUUID(),
                name: "Restricted",
                rankIds: [role],
                tags: [],
                grants: [],
                denies: ["modules.manage"],
              },
            ],
          },
        })
        .execute();
      expect(
        await permissionRecipients(tx, foreign, "modules.manage"),
      ).not.toContain(user.id);
    });
  });
});

describe("Employee release policy", () => {
  it("exposes version pins needed for employee installation without exposing administrative configuration", async () => {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      name: "Pinned client",
      email: `${randomUUID()}@test.local`,
      emailVerified: true,
    });
    await inWorkspace(db, foreign, async (tx) => {
      const member = randomUUID(),
        role = randomUUID();
      await tx
        .insertInto("suite.memberships")
        .values({ id: member, workspace_id: foreign, user_id: user.id })
        .execute();
      await tx
        .insertInto("suite.roles")
        .values({
          id: role,
          workspace_id: foreign,
          name: "Pinned reader",
          permissions: ["inventory.read"],
        })
        .execute();
      await tx
        .insertInto("suite.role_assignments")
        .values({ workspace_id: foreign, membership_id: member, role_id: role })
        .execute();
      await tx
        .insertInto("suite.module_assignments")
        .values({
          workspace_id: foreign,
          membership_id: member,
          module_id: "inventory",
        })
        .execute();
      await tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: foreign,
          key: "pin:inventory",
          value: { version: "1.1.0", mandatory: true },
          version: 1,
        })
        .execute();
    });
    const session = await server.auth.issue(user.id, false);
    const state = await server.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${foreign}/platform`,
      headers: { cookie: `suite_session=${session.token}` },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().settings).toContainEqual(
      expect.objectContaining({
        key: "pin:inventory",
        value: { version: "1.1.0", mandatory: true },
      }),
    );
    expect(state.json().config).toEqual([]);
    expect(state.json().organization).toBeNull();
  });
});

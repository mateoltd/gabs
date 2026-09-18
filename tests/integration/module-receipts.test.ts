import "dotenv/config";
import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { provisionLegacyWorkspace as provisionWorkspace } from "../fixtures/legacy-workspace";
import {
  connectDatabase,
  identify,
  inWorkspace,
} from "../../composition/src/server/product";

it("reads only committed same-account module receipts under current workspace and operation permissions", async () => {
  const db = connectDatabase();
  const server = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
  try {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Receipt owner",
      emailVerified: true,
    });
    const workspace = randomUUID(),
      foreign = randomUUID();
    for (const id of [workspace, foreign])
      await inWorkspace(db, id, (tx) =>
        provisionWorkspace(tx, {
          id,
          userId: user.id,
          name: "Receipts",
          kind: "company",
        }),
      );
    const headers = async (userId = user.id) => {
      const session = await server.auth.issue(userId, true);
      return {
        cookie: `suite_session=${session.token}`,
        origin: "http://localhost:4300",
        "x-csrf-token": session.csrfToken,
      };
    };
    const source = await headers(),
      receiving = await headers();
    const acceptedVersion = async (moduleId: string) => {
      const response = await server.app.inject({
        method: "GET",
        url: `/api/v1/module/${moduleId}/workspaces/${workspace}/artifact`,
        headers: source,
      });
      expect(response.statusCode).toBe(200);
      return response.json().version as string;
    };
    const key = randomUUID(),
      operationKey = randomUUID(),
      absent = randomUUID();
    const created = await server.app.inject({
      method: "POST",
      url: `/api/v1/module/contacts/workspaces/${workspace}/records`,
      headers: {
        ...source,
        "idempotency-key": key,
        "x-module-version": await acceptedVersion("contacts"),
      },
      payload: {
        resource: "contacts",
        action: "create",
        input: {
          data: {
            name: "Received reference",
            kind: "person",
            relationship: "customer",
          },
        },
      },
    });
    expect(created.statusCode, created.body).toBe(200);
    const operation = await server.app.inject({
      method: "POST",
      url: `/api/v1/module/inventory/workspaces/${workspace}/operations/create-product`,
      headers: {
        ...source,
        "idempotency-key": operationKey,
        "x-module-version": await acceptedVersion("inventory"),
      },
      payload: { sku: randomUUID(), name: "Remote product", priceMinor: 100 },
    });
    expect(operation.statusCode, operation.body).toBe(200);
    const lookup = (
      keys: string[],
      workspaceId = workspace,
      auth = receiving,
    ) =>
      server.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${workspaceId}/module-receipts`,
        headers: auth,
        payload: { keys },
      });
    expect((await lookup([key, operationKey, absent])).json()).toEqual({
      accepted: [key, operationKey],
    });
    expect((await lookup([key], foreign)).json()).toEqual({ accepted: [] });
    const secondUser = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Another member",
      emailVerified: true,
    });
    await inWorkspace(db, workspace, (tx) =>
      tx
        .insertInto("suite.memberships")
        .values({
          id: randomUUID(),
          workspace_id: workspace,
          user_id: secondUser.id,
        })
        .execute(),
    );
    expect(
      (
        await lookup(
          [key, operationKey],
          workspace,
          await headers(secondUser.id),
        )
      ).json(),
    ).toEqual({ accepted: [] });
    expect((await lookup([key], randomUUID())).statusCode).toBe(403);
    expect((await lookup(["short"])).statusCode).toBe(400);
    expect(
      (await lookup(Array.from({ length: 101 }, () => randomUUID())))
        .statusCode,
    ).toBe(400);
    expect((await lookup([key, key])).statusCode).toBe(400);
    const oldArtifact = await server.app.inject({
      method: "GET",
      url: `/api/v1/module/inventory/workspaces/${workspace}/receipt-artifact?version=1.1.0`,
      headers: receiving,
    });
    expect(oldArtifact.statusCode, oldArtifact.body).toBe(200);
    expect(oldArtifact.json()).toMatchObject({
      module_id: "inventory",
      version: "1.1.0",
    });
    expect(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/v1/module/inventory/workspaces/${workspace}/receipt-artifact?version=9.0.0`,
          headers: receiving,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/v1/module/inventory/workspaces/${workspace}/receipt-artifact?version=1.1.0`,
          headers: await headers(secondUser.id),
        })
      ).statusCode,
    ).toBe(403);
    const administrative = randomUUID();
    await inWorkspace(db, workspace, (tx) =>
      tx
        .insertInto("suite.idempotency")
        .values({
          workspace_id: workspace,
          actor_id: user.id,
          key: administrative,
          operation: "platform.install",
          request_hash: "fixture",
          response: JSON.stringify({ private: "Never disclose" }),
        })
        .execute(),
    );
    expect((await lookup([administrative, key])).json()).toEqual({
      accepted: [key],
    });
    await inWorkspace(db, workspace, async (tx) => {
      const roles = await tx
        .selectFrom("suite.roles")
        .select(["id", "permissions"])
        .execute();
      for (const role of roles)
        await tx
          .updateTable("suite.roles")
          .set({
            permissions: role.permissions.filter(
              (p) => p !== "contacts.contacts.read",
            ),
          })
          .where("id", "=", role.id)
          .execute();
    });
    expect((await lookup([key, operationKey])).json()).toEqual({
      accepted: [operationKey],
    });
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.entitlements")
        .set({ active: false })
        .where("workspace_id", "=", workspace)
        .where("module_id", "=", "inventory")
        .execute(),
    );
    expect((await lookup([key, operationKey])).json()).toEqual({
      accepted: [],
    });
    const state = await inWorkspace(db, workspace, async (tx) => ({
      records: await tx
        .selectFrom("suite.module_records")
        .selectAll()
        .where("module_id", "=", "contacts")
        .execute(),
      audit: await tx
        .selectFrom("suite.audit")
        .selectAll()
        .where("action", "=", "contacts.contacts.create")
        .execute(),
      receipts: await tx
        .selectFrom("suite.idempotency")
        .selectAll()
        .where("key", "in", [key, operationKey])
        .execute(),
    }));
    expect(state.records).toHaveLength(1);
    expect(state.audit).toHaveLength(1);
    expect(state.receipts).toHaveLength(2);
    await inWorkspace(db, workspace, (tx) =>
      tx
        .updateTable("suite.memberships")
        .set({ active: false })
        .where("user_id", "=", user.id)
        .execute(),
    );
    expect((await lookup([key])).statusCode).toBe(403);
  } finally {
    await server.app.close();
    await db.destroy();
  }
});

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { createApp } from "../../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
import { createModuleClient, type ModuleCall } from "@suite/module-sdk";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import orders from "../../modules/orders/module";
import inventory from "../../modules/inventory/module";
import type { Platform } from "../../packages/client/src";
import { ApiError } from "../../packages/client/src/api";
import { createModuleQueue } from "../../packages/client/src/modules/queued";
import {
  changeModuleStorage,
  readModuleStorage,
  syncModuleStorage,
} from "../../packages/client/src/modules/storage";

it("replays a durably captured Orders command after a lost accepted response without duplicate orders or audits", async () => {
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
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (key: string, run: () => Promise<unknown>) => {
        const promise = (locks.get(key) ?? Promise.resolve())
          .catch(() => undefined)
          .then(run);
        locks.set(key, promise);
        return promise;
      },
    },
  });
  try {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Queued owner",
      emailVerified: true,
    });
    const scope = { userId: user.id, workspaceId: randomUUID() };
    await inWorkspace(db, scope.workspaceId, (tx) =>
      provisionWorkspace(tx, {
        id: scope.workspaceId,
        userId: user.id,
        name: "Queued acceptance",
        kind: "company",
      }),
    );
    const session = await server.auth.issue(user.id, true);
    const headers = {
      cookie: `suite_session=${session.token}`,
      origin: "http://localhost:4300",
      "x-csrf-token": session.csrfToken,
    };
    const send = async (call: ModuleCall) => {
      const reply = await server.app.inject({
        method: "POST",
        url: `/api/v1/module/${call.moduleId}/workspaces/${scope.workspaceId}/operations/${call.operation}`,
        headers: {
          ...headers,
          "idempotency-key": call.key!,
          "x-module-version": call.moduleVersion!,
        },
        payload: call.input as object,
      });
      const body = reply.json();
      if (reply.statusCode >= 400)
        throw new ApiError(
          reply.statusCode,
          body.code,
          body.message,
          undefined,
          body.detail,
        );
      return body;
    };
    const product = await createModuleClient(inventory, send).call(
      "create-product",
      { sku: randomUUID(), name: "Queued product", priceMinor: 125 },
    );
    const artifact = await server.app.inject({
      method: "GET",
      url: `/api/v1/module/orders/workspaces/${scope.workspaceId}/artifact`,
      headers,
    });
    expect(artifact.statusCode, artifact.body).toBe(200);
    const pkg = artifact.json<SignedArtifact>();
    expect(pkg.version).toBe(orders.version);
    const trust = await server.app.inject({
      method: "GET",
      url: "/api/v1/module-trust",
      headers,
    });
    expect(trust.statusCode).toBe(200);
    const records = new Map<string, unknown>();
    const platform: Platform = {
      kind: "web",
      pruneModuleArtifacts: async () => {},
      load: async <T>(
        scope: { userId: string; workspaceId: string },
        key: string,
      ) =>
        structuredClone(
          records.get(`${scope.userId}/${scope.workspaceId}/${key}`),
        ) as T | undefined,
      save: async (
        scope: { userId: string; workspaceId: string },
        key: string,
        value: unknown,
      ) => {
        records.set(
          `${scope.userId}/${scope.workspaceId}/${key}`,
          structuredClone(value),
        );
      },
      purgeWorkspace: async () => {},
      purgeUser: async () => {},
      identity: async () => undefined,
      rememberIdentity: async () => {},
      saveFile: async () => {},
      notify: async () => {},
    };
    await changeModuleStorage(platform, scope, (state) => {
      state.installed.orders = {
        version: pkg.version,
        artifact: pkg.artifact,
        signed: pkg,
        publicKey: trust.json().publicKey,
        verifiedAt: Date.now(),
      };
    });
    const input = {
      customerName: "Saved offline",
      lines: [{ productId: product.id, quantity: 2, priceMinor: 125 }],
    };
    const client = createModuleClient(
      orders,
      send,
      createModuleQueue(platform, scope, () => true),
    );
    const captured = await client.queue("draft", input, {
      key: `offline:orders/${randomUUID()}`,
    });
    expect(captured).toMatchObject({
      state: "pending",
      delivery: "unsubmitted",
    });
    let committed: unknown;
    await syncModuleStorage(
      platform,
      scope,
      async (call) => {
        committed = await send(call);
        throw Error("Successful reply lost");
      },
      () => true,
    );
    expect(await client.queued("draft", captured.key)).toMatchObject({
      state: "pending",
      delivery: "uncertain",
    });
    const restarted = createModuleClient(
      orders,
      send,
      createModuleQueue(platform, scope, () => true),
    );
    await syncModuleStorage(platform, scope, send, () => true);
    const accepted = await restarted.queued("draft", captured.key);
    expect(accepted).toMatchObject({ state: "accepted", value: committed });
    expect(
      await restarted.queue("draft", input, { key: captured.key }),
    ).toEqual(accepted);
    const state = await inWorkspace(db, scope.workspaceId, async (tx) => ({
      orders: await tx
        .selectFrom("suite.module_records")
        .selectAll()
        .where("module_id", "=", "orders")
        .where("resource", "=", "$orders")
        .execute(),
      audits: await tx
        .selectFrom("suite.audit")
        .selectAll()
        .where("action", "=", "orders.created")
        .execute(),
      receipts: await tx
        .selectFrom("suite.idempotency")
        .selectAll()
        .where("key", "=", captured.key)
        .execute(),
    }));
    expect(state.orders).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
    expect((await readModuleStorage(platform, scope)).journal).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    await server.app.close();
    await db.destroy();
  }
});

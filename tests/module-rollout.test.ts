import "dotenv/config";
import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../packages/server-core/src";

it("dispatches accepted pinned client contracts and enforces mandatory updates before receipts", async () => {
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
      name: "Rollout operator",
      emailVerified: true,
    });
    const workspace = randomUUID();
    await inWorkspace(db, workspace, (tx) =>
      provisionWorkspace(tx, {
        id: workspace,
        userId: user.id,
        name: "Rollout acceptance",
        kind: "company",
      }),
    );
    const session = await server.auth.issue(user.id, true);
    const headers = {
      cookie: `suite_session=${session.token}`,
      origin: "http://localhost:4300",
      "x-csrf-token": session.csrfToken,
    };
    let revision = 0;
    const policy = async (
      mandatory: boolean,
      acceptedVersions: string[],
      target = "1.2.0",
    ) => {
      const response = await server.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${workspace}/platform`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: {
          action: "rollout",
          version: revision,
          value: {
            moduleId: "inventory",
            version: target,
            mandatory,
            acceptedVersions,
          },
        },
      });
      if (response.statusCode === 200) revision++;
      return response;
    };
    const operation = (
      name: string,
      version: string | undefined,
      input: Record<string, unknown> = {},
      key = randomUUID(),
    ) =>
      server.app.inject({
        method: "POST",
        url: `/api/v1/module/inventory/workspaces/${workspace}/operations/${name}`,
        headers: {
          ...headers,
          "idempotency-key": key,
          ...(version ? { "x-module-version": version } : {}),
        },
        payload: input,
      });
    expect((await policy(false, ["9.9.9"])).statusCode).toBe(409);
    expect((await policy(true, ["1.1.0"])).statusCode).toBe(400);
    expect((await policy(false, ["1.1.0"])).statusCode).toBe(200);
    expect((await operation("products", "1.1.0")).statusCode).toBe(200);
    expect((await operation("products", "1.2.0")).statusCode).toBe(200);
    expect((await operation("products", undefined)).json().code).toBe(
      "MODULE_UPDATE_REQUIRED",
    );
    expect((await operation("count", "1.1.0")).statusCode).toBe(404); // The old contract has no count operation.
    const key = randomUUID();
    const input = {
      sku: `ROLLOUT-${randomUUID().slice(0, 8)}`,
      name: "Old client product",
      priceMinor: 100,
    };
    const created = await operation("create-product", "1.1.0", input, key);
    expect(created.statusCode).toBe(200);
    expect(
      (await operation("create-product", "1.1.0", input, key)).json(),
    ).toEqual(created.json());
    expect((await policy(true, [])).statusCode).toBe(200);
    expect(
      (await operation("create-product", "1.1.0", input, key)).json().code,
    ).toBe("MODULE_UPDATE_REQUIRED");
    expect(
      (await operation("create-product", "1.2.0", input, key)).json().code,
    ).toBe("IDEMPOTENCY_CONFLICT");
    expect((await operation("products", "1.2.0")).statusCode).toBe(200);
    // An old host route must report the contract it actually executes, regardless of caller headers.
    expect((await policy(true, [], "1.1.0")).statusCode).toBe(200);
    const host = await server.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspace}/products`,
      headers: { ...headers, "x-module-version": "1.1.0" },
    });
    expect(host.statusCode).toBe(409);
    expect(host.json().code).toBe("MODULE_UPDATE_REQUIRED");
    expect((await operation("products", "1.1.0")).statusCode).toBe(200);
    expect((await policy(false, ["1.1.0"])).statusCode).toBe(200);
    expect(
      (await operation("create-product", "1.1.0", input, key)).json(),
    ).toEqual(created.json());
    await inWorkspace(db, workspace, async (tx) => {
      const rows = await tx
        .selectFrom("suite.products")
        .select("id")
        .where("id", "=", created.json().id)
        .execute();
      expect(rows).toHaveLength(1);
      await tx
        .updateTable("suite.module_activations")
        .set({ state: "suspended" })
        .where("module_id", "=", "inventory")
        .execute();
    });
    expect((await operation("products", "1.1.0")).statusCode).toBe(403);
    expect((await operation("products", "1.2.0")).statusCode).toBe(403);
  } finally {
    await server.app.close();
    await db.destroy();
  }
});

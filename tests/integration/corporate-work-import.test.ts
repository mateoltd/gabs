import "dotenv/config";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
import { hashToken } from "@suite/server-core";
import { operationPath } from "../../packages/contracts/src";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import type { Platform } from "../../packages/client/src";
import { SuiteClient } from "../../packages/client/src/api";
import { stageSavedWorkImport } from "../../packages/client/src/recovery/import";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
const db = connectDatabase();
let server: Awaited<ReturnType<typeof createApp>>;
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
});
afterAll(async () => {
  await server?.app.close();
  await db.destroy();
});
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const actor = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    email: `${randomUUID()}@test.local`,
    name: "Saved-work recovery owner",
    emailVerified: true,
  });
  const scope = { userId: actor.id, workspaceId: randomUUID() };
  await inWorkspace(db, scope.workspaceId, (tx) =>
    provisionWorkspace(tx, {
      id: scope.workspaceId,
      userId: actor.id,
      name: "Corporate import",
      kind: "company",
    }),
  );
  const session = await server.auth.issue(actor.id, true);
  let cookie = session.token;
  const operations: string[] = [];
  const client = new SuiteClient(async (request) => {
    operations.push(request.operation);
    const op = operationPath(request);
    const response = await server.app.inject({
      method: op.method,
      url: op.path,
      headers: {
        cookie: `suite_session=${cookie}`,
        ...(request.expectedUserId
          ? { "x-suite-actor": request.expectedUserId }
          : {}),
      },
    });
    return {
      status: response.statusCode,
      body: response.json(),
      actorId: response.headers["x-suite-actor"] as string | undefined,
    };
  });
  const signed = await client.request({
    operation: "moduleArtifact",
    params: { workspaceId: scope.workspaceId, moduleId: "contacts" },
  });
  const id = randomUUID();
  const input: SavedWorkRecovery = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...scope,
    moduleId: "contacts",
    moduleVersion: signed.version,
    selection: "request",
    entry: {
      id,
      ...scope,
      call: {
        key: id,
        moduleId: "contacts",
        moduleVersion: signed.version,
        resource: "contacts",
        action: "create",
        input: {
          id: randomUUID(),
          data: {
            name: "Unsynchronized contact",
            kind: "person",
            relationship: "customer",
          },
        },
      },
      dependencies: [],
      createdAt: Date.now(),
      attempts: 0,
      delivery: "unsubmitted",
      state: "pending",
    },
  };
  const values = new Map<string, unknown>();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_name: string, run: () => Promise<unknown>) => run(),
    },
  });
  const platform = {
    load: async (_scope: unknown, key: string) =>
      structuredClone(values.get(key)),
    save: async (_scope: unknown, key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    pruneModuleArtifacts: async () => {},
  } as unknown as Platform;
  const options = {
    client,
    platform,
    scope,
    signal: new AbortController().signal,
    check() {},
  };
  return {
    scope,
    session,
    input,
    values,
    operations,
    stage: () => stageSavedWorkImport(options, JSON.stringify(input)),
    setCookie: (token: string) => {
      cookie = token;
    },
  };
}
it("admits a saved copy using real MFA-session, workspace policy and signed registry routes without business effects", async () => {
  const f = await fixture();
  const result = await f.stage();
  const stored = f.values.get("module-state") as ModuleStorage;
  expect(stored.recoveryImports![result.digest].input).toEqual(f.input);
  expect(stored.journal).toEqual([]);
  expect(stored.installed).toEqual({});
  expect((await f.stage()).alreadyImported).toBe(true);
  expect(f.operations.filter((op) => op === "profileRecovery")).toHaveLength(4);
  const receipts = await inWorkspace(db, f.scope.workspaceId, (tx) =>
    tx
      .selectFrom("suite.idempotency")
      .selectAll()
      .where("key", "=", f.input.entry!.id)
      .execute(),
  );
  expect(receipts).toEqual([]);
});
it("refuses expired sessions and a different authenticated account without modifying destination storage", async () => {
  const f = await fixture();
  await db
    .updateTable("suite.sessions")
    .set({ created_at: new Date(Date.now() - 360_000) })
    .where("token_hash", "=", hashToken(f.session.token))
    .execute();
  await expect(f.stage()).rejects.toMatchObject({
    code: "REAUTHENTICATION_REQUIRED",
  });
  expect(f.values.size).toBe(0);
  const other = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    email: `${randomUUID()}@test.local`,
    name: "Different owner",
    emailVerified: true,
  });
  f.setCookie((await server.auth.issue(other.id, true)).token);
  await expect(f.stage()).rejects.toMatchObject({ status: 401 });
  expect(f.values.size).toBe(0);
});
it("honors real current resource-write denial even when the source file was captured earlier", async () => {
  const f = await fixture();
  await inWorkspace(db, f.scope.workspaceId, async (tx) => {
    const roles = await tx
      .selectFrom("suite.roles")
      .select(["id", "permissions"])
      .execute();
    for (const role of roles)
      await tx
        .updateTable("suite.roles")
        .set({
          permissions: role.permissions.filter(
            (permission) => permission !== "contacts.contacts.write",
          ),
        })
        .where("id", "=", role.id)
        .execute();
  });
  await expect(f.stage()).rejects.toThrow(/access/);
  expect(f.values.size).toBe(0);
});

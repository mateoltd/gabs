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
import { assertSchema, resourceRecordSchema, Type } from "@suite/module-sdk";
import type { Platform } from "../../packages/client/src";
import { SuiteClient } from "../../packages/client/src/api";
import {
  stageSavedWorkImport,
  stageSavedWorkImports,
  promoteSavedWorkImport,
} from "../../packages/client/src/recovery/import";
import {
  sealSavedWorkArchive,
  openSavedWorkArchive,
} from "../../packages/client/src/recovery/archive";
import {
  readModuleStorage,
  type ModuleStorage,
} from "../../packages/client/src/modules/storage";
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
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
  let loseSettlement = false;
  const client = new SuiteClient(async (request) => {
    operations.push(request.operation);
    const op = operationPath(request);
    const response = await server.app.inject({
      method: op.method,
      url: op.path,
      headers: {
        cookie: `suite_session=${cookie}`,
        origin: "http://localhost:4300",
        ...(request.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
        "x-csrf-token": session.csrfToken,
        ...(request.moduleVersion
          ? { "x-module-version": request.moduleVersion }
          : {}),
        ...(request.idempotencyKey
          ? { "idempotency-key": request.idempotencyKey }
          : {}),
        ...(request.expectedUserId
          ? { "x-suite-actor": request.expectedUserId }
          : {}),
      },
      payload:
        request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    if (
      loseSettlement &&
      request.operation === "moduleAttemptSettle" &&
      response.statusCode === 200
    ) {
      loseSettlement = false;
      throw Error("Lost authoritative response");
    }
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
    client,
    read: () => readModuleStorage(platform, scope),
    promote: (digest: string) => promoteSavedWorkImport(options, digest),
    loseResponse: () => {
      loseSettlement = true;
    },
    send: () =>
      client.forUser(scope.userId).request({
        operation: "moduleRequest",
        params: { workspaceId: scope.workspaceId, moduleId: input.moduleId },
        moduleVersion: input.moduleVersion,
        idempotencyKey: input.entry.id,
        body: {
          action: input.entry.call.action,
          resource: "contacts",
          input: input.entry.call.input,
        },
      }),
    stage: (value: SavedWorkRecovery = input) =>
      stageSavedWorkImport(options, JSON.stringify(value)),
    stageBatch: (values: SavedWorkRecovery[]) =>
      stageSavedWorkImports(
        options,
        values.map((value) => JSON.stringify(value)),
      ),
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
it("uses the database recovery clock when the client wall clock is behind", async () => {
  const f = await fixture();
  const localNow = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(localNow - 3_600_000);
  await f.stage();
  expect(f.operations.filter((op) => op === "profileRecoveryClock")).toEqual([
    "profileRecoveryClock",
  ]);
  expect((await f.read()).recoveryImports).toBeDefined();
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

it("recovers an actual accepted receipt and cannot duplicate the imported contact", async () => {
  const f = await fixture();
  const accepted = await f.send();
  const { digest } = await f.stage();
  f.loseResponse();
  await expect(f.promote(digest)).rejects.toThrow(
    /Lost authoritative response/,
  );
  expect((await f.read()).journal).toEqual([]);
  expect((await f.read()).recoveryImports![digest].promotion).toBeUndefined();
  expect((await f.promote(digest)).outcome).toBe("accepted");
  expect((await f.read()).journal[0]).toMatchObject({
    state: "accepted",
    result: accepted,
  });
  expect((await f.promote(digest)).alreadyRestored).toBe(true);
  const records = await inWorkspace(db, f.scope.workspaceId, (tx) =>
    tx
      .selectFrom("suite.module_records")
      .selectAll()
      .where("id", "=", (f.input.entry.call.input as { id: string }).id)
      .execute(),
  );
  expect(records).toHaveLength(1);
});
it("permanently stops an unseen original once and retains exact saved input for correction", async () => {
  const f = await fixture();
  const { digest } = await f.stage();
  f.loseResponse();
  await expect(f.promote(digest)).rejects.toThrow(
    /Lost authoritative response/,
  );
  expect((await f.promote(digest)).outcome).toBe("cancelled");
  const state = await f.read();
  expect(state.journal[0]).toMatchObject({
    call: f.input.entry.call,
    state: "rejected",
    settlement: "cancelled",
  });
  expect(state.recoveryImports![digest].input).toEqual(f.input);
  await expect(f.send()).rejects.toMatchObject({ code: "ATTEMPT_CANCELLED" });
  const audits = await inWorkspace(db, f.scope.workspaceId, (tx) =>
    tx
      .selectFrom("suite.audit")
      .selectAll()
      .where("target_id", "=", f.input.entry.id)
      .execute(),
  );
  expect(audits.map((a) => a.action)).toEqual(["module.attempt.cancel"]);
});
it("refuses changed request content against an existing server receipt while retaining the imported copy", async () => {
  const f = await fixture();
  await f.send();
  f.input.entry.call.input = {
    ...(f.input.entry.call.input as object),
    data: {
      name: "Altered archive content",
      kind: "person",
      relationship: "customer",
    },
  };
  const { digest } = await f.stage();
  await expect(f.promote(digest)).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  const state = await f.read();
  expect(state.journal).toEqual([]);
  expect(state.recoveryImports![digest].promotion).toBeUndefined();
});

it("restores saved edits of an already accepted create as a current-record review without another create", async () => {
  const f = await fixture();
  const accepted = await f.send();
  const schema = resourceRecordSchema(
    Type.Record(Type.String(), Type.Unknown()),
  );
  assertSchema(schema, accepted);
  const latest = await f.client.forUser(f.scope.userId).request({
    operation: "moduleRequest",
    params: { workspaceId: f.scope.workspaceId, moduleId: "contacts" },
    moduleVersion: f.input.moduleVersion,
    idempotencyKey: randomUUID(),
    body: {
      action: "update",
      resource: "contacts",
      input: {
        id: accepted.id,
        baseVersion: accepted.version,
        data: { ...accepted.data, email: "latest@example.test" },
      },
    },
  });
  assertSchema(schema, latest);
  const draft: SavedWorkRecovery = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...f.scope,
    moduleId: "contacts",
    moduleVersion: f.input.moduleVersion,
    selection: "draft",
    resource: "contacts",
    key: `contacts/contacts/review/journal/${f.input.entry.id}`,
    data: { ...accepted.data, name: "Reviewed accepted contact" },
    target: null,
    draftVersion: f.input.moduleVersion,
    entry: f.input.entry,
    review: { entryId: f.input.entry.id },
  };
  const { digest } = await f.stage(draft);
  const promotion = await f.promote(digest);
  const state = await f.read();
  expect(promotion.outcome).toBe("accepted");
  expect(state.draftReviews![promotion.draftKey!].entryId).toBeUndefined();
  expect(state.draftTargets![promotion.draftKey!]).toEqual(latest);
  expect(state.drafts[promotion.draftKey!]).toMatchObject({
    name: "Reviewed accepted contact",
    email: "latest@example.test",
  });
  const records = await inWorkspace(db, f.scope.workspaceId, (tx) =>
    tx
      .selectFrom("suite.module_records")
      .selectAll()
      .where("module_id", "=", "contacts")
      .execute(),
  );
  expect(records).toHaveLength(1);
  expect(records[0].data).toEqual(latest.data);
  expect((await f.promote(digest)).alreadyRestored).toBe(true);
});

it("admits an authenticated archive batch through current server policy without granting copied receipt authority", async () => {
  const f = await fixture();
  const second = structuredClone(f.input);
  second.entry.id = second.entry.call.key = randomUUID();
  const original = await f.send();
  f.input.entry.state = "accepted";
  f.input.entry.result = original;
  const passphrase = "corporate recovery integration passphrase";
  const text = await sealSavedWorkArchive(
    {
      kind: "corporate-saved-work",
      formatVersion: 1,
      ...f.scope,
      createdAt: Date.now(),
      copies: [f.input, second],
    },
    passphrase,
    () => {},
  );
  const archive = await openSavedWorkArchive(
    text,
    passphrase,
    f.scope,
    () => {},
  );
  const admitted = await f.stageBatch(archive.copies);
  expect(admitted).toHaveLength(2);
  const state = await f.read();
  expect(state.journal).toEqual([]);
  expect(state.installed).toEqual({});
  expect(
    Object.values(state.recoveryImports!).map((copy) => copy.promotion),
  ).toEqual([undefined, undefined]);
  expect(
    (await f.stageBatch(archive.copies)).every((copy) => copy.alreadyImported),
  ).toBe(true);
  // Only explicit promotion may ask the server whether the copied outcome is true.
  expect(await f.promote(admitted[0].digest)).toMatchObject({
    outcome: "accepted",
  });
  expect(
    (await f.read()).journal.find((entry) => entry.id === f.input.entry.id)
      ?.result,
  ).toEqual(original);
  expect(await f.promote(admitted[1].digest)).toMatchObject({
    outcome: "cancelled",
  });
  const receipts = await inWorkspace(db, f.scope.workspaceId, (tx) =>
    tx
      .selectFrom("suite.idempotency")
      .selectAll()
      .where("key", "=", f.input.entry.id)
      .execute(),
  );
  expect(receipts).toHaveLength(1);
  expect(text).not.toContain(f.session.token);
});

it("does not treat successful archive decryption as a fresh corporate session", async () => {
  const f = await fixture();
  const text = await sealSavedWorkArchive(
    {
      kind: "corporate-saved-work",
      formatVersion: 1,
      ...f.scope,
      createdAt: Date.now(),
      copies: [f.input],
    },
    "archive passphrase retained offline",
    () => {},
  );
  await db
    .updateTable("suite.sessions")
    .set({ created_at: new Date(Date.now() - 360_000) })
    .where("token_hash", "=", hashToken(f.session.token))
    .execute();
  const archive = await openSavedWorkArchive(
    text,
    "archive passphrase retained offline",
    f.scope,
    () => {},
  );
  await expect(f.stageBatch(archive.copies)).rejects.toMatchObject({
    code: "REAUTHENTICATION_REQUIRED",
  });
  expect(f.values.size).toBe(0);
});

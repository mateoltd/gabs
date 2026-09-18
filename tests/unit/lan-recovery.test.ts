import { it, expect } from "vitest";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import {
  defineModule,
  field,
  resource,
  operation,
  Type,
} from "@suite/module-sdk";
import { signPackage } from "@suite/module-sdk/node/signing";
import type { OperationRequest } from "../../packages/contracts/src";
import { LanRecovery } from "../../apps/desktop/src/main/lan/recovery";
import type { RelayEnvelope } from "../../apps/desktop/src/main/lan/transport";
const module = defineModule({
  id: "relay-notes",
  name: "Relay notes",
  description: "Received draft recovery acceptance",
  version: "1.0.0",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  dependencies: {},
  permissions: [
    "relay-notes.notes.read",
    "relay-notes.notes.write",
    "relay-notes.commit",
    "relay-notes.online.read",
    "relay-notes.online.write",
  ],
  configuration: Type.Object({}),
  resources: {
    notes: resource(
      { text: field.text({ title: "Text" }) },
      { title: "Notes" },
    ),
    online: resource(
      { text: field.text({ title: "Text" }) },
      { title: "Commitments", policy: "online" },
    ),
  },
  operations: {
    capture: operation({
      title: "Capture",
      policy: "queued",
      permission: "relay-notes.commit",
      input: Type.Object({ text: Type.String() }),
      output: Type.Object({ saved: Type.Boolean() }),
    }),
  },
});
function fixture() {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const keys = generateKeyPairSync("ed25519");
  let pkg = signPackage(
    module,
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  const publicKey = keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  let user: string | undefined = scope.userId,
    permission = true,
    loseReply = false,
    responseStatus = 200;
  let inbox: RelayEnvelope[] = [];
  const records = new Map<string, unknown>(),
    outcomes = new Map<string, unknown>(),
    sent: OperationRequest[] = [];
  let pause: (() => Promise<void>) | undefined;
  const host = {
    currentUser: () => user,
    inbox: async () => structuredClone(inbox),
    read: async (_scope: typeof scope, key: string) =>
      structuredClone(outcomes.get(key)),
    write: async (_scope: typeof scope, key: string, value: unknown) => {
      outcomes.set(key, structuredClone(value));
    },
    dismiss: async (_scope: typeof scope, id: string, digest: string) => {
      inbox = inbox.filter((e) => e.id !== id || e.digest !== digest);
    },
    request: async (request: OperationRequest) => {
      if (request.operation === "bootstrap") {
        await pause?.();
        return {
          status: 200,
          body: {
            workspace: {
              id: scope.workspaceId,
              kind: "company",
              name: "Company",
              currency: "EUR",
            },
            permissions: permission ? ["modules.manage"] : [],
            roleNames: [],
            modules: [],
            offlineHours: 24,
            seatLimit: 1,
            memberCount: 1,
            authorizedAt: new Date().toISOString(),
          },
        };
      }
      if (request.operation === "moduleTrust")
        return { status: 200, body: { publicKey } };
      if (request.operation === "moduleArtifact")
        return { status: 200, body: pkg };
      sent.push(request);
      if (responseStatus !== 200)
        return {
          status: responseStatus,
          body: { message: "Denied by server" },
        };
      const id = request.idempotencyKey!;
      if (!records.has(id))
        records.set(
          id,
          request.operation === "moduleOperation"
            ? { saved: true }
            : {
                id: randomUUID(),
                version: 1,
                data: { text: "Saved" },
                archived: false,
                updatedAt: new Date().toISOString(),
              },
        );
      if (loseReply) {
        loseReply = false;
        throw Error("Response lost after commit");
      }
      return { status: 200, body: records.get(id) };
    },
  };
  function add(changes: Record<string, unknown> = {}) {
    const id = randomUUID();
    const entry = {
      ...scope,
      id,
      state: "pending",
      createdAt: Date.now(),
      attempts: 0,
      dependencies: [],
      call: {
        moduleId: module.id,
        moduleVersion: module.version,
        action: "create",
        resource: "notes",
        input: { data: { text: "Received" } },
      },
      ...changes,
    };
    const payload = JSON.stringify(entry);
    const envelope: RelayEnvelope = {
      id,
      workspaceId: scope.workspaceId,
      kind: "pending",
      payload,
      digest: createHash("sha256").update(payload).digest("hex"),
    };
    inbox.push(envelope);
    return envelope;
  }
  return {
    scope,
    host,
    add,
    records,
    sent,
    outcomes,
    recovery: () => new LanRecovery(host),
    setUser: (value?: string) => {
      user = value;
    },
    deny: () => {
      permission = false;
    },
    lose: () => {
      loseReply = true;
    },
    status: (value: number) => {
      responseStatus = value;
    },
    tamper: () => {
      pkg = { ...pkg, digest: "0".repeat(64) };
    },
    pause: (value: () => Promise<void>) => {
      pause = value;
    },
  };
}
it("recovers a lost response with the same retry identity after restart and persists accepted receipts", async () => {
  const f = fixture(),
    entry = f.add();
  f.lose();
  await f.recovery().submit(f.scope, entry.id, entry.digest);
  expect((await f.recovery().list(f.scope))[0].state).toBe("pending");
  expect(f.records.size).toBe(1);
  const restarted = f.recovery();
  await Promise.all([
    restarted.submit(f.scope, entry.id, entry.digest),
    restarted.submit(f.scope, entry.id, entry.digest),
  ]);
  expect(f.records.size).toBe(1);
  expect(f.sent.map((r) => r.idempotencyKey)).toEqual([entry.id, entry.id]);
  expect((await restarted.list(f.scope))[0].state).toBe("accepted");
  await restarted.dismiss(f.scope, entry.id, entry.digest);
  expect(await restarted.list(f.scope)).toEqual([]);
  expect(f.outcomes.size).toBe(1);
});
it("retains dependency order while allowing unrelated work and distinguishes conflicts and rejections", async () => {
  const f = fixture(),
    recovery = f.recovery(),
    first = f.add(),
    dependent = f.add({ dependencies: [first.id] }),
    unrelated = f.add();
  await expect(
    recovery.submit(f.scope, dependent.id, dependent.digest),
  ).rejects.toThrow("dependencies");
  await expect(
    recovery.dismiss(f.scope, first.id, first.digest),
  ).rejects.toThrow("server-accepted");
  await recovery.submit(f.scope, unrelated.id, unrelated.digest);
  f.status(412);
  await recovery.submit(f.scope, first.id, first.digest);
  expect(
    (await recovery.list(f.scope)).find((r) => r.id === first.id)?.state,
  ).toBe("conflict");
  f.status(403);
  await recovery.submit(f.scope, first.id, first.digest);
  expect(
    (await recovery.list(f.scope)).find((r) => r.id === first.id)?.state,
  ).toBe("rejected");
  f.status(200);
  await recovery.submit(f.scope, first.id, first.digest);
  await recovery.submit(f.scope, dependent.id, dependent.digest);
  expect(f.records.size).toBe(3);
});
it("rejects foreign ownership, claimed acceptance, invalid schemas, online commitments and corrupt packages before sending", async () => {
  const f = fixture(),
    recovery = f.recovery();
  const invalid = [
    f.add({ userId: randomUUID() }),
    f.add({ state: "accepted" }),
    f.add({
      call: {
        moduleId: module.id,
        moduleVersion: module.version,
        action: "create",
        resource: "online",
        input: { data: { text: "Spend" } },
      },
    }),
    f.add({
      call: {
        moduleId: module.id,
        moduleVersion: module.version,
        action: "create",
        resource: "notes",
        input: { data: { text: 32 } },
      },
    }),
  ];
  for (const entry of invalid)
    await expect(
      recovery.submit(f.scope, entry.id, entry.digest),
    ).rejects.toThrow();
  const valid = f.add();
  f.tamper();
  await expect(
    recovery.submit(f.scope, valid.id, valid.digest),
  ).rejects.toThrow();
  expect(f.sent).toEqual([]);
  expect((await recovery.list(f.scope))[0]).not.toHaveProperty("input");
});
it("uses declared queued operation schemas and stops stale profile and permission contexts", async () => {
  const f = fixture(),
    recovery = f.recovery();
  const entry = f.add({
    call: {
      moduleId: module.id,
      moduleVersion: module.version,
      action: "operation",
      operation: "capture",
      input: { text: "Time note" },
    },
  });
  await recovery.submit(f.scope, entry.id, entry.digest);
  expect(f.sent[0].operation).toBe("moduleOperation");
  f.deny();
  await expect(recovery.list(f.scope)).rejects.toThrow("administrator");
  const g = fixture(),
    pending = g.add(),
    stale = g.recovery();
  let release!: () => void;
  g.pause(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const submission = stale.submit(g.scope, pending.id, pending.digest);
  await new Promise<void>((resolve) => setImmediate(resolve));
  stale.invalidate();
  release();
  await expect(submission).rejects.toThrow("profile");
  expect(g.sent).toEqual([]);
});

it("authors relay input from a durable journal entry without carrying claimed outcomes", async () => {
  const { pendingRelay } = await import("@suite/module-sdk/relay");
  const { scope } = fixture();
  const entry = {
    ...scope,
    id: "durable-retry-123",
    state: "pending" as const,
    dependencies: [],
    createdAt: Date.now(),
    attempts: 5,
    error: "An earlier response was lost",
    result: { accepted: true },
    call: {
      moduleId: module.id,
      moduleVersion: module.version,
      action: "create" as const,
      resource: "notes",
      input: { data: { text: "Retained draft" } },
    },
  };
  const relay = pendingRelay(entry);
  const payload = JSON.parse(relay.payload);
  expect(relay.id).toBe(entry.id);
  expect(payload.attempts).toBe(0);
  expect(payload).not.toHaveProperty("result");
  expect(payload).not.toHaveProperty("error");
  expect(() => pendingRelay({ ...entry, state: "accepted" })).toThrow(
    "pending",
  );
  expect(() =>
    pendingRelay({ ...entry, supersededBy: "replacement-id" }),
  ).toThrow("pending");
  expect(() => pendingRelay({ ...entry, dependencies: [entry.id] })).toThrow(
    "dependency",
  );
});

it("isolates over-nested received data without blocking an unrelated draft", async () => {
  const f = fixture(),
    recovery = f.recovery();
  let input: unknown = "deep";
  for (let index = 0; index < 40; index++) input = { value: input };
  const invalid = f.add({
    call: {
      moduleId: module.id,
      moduleVersion: module.version,
      action: "operation",
      operation: "capture",
      input,
    },
  });
  const valid = f.add();
  await expect(
    recovery.submit(f.scope, invalid.id, invalid.digest),
  ).rejects.toThrow("complex");
  await recovery.submit(f.scope, valid.id, valid.digest);
  expect((await recovery.list(f.scope)).map((row) => row.state)).toEqual([
    "invalid",
    "accepted",
  ]);
  expect(f.records.size).toBe(1);
});

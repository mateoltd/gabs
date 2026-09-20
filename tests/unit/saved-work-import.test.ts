import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { signPackage } from "@suite/module-sdk/node/signing";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import type { Platform } from "../../packages/client/src";
import { SuiteClient } from "../../packages/client/src/api";
import {
  parseSavedWorkImport,
  stageSavedWorkImport,
} from "../../packages/client/src/recovery/import";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { assertWorkspacePurgeable } from "../../packages/client/src/offline/storage-retention";
import definition from "../fixtures/queued-notes/module";
const module = { ...definition, views: {}, navigation: undefined };
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const pair = generateKeyPairSync("ed25519");
  const signed = signPackage(
    module,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const proof = {
    userId: scope.userId,
    sessionId: "a".repeat(64),
    authenticatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 299_000).toISOString(),
  };
  const policy = {
    workspace: { id: scope.workspaceId },
    permissions: [...module.permissions],
    policyRevision: "one",
    modules: [
      { moduleId: module.id, state: "enabled", assigned: true, entitled: true },
    ],
  };
  const call = {
    moduleId: module.id,
    moduleVersion: module.version,
    key: randomUUID(),
    action: "operation" as const,
    operation: "capture",
    input: { name: "Captured offline" },
  };
  const input: SavedWorkRecovery = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...scope,
    moduleId: module.id,
    moduleVersion: module.version,
    selection: "request",
    entry: {
      id: call.key,
      ...scope,
      call,
      dependencies: ["original-parent"],
      createdAt: 20,
      attempts: 1,
      delivery: "uncertain",
      state: "pending",
    },
    review: {
      source: call,
      moduleVersion: module.version,
      input: { name: "Separately reviewed" },
      revision: 2,
      updatedAt: 40,
      continuations: [{ id: "child-request", fingerprint: "saved-child" }],
    },
  };
  const records = new Map<string, unknown>();
  let active = true,
    failSave = false;
  let afterPrune = () => {};
  let afterSave = (_key: string) => {};
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (key: string, run: () => Promise<unknown>) => {
        const next = (locks.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(run);
        locks.set(key, next);
        return next;
      },
    },
  });
  const platform = {
    load: async (_scope: unknown, key: string) =>
      structuredClone(records.get(key)),
    save: async (_scope: unknown, key: string, value: unknown) => {
      if (failSave) throw Error("Storage interrupted");
      records.set(key, structuredClone(value));
      afterSave(key);
    },
    pruneModuleArtifacts: async () => {
      afterPrune();
    },
  } as unknown as Platform;
  const calls: string[] = [];
  const replies: Record<string, unknown> = {
    profileRecovery: proof,
    bootstrap: policy,
    platformState: { modules: [module] },
    moduleTrust: { publicKey },
    moduleArtifact: signed,
    moduleReceiptArtifact: signed,
  };
  let observe = (_operation: string) => {};
  const client = new SuiteClient(async (request) => {
    calls.push(request.operation);
    observe(request.operation);
    return {
      status: 200,
      actorId: scope.userId,
      body: structuredClone(replies[request.operation]),
    };
  });
  const abort = new AbortController();
  const options = {
    client,
    platform,
    scope,
    signal: abort.signal,
    check: () => {
      if (!active) throw Error("Profile locked");
    },
  };
  return {
    input,
    options,
    replies,
    policy,
    proof,
    calls,
    abort,
    records,
    state: () => records.get("module-state") as ModuleStorage | undefined,
    stage: (value: SavedWorkRecovery = input) =>
      stageSavedWorkImport(options, JSON.stringify(value)),
    lock: () => {
      active = false;
    },
    fail: (value: boolean) => {
      failSave = value;
    },
    onRequest: (fn: typeof observe) => {
      observe = fn;
    },
    onSave: (fn: typeof afterSave) => {
      afterSave = fn;
    },
    signed,
    publicKey,
    onPrune: (fn: typeof afterPrune) => {
      afterPrune = fn;
    },
  };
}
it("imports exact request/review observations without admitting execution, contracts or authority", async () => {
  const f = fixture();
  const existing: ModuleStorage = {
    journal: [],
    drafts: { "other/resource": { keep: "newer draft" } },
    installed: {},
    pages: {},
  };
  f.records.set("module-state", existing);
  const result = await f.stage();
  expect(f.state()).toMatchObject(existing);
  expect(f.state()!.recoveryImports![result.digest].input).toEqual(f.input);
  expect(f.state()!.responseContracts).toBeUndefined();
  expect(f.records.has("snapshot")).toBe(false);
  expect(
    f.calls.every(
      (call) =>
        !["moduleRequest", "moduleOperation", "moduleAttemptSettle"].includes(
          call,
        ),
    ),
  ).toBe(true);
  expect(() =>
    assertWorkspacePurgeable({ modules: { ...f.state(), drafts: {} } }),
  ).toThrow(/before disabling/);
});
it("deduplicates simultaneous and reformatted retries, preserving the first durable copy", async () => {
  const f = fixture();
  const results = await Promise.all([f.stage(), f.stage()]);
  expect(results.map((r) => r.alreadyImported).sort()).toEqual([false, true]);
  const before = structuredClone(f.state());
  await stageSavedWorkImport(f.options, JSON.stringify(f.input, null, 2));
  expect(f.state()).toEqual(before);
});
it("keeps file-supplied accepted and cancelled claims inert and separate from current requests", async () => {
  const f = fixture();
  if (f.input.selection !== "request") throw Error("request expected");
  f.input.entry.state = "accepted";
  f.input.entry.result = { id: "untrusted-result" };
  f.input.entry.settlement = "cancelled";
  const result = await f.stage();
  expect(f.state()!.journal).toEqual([]);
  expect(f.state()!.recoveryImports![result.digest].input).toEqual(f.input);
});
it("retains draft targets, comparisons, source versions and collision choices without creating an active draft", async () => {
  const f = fixture();
  const record = {
    id: randomUUID(),
    version: 2,
    archived: true,
    updatedAt: new Date().toISOString(),
    data: { name: "Server snapshot" },
  };
  const input: SavedWorkRecovery = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...f.options.scope,
    moduleId: module.id,
    moduleVersion: module.version,
    selection: "draft",
    resource: "notes",
    key: `${module.id}/notes`,
    data: { name: "Draft" },
    target: record,
    draftVersion: module.version,
    review: {
      draftId: "retained-draft",
      comparison: {
        base: { name: "Old" },
        local: { name: "Draft" },
        remote: record.data,
        conflicts: ["name"],
        choices: { name: "local" },
      },
      collision: {
        parentId: "prior-create",
        sourceData: { name: "Original" },
        sourceTarget: null,
        targetId: record.id,
        moduleVersion: module.version,
        ready: true,
      },
    },
  };
  const result = await f.stage(input);
  expect(f.state()!.drafts).toEqual({});
  expect(f.state()!.recoveryImports![result.digest].input).toEqual(input);
});
it("rejects foreign account/workspace input and excessive nesting/bytes before any network or storage access", async () => {
  const f = fixture();
  await expect(f.stage({ ...f.input, userId: randomUUID() })).rejects.toThrow(
    /account/,
  );
  await expect(
    f.stage({ ...f.input, workspaceId: randomUUID() }),
  ).rejects.toThrow(/workspace/);
  expect(() =>
    parseSavedWorkImport(" ".repeat(1024 * 1024 + 1), f.options.scope),
  ).toThrow(/limit/);
  expect(() =>
    parseSavedWorkImport(
      "[".repeat(67) + "0" + "]".repeat(67),
      f.options.scope,
    ),
  ).toThrow(/deeply/);
  expect(() =>
    parseSavedWorkImport('{"overflow":1e309}', f.options.scope),
  ).toThrow(/non-finite/);
  expect(f.calls).toEqual([]);
  expect(f.state()).toBeUndefined();
});
it("requires a fresh scoped session and the same session throughout admission", async () => {
  const f = fixture();
  f.proof.authenticatedAt = new Date(Date.now() - 400_000).toISOString();
  f.proof.expiresAt = new Date(Date.now() - 100_000).toISOString();
  await expect(f.stage()).rejects.toThrow(/Sign in again/);
  const other = fixture();
  let count = 0;
  other.onRequest((operation) => {
    if (operation === "profileRecovery" && ++count === 2)
      other.proof.sessionId = "b".repeat(64);
  });
  await expect(other.stage()).rejects.toThrow(/Sign in again/);
  expect(other.state()).toBeUndefined();
});
it("refuses current permission denial, changed policy and unknown or corrupt signed source releases", async () => {
  const f = fixture();
  f.policy.permissions = [];
  await expect(f.stage()).rejects.toThrow(/access/);
  expect(f.state()).toBeUndefined();
  const changed = fixture();
  let count = 0;
  changed.onRequest((operation) => {
    if (operation === "bootstrap" && ++count === 2)
      changed.policy.policyRevision = "two";
  });
  await expect(changed.stage()).rejects.toThrow(/access changed/);
  const corrupt = fixture();
  corrupt.replies.moduleReceiptArtifact = {
    ...(corrupt.replies.moduleReceiptArtifact as object),
    signature: "forged",
  };
  await expect(corrupt.stage()).rejects.toThrow(/signed module version/);
  expect(corrupt.state()).toBeUndefined();
});
it("rechecks profile lock after asynchronous storage preparation and preserves work on failed commits", async () => {
  const f = fixture();
  f.onPrune(f.lock);
  await expect(f.stage()).rejects.toThrow(/Profile locked/);
  expect(f.state()).toBeUndefined();
  const failed = fixture();
  failed.fail(true);
  await expect(failed.stage()).rejects.toThrow(/Storage interrupted/);
  expect(failed.state()).toBeUndefined();
  failed.fail(false);
  expect((await failed.stage()).alreadyImported).toBe(false);
  expect((await failed.stage()).alreadyImported).toBe(true);
});
it("stops aborted or disconnected admission without adding data", async () => {
  const f = fixture();
  f.onRequest((operation) => {
    if (operation === "moduleReceiptArtifact") f.abort.abort();
  });
  await expect(f.stage()).rejects.toThrow();
  expect(f.state()).toBeUndefined();
  const offline = fixture();
  offline.onRequest(() => {
    throw Error("Network unavailable");
  });
  await expect(offline.stage()).rejects.toThrow(/Network unavailable/);
  expect(offline.state()).toBeUndefined();
});

it("checks authority again after artifact writes before committing the imported copy", async () => {
  const f = fixture();
  const original: ModuleStorage = {
    journal: [],
    pages: {},
    drafts: {},
    installed: {
      [module.id]: {
        version: module.version,
        artifact: f.signed.artifact,
        signed: f.signed,
        publicKey: f.publicKey,
        verifiedAt: Date.now(),
      },
    },
  };
  f.records.set("module-state", structuredClone(original));
  f.onSave((key) => {
    if (key.startsWith("module-artifact/")) f.lock();
  });
  await expect(f.stage()).rejects.toThrow(/Profile locked/);
  expect(f.state()).toEqual(original);
});
it("refuses full import storage without replacing retained work", async () => {
  const f = fixture();
  const imports = Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => [
      String(index),
      { input: f.input, receivedAt: index },
    ]),
  );
  const original: ModuleStorage = {
    journal: [],
    drafts: {},
    pages: {},
    installed: {},
    recoveryImports: imports,
  };
  f.records.set("module-state", structuredClone(original));
  await expect(f.stage()).rejects.toThrow(/storage is full/);
  expect(f.state()).toEqual(original);
});

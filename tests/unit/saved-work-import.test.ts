import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { Bootstrap } from "../../packages/contracts/src";
import { signPackage } from "@suite/module-sdk/node/signing";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import type { Platform } from "../../packages/client/src";
import { SuiteClient } from "../../packages/client/src/api";
import {
  parseSavedWorkImport,
  stageSavedWorkImport,
  promoteSavedWorkImport,
  inspectSavedWorkImport,
  discardSavedWorkImport,
} from "../../packages/client/src/recovery/import";
import {
  readModuleStorage,
  type ModuleStorage,
} from "../../packages/client/src/modules/storage";
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
    read: () => readModuleStorage(platform, scope),
    promote: (digest: string) => promoteSavedWorkImport(options, digest),
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
it("delivers server policy before rejecting a same-revision permission denial", async () => {
  const f = fixture();
  const received: Bootstrap[] = [];
  let requests = 0;
  f.onRequest((operation) => {
    if (operation === "bootstrap" && ++requests === 2)
      f.policy.permissions = [];
  });
  await expect(
    stageSavedWorkImport(
      {
        ...f.options,
        receivePolicy: async (policy) => {
          received.push(structuredClone(policy));
          return policy;
        },
      },
      JSON.stringify(f.input),
    ),
  ).rejects.toThrow(/access/);
  expect(received).toHaveLength(2);
  expect(received[1].policyRevision).toBe(received[0].policyRevision);
  expect(received[1].permissions).toEqual([]);
  expect(f.state()).toBeUndefined();
});
it("uses the policy accepted by the host rather than the raw server candidate", async () => {
  const f = fixture();
  await expect(
    stageSavedWorkImport(
      {
        ...f.options,
        receivePolicy: async (policy) => ({ ...policy, permissions: [] }),
      },
      JSON.stringify(f.input),
    ),
  ).rejects.toThrow(/access/);
  expect(f.calls.filter((operation) => operation === "bootstrap")).toHaveLength(
    1,
  );
  expect(f.state()).toBeUndefined();
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

it("reconciles forged acceptance against the server and restores a stopped command with its original identity", async () => {
  const f = fixture();
  f.input.entry.state = "accepted";
  f.input.entry.result = { id: "forged" };
  const copy = structuredClone(f.input);
  const { digest } = await f.stage();
  f.replies.moduleAttemptSettle = {
    key: f.input.entry.id,
    outcome: "cancelled",
  };
  const restored = await f.promote(digest);
  const state = await f.read();
  expect(restored).toMatchObject({
    requestId: f.input.entry.id,
    alreadyRestored: false,
    existingRequest: false,
  });
  expect(state.journal).toHaveLength(1);
  expect(state.journal[0]).toMatchObject({
    id: f.input.entry.id,
    call: f.input.entry.call,
    dependencies: f.input.entry.dependencies,
    state: "rejected",
    settlement: "cancelled",
  });
  expect(state.journal[0].result).toBeUndefined();
  expect(state.commandReviews![f.input.entry.id]).toMatchObject({
    source: f.input.entry.call,
    input: f.input.review!.input,
  });
  expect(state.commandReviews![f.input.entry.id].continuations).toBeUndefined();
  expect(state.recoveryImports![digest].input).toEqual(copy);
  expect(state.recoveryVersions![module.id]).toBe(module.version);
  expect(
    state.responseContracts![`${module.id}@${module.version}`],
  ).toBeDefined();
  const retry = await f.promote(digest);
  expect(retry.alreadyRestored).toBe(true);
  expect(f.calls.filter((call) => call === "moduleAttemptSettle")).toHaveLength(
    1,
  );
});
it("uses the authoritative accepted output rather than a copied result or cancellation claim", async () => {
  const f = fixture();
  f.input.entry.state = "accepted";
  f.input.entry.result = { id: "file-result" };
  f.input.entry.settlement = "cancelled";
  const { digest } = await f.stage();
  f.replies.moduleAttemptSettle = {
    key: f.input.entry.id,
    outcome: "accepted",
    result: { id: "server-result" },
  };
  await f.promote(digest);
  const state = await f.read();
  expect(state.journal[0]).toMatchObject({
    state: "accepted",
    result: { id: "server-result" },
  });
  expect(state.journal[0].settlement).toBeUndefined();
  expect(state.commandReviews).toBeUndefined();
});
it("retains the import across lost settlement responses and interrupted local commits", async () => {
  const f = fixture();
  const { digest } = await f.stage();
  f.replies.moduleAttemptSettle = {
    key: f.input.entry.id,
    outcome: "cancelled",
  };
  f.onRequest((operation) => {
    if (operation === "moduleAttemptSettle")
      throw Error("Lost settlement response");
  });
  await expect(f.promote(digest)).rejects.toThrow(/Lost settlement/);
  expect((await f.read()).journal).toEqual([]);
  f.onRequest(() => {});
  f.fail(true);
  await expect(f.promote(digest)).rejects.toThrow(/Storage interrupted/);
  f.fail(false);
  expect((await f.read()).recoveryImports![digest].promotion).toBeUndefined();
  await f.promote(digest);
  expect((await f.read()).journal).toHaveLength(1);
  expect((await f.promote(digest)).alreadyRestored).toBe(true);
});
it("refuses a conflicting local request identity before fencing any server work", async () => {
  const f = fixture();
  const { digest } = await f.stage();
  const state = f.state()!;
  state.journal.push({
    ...f.input.entry,
    call: { ...f.input.entry.call, input: { name: "Different local input" } },
  });
  const before = structuredClone(state);
  await expect(f.promote(digest)).rejects.toThrow(/different saved work/);
  expect(f.calls).not.toContain("moduleAttemptSettle");
  expect(f.state()).toEqual(before);
});
it("preserves existing matching requests and reviews instead of replacing newer local work", async () => {
  const f = fixture();
  const { digest } = await f.stage();
  const entry = {
    ...f.input.entry,
    state: "accepted" as const,
    delivery: undefined,
    result: { id: "server-result" },
  };
  f.state()!.journal.push(entry);
  const review = { ...f.input.review!, input: { name: "Newer local review" } };
  f.state()!.commandReviews = { [entry.id]: review };
  f.replies.moduleAttemptSettle = {
    key: entry.id,
    outcome: "accepted",
    result: entry.result,
  };
  expect((await f.promote(digest)).existingRequest).toBe(true);
  const state = await f.read();
  expect(state.journal).toEqual([entry]);
  expect(state.commandReviews![entry.id]).toEqual(review);
});
it("never promotes after revocation, lock, cancellation or a malformed authoritative result", async () => {
  const f = fixture();
  const { digest } = await f.stage();
  f.replies.moduleAttemptSettle = {
    key: f.input.entry.id,
    outcome: "accepted",
    result: { invalid: true },
  };
  await expect(f.promote(digest)).rejects.toThrow();
  expect((await f.read()).journal).toEqual([]);
  f.replies.moduleAttemptSettle = {
    key: f.input.entry.id,
    outcome: "cancelled",
  };
  f.onRequest((operation) => {
    if (operation === "moduleAttemptSettle") f.policy.permissions = [];
  });
  await expect(f.promote(digest)).rejects.toThrow(/access/);
  expect((await f.read()).journal).toEqual([]);
  expect((await f.read()).recoveryImports![digest].promotion).toBeUndefined();
});
it("serializes duplicate promotion and requires the retained copy to match its fingerprint", async () => {
  const f = fixture();
  const { digest } = await f.stage();
  f.replies.moduleAttemptSettle = {
    key: f.input.entry.id,
    outcome: "cancelled",
  };
  const results = await Promise.all([f.promote(digest), f.promote(digest)]);
  expect(results.map((value) => value.alreadyRestored).sort()).toEqual([
    false,
    true,
  ]);
  expect((await f.read()).journal).toHaveLength(1);
  f.state()!.recoveryImports![digest].input.moduleVersion = "other";
  await expect(f.promote(digest)).rejects.toThrow();
});
it("restores drafts into a deterministic independent slot and keeps collision provenance inert", async () => {
  const f = fixture();
  const input: SavedWorkRecovery = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...f.options.scope,
    moduleId: module.id,
    moduleVersion: module.version,
    selection: "draft",
    resource: "notes",
    key: `${module.id}/notes`,
    data: { name: "Copied draft" },
    target: null,
    draftVersion: module.version,
    review: {
      collision: {
        parentId: "untrusted-parent",
        sourceData: { name: "Before collision" },
        sourceTarget: null,
        moduleVersion: module.version,
        ready: true,
      },
    },
  };
  const { digest } = await f.stage(input);
  f.state()!.drafts[input.key] = { name: "Newer ordinary draft" };
  const result = await f.promote(digest);
  const state = await f.read();
  expect(result.draftKey).toBe(
    `${module.id}/notes/review/direct/import-${digest}`,
  );
  expect(state.drafts[input.key]).toEqual({ name: "Newer ordinary draft" });
  expect(state.drafts[result.draftKey!]).toEqual(input.data);
  expect(state.draftReviews![result.draftKey!].collision).toBeUndefined();
  expect(state.recoveryImports![digest].input).toEqual(input);
  expect(f.calls).not.toContain("moduleAttemptSettle");
});

it("updates an existing pending request from the verified outcome without replacing its saved input", async () => {
  const f = fixture();
  const { digest } = await f.stage();
  f.state()!.journal.push(structuredClone(f.input.entry));
  f.replies.moduleAttemptSettle = {
    key: f.input.entry.id,
    outcome: "cancelled",
  };
  await f.promote(digest);
  const state = await f.read();
  expect(state.journal).toHaveLength(1);
  expect(state.journal[0]).toMatchObject({
    call: f.input.entry.call,
    dependencies: f.input.entry.dependencies,
    state: "rejected",
    settlement: "cancelled",
  });
  expect(state.journal[0].delivery).toBeUndefined();
});

it("reauthorizes inspection and copy removal while preserving promoted requests", async () => {
  const f = fixture();
  const { digest } = await f.stage();
  const shown = await inspectSavedWorkImport(f.options, digest);
  expect(shown.input).toEqual(f.input);
  f.replies.moduleAttemptSettle = {
    key: f.input.entry.id,
    outcome: "cancelled",
  };
  await f.promote(digest);
  const restored = (await f.read()).journal;
  f.policy.permissions = [];
  await expect(inspectSavedWorkImport(f.options, digest)).rejects.toThrow(
    /access/,
  );
  await expect(discardSavedWorkImport(f.options, digest)).rejects.toThrow(
    /access/,
  );
  expect((await f.read()).recoveryImports![digest]).toBeDefined();
  f.policy.permissions = [...module.permissions];
  await discardSavedWorkImport(f.options, digest);
  const state = await f.read();
  expect(state.journal).toEqual(restored);
  expect(state.recoveryImports![digest]).toBeUndefined();
});

it("passes exact original/current permission requirements to the host before commit", async () => {
  const f = fixture();
  let denied = false;
  f.onPrune(() => {
    denied = true;
  });
  const check: typeof f.options.check = f.options.check;
  await expect(
    stageSavedWorkImport(
      {
        ...f.options,
        check(access) {
          check();
          if (access) {
            expect(access.permissions).toContain(
              module.operations.capture.permission,
            );
            expect(access.modules).toContain(module.id);
            if (denied) throw Error("Received current denial");
          }
        },
      },
      JSON.stringify(f.input),
    ),
  ).rejects.toThrow(/Received current denial/);
  expect(f.state()).toBeUndefined();
});

function linkedDraft(
  f: ReturnType<typeof fixture>,
  action: "create" | "update" = "update",
) {
  const record = {
    id: randomUUID(),
    data: { name: "Original base" },
    version: 1,
    archived: false,
    updatedAt: new Date().toISOString(),
  };
  const entry = {
    ...f.input.entry,
    dependencies: [],
    call: {
      ...f.input.entry.call,
      action,
      operation: undefined,
      resource: "notes",
      input: {
        id: record.id,
        data: { name: "First edit" },
        ...(action === "update"
          ? { baseVersion: 1, baseData: record.data }
          : {}),
      },
    },
  };
  const input: Extract<SavedWorkRecovery, { selection: "draft" }> = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...f.options.scope,
    moduleId: module.id,
    moduleVersion: module.version,
    selection: "draft",
    resource: "notes",
    key: `${module.id}/notes/review/journal/${entry.id}`,
    data: { name: "Reviewed edit" },
    target: action === "create" ? null : record,
    draftVersion: module.version,
    review: {
      entryId: entry.id,
      comparison: {
        base: record.data,
        local: { name: "Reviewed edit" },
        remote: { name: "Prior remote" },
        conflicts: ["name"],
        choices: { name: "local" },
      },
    },
    entry,
  };
  return { input, record };
}

it("restores a stopped resource review under the original request and rechecks current conflicts", async () => {
  const f = fixture();
  const { input, record } = linkedDraft(f);
  input.review!.recoveryInput = {
    moduleVersion: module.version,
    baseVersion: record.version,
    recordId: record.id,
  };
  const { digest } = await f.stage(input);
  const current = { ...record, version: 3, data: { name: "Current remote" } };
  f.replies.moduleAttemptSettle = {
    key: input.entry!.id,
    outcome: "cancelled",
  };
  f.replies.moduleRequest = current;
  const result = await f.promote(digest);
  const state = await f.read();
  expect(result.draftKey).toBe(input.key);
  expect(state.draftTargets![input.key]).toEqual(current);
  expect(state.draftReviews![input.key]).toEqual({
    entryId: input.entry!.id,
    recoveryInput: input.review!.recoveryInput,
    comparison: {
      base: record.data,
      local: input.data,
      remote: current.data,
      conflicts: ["name"],
      choices: {},
    },
  });
  expect(state.drafts[input.key]).toEqual(current.data);
  expect(state.journal[0]).toMatchObject({
    id: input.entry!.id,
    settlement: "cancelled",
    call: { input: input.entry!.call.input },
  });
  expect(state.recoveryImports![digest].input).toEqual(
    JSON.parse(JSON.stringify(input)),
  );
});

it("turns a review of an accepted create into a current-record edit instead of another create", async () => {
  const f = fixture();
  const { input, record } = linkedDraft(f, "create");
  const { digest } = await f.stage(input);
  const accepted = { ...record, data: { name: "First edit" } };
  const current = { ...accepted, version: 2, data: { name: "Later remote" } };
  f.replies.moduleAttemptSettle = {
    key: input.entry!.id,
    outcome: "accepted",
    result: accepted,
  };
  f.replies.moduleRequest = current;
  const result = await f.promote(digest);
  const state = await f.read();
  expect(result.draftKey).toBe(
    `${module.id}/notes/review/direct/import-${digest}`,
  );
  expect(state.draftTargets![result.draftKey!]).toEqual(current);
  expect(state.draftReviews![result.draftKey!]).toMatchObject({
    draftId: `import-${digest}`,
    comparison: {
      base: accepted.data,
      local: input.data,
      remote: current.data,
      conflicts: ["name"],
      choices: {},
    },
  });
  expect(state.draftReviews![result.draftKey!].entryId).toBeUndefined();
  expect(state.journal[0]).toMatchObject({
    state: "accepted",
    result: accepted,
  });
});

it("preserves newer local linked reviews and refuses detached or reassigned source claims before settlement", async () => {
  for (const mode of ["existing", "missing", "reassigned"] as const) {
    const f = fixture();
    const { input } = linkedDraft(f);
    if (mode === "missing") delete input.entry;
    if (mode === "reassigned")
      input.entry!.recordRecovery = {
        targetId: randomUUID(),
        destination: "existing",
      };
    const { digest } = await f.stage(input);
    if (mode === "existing")
      f.state()!.drafts[input.key] = { name: "Newer local review" };
    const before = structuredClone(await f.read());
    await expect(f.promote(digest)).rejects.toThrow();
    expect(f.calls).not.toContain("moduleAttemptSettle");
    expect(await f.read()).toEqual(before);
  }
});

it("retains a linked review when its current record cannot be verified or access changes", async () => {
  for (const mode of ["identity", "denial"] as const) {
    const f = fixture();
    const { input, record } = linkedDraft(f);
    const { digest } = await f.stage(input);
    f.replies.moduleAttemptSettle = {
      key: input.entry!.id,
      outcome: "cancelled",
    };
    f.replies.moduleRequest = {
      ...record,
      id: mode === "identity" ? randomUUID() : record.id,
    };
    if (mode === "denial")
      f.onRequest((operation) => {
        if (operation === "moduleRequest") f.policy.permissions = [];
      });
    await expect(f.promote(digest)).rejects.toThrow();
    const state = await f.read();
    expect(state.journal).toEqual([]);
    expect(state.drafts).toEqual({});
    expect(state.recoveryImports![digest].promotion).toBeUndefined();
  }
});

it("preserves archived targets and original create identity without activating copied comparisons", async () => {
  const created = fixture();
  const draft = linkedDraft(created, "create").input;
  const { digest } = await created.stage(draft);
  created.replies.moduleAttemptSettle = {
    key: draft.entry!.id,
    outcome: "cancelled",
  };
  await created.promote(digest);
  const state = await created.read();
  expect(state.draftReviews![draft.key]).toEqual({ entryId: draft.entry!.id });
  expect(state.draftTargets![draft.key]).toBeNull();
  expect(state.drafts[draft.key]).toEqual(draft.data);
  expect(created.calls).not.toContain("moduleRequest");
  const archived = fixture();
  const { input, record } = linkedDraft(archived);
  const copy = await archived.stage(input);
  archived.replies.moduleAttemptSettle = {
    key: input.entry!.id,
    outcome: "cancelled",
  };
  archived.replies.moduleRequest = { ...record, archived: true, version: 2 };
  await archived.promote(copy.digest);
  expect((await archived.read()).draftTargets![input.key]?.archived).toBe(true);
  expect((await archived.read()).drafts[input.key]).toEqual(input.data);
});

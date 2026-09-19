import {
  commandContinuation,
  replaceCommand,
  saveCommandReview,
} from "../../packages/client/src/modules/command-recovery";
import { replaceArchive } from "../../packages/client/src/modules/archive-recovery";
import { prepareCreateReplacement } from "../../packages/client/src/modules/collisions";
import {
  replaceFailedCreate,
  collisionDrafts,
  settleJournalEntry,
} from "../../packages/client/src/modules/settlement";
import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  Type,
  createModuleClient,
  field,
  operation,
  QueueCaptureError,
  isQueueCaptureError,
  type ModuleCall,
} from "@suite/module-sdk";
import { createModuleQueue } from "../../packages/client/src/modules/queued";
import { signPackage } from "../../packages/sdk/node/signing";
import contacts from "../../modules/contacts/module";
import type { Platform, Scope } from "../../packages/client/src";
import { isModuleArtifactKey } from "../../packages/client/src";
import {
  changeModuleStorage,
  saveResourceDraft,
  resourceDraftKey,
  enqueue,
  readModuleStorage,
  syncModuleStorage,
} from "../../packages/client/src/modules/storage";
import type { StoredModuleState } from "../../packages/client/src/modules/artifacts";
import { verifyResponseContract } from "../../packages/client/src/modules/response";
import { offlineRecoveryContracts } from "../../packages/shell/src/features/modules/recovery/contracts";
import {
  resourceRecoveryInputs,
  canInspectResource,
} from "../../packages/shell/src/features/modules/recovery/resource-input";
const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const original = signPackage(contacts, privateKey);
const upgraded = signPackage(
  {
    ...contacts,
    version: "2.0.0",
    resources: {
      ...contacts.resources,
      contacts: {
        ...contacts.resources.contacts,
        schema: Type.Object({ name: Type.Number() }),
      },
    },
  },
  privateKey,
);
const other = signPackage(
  {
    ...JSON.parse(JSON.stringify(contacts).replaceAll("contacts", "other")),
    version: "3.0.0",
  },
  privateKey,
);
const scope: Scope = { userId: "user", workspaceId: "company" };
const data = { name: "Retained", kind: "person", relationship: "other" };
const row = {
  id: "record",
  data,
  version: 1,
  archived: false,
  updatedAt: "2026-09-17T00:00:00Z",
};
const call = (
  key: string,
  moduleId = "contacts",
  moduleVersion = "1.1.0",
): ModuleCall => ({
  moduleId,
  moduleVersion,
  resource: moduleId === "other" ? "other" : "contacts",
  action: "create",
  input: { data },
  key,
});
function storage() {
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (key: string, fn: () => Promise<unknown>) => {
        const next = (locks.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(fn);
        locks.set(key, next);
        return next;
      },
    },
  });
  const records = new Map<string, unknown>();
  let failRoot = 0;
  const path = (s: Scope, key: string) => `${s.userId}/${s.workspaceId}/${key}`;
  const platform: Platform = {
    kind: "desktop",
    load: async <T>(s: Scope, key: string) =>
      structuredClone(records.get(path(s, key))) as T | undefined,
    save: async (s, key, value) => {
      if (key === "module-state" && failRoot > 0 && --failRoot === 0) {
        throw Error("Interrupted commit");
      }
      records.set(path(s, key), structuredClone(value));
    },
    pruneModuleArtifacts: async (s, keep) => {
      const retained = new Set(keep.map((key) => path(s, key)));
      for (const key of records.keys())
        if (key.startsWith(path(s, "module-artifact/")) && !retained.has(key))
          records.delete(key);
    },
    purgeWorkspace: async () => {},
    purgeUser: async () => {},
    identity: async () => undefined,
    rememberIdentity: async () => {},
    saveFile: async () => {},
    notify: async () => {},
  };
  const install = async (pkg = original) =>
    changeModuleStorage(platform, scope, (s) => {
      s.installed[pkg.module_id] = {
        signed: pkg,
        artifact: pkg.artifact,
        publicKey,
        version: pkg.version,
        verifiedAt: 1,
      };
    });
  const root = () =>
    structuredClone(
      records.get(path(scope, "module-state")),
    ) as StoredModuleState;
  return {
    platform,
    records,
    install,
    root,
    interrupt: (write = 1) => {
      failRoot = write;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
it("retains current recovery metadata and the original draft schema after draft-only uninstall", async () => {
  const { platform, install } = storage();
  await install();
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: { ...data, name: "Draft without a request" },
    target: null,
  });
  await install(upgraded);
  await changeModuleStorage(platform, scope, (state) => {
    // The uninstall lifecycle records the current contract before artifact pruning.
    state.recoveryVersions = { contacts: upgraded.version };
    state.responseContracts![`contacts@${upgraded.version}`] = {
      signed: upgraded,
      publicKey,
    };
    delete state.installed.contacts;
  });
  const state = await readModuleStorage(platform, scope);
  expect(state.journal).toEqual([]);
  expect(state.installed.contacts).toBeUndefined();
  const offline = await offlineRecoveryContracts(state);
  expect(offline.failures).toEqual([]);
  expect(offline.modules.map((module) => module.version)).toEqual([
    upgraded.version,
  ]);
  const recovered = await resourceRecoveryInputs(state, scope, "contacts");
  expect(recovered.failures).toEqual([]);
  expect(recovered.drafts).toHaveLength(1);
  expect(recovered.drafts[0].module.version).toBe(contacts.version);
  expect(recovered.drafts[0].data.name).toBe("Draft without a request");
});
it("recovers resource receipts without losing ordinary drafts, reviews or original contracts after uninstall", async () => {
  const { platform, install } = storage();
  await install();
  await enqueue(platform, scope, call("resource-receipt"));
  await changeModuleStorage(platform, scope, (state) => {
    state.journal[0].state = "rejected";
  });
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: { ...data, name: "Ordinary draft" },
    target: null,
  });
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: { ...data, name: "Separate review" },
    target: null,
    review: { entryId: "resource-receipt" },
  });
  const before = await readModuleStorage(platform, scope);
  await install(upgraded);
  await changeModuleStorage(platform, scope, (state) => {
    delete state.installed.contacts;
  });
  await settleJournalEntry(
    platform,
    scope,
    "resource-receipt",
    async () => ({ key: "resource-receipt", outcome: "accepted", result: row }),
    () => true,
    "saved-resource",
  );
  const state = await readModuleStorage(platform, scope);
  expect(state.drafts).toEqual(before.drafts);
  expect(state.draftReviews).toEqual(before.draftReviews);
  const recovered = await resourceRecoveryInputs(state, scope, "contacts");
  expect(recovered.failures).toEqual([]);
  expect(recovered.changes[0].entry).toMatchObject({
    state: "accepted",
    result: row,
    recoveredAt: expect.any(Number),
    call: before.journal[0].call,
  });
  expect(recovered.drafts.map((draft) => draft.data.name)).toEqual([
    "Ordinary draft",
    "Separate review",
  ]);
  expect(
    recovered.drafts.every(
      (draft) => draft.module.version === contacts.version,
    ),
  ).toBe(true);
  const removed = { ...contacts, version: "3.0.0", resources: {} };
  expect(
    canInspectResource(call("resource-receipt"), removed, contacts, () => true),
  ).toBe(true);
  expect(
    canInspectResource(
      call("resource-receipt"),
      removed,
      contacts,
      (permission) => !permission.endsWith(".write"),
    ),
  ).toBe(false);
  expect(
    (
      await resourceRecoveryInputs(
        state,
        { ...scope, workspaceId: "other" },
        "contacts",
      )
    ).changes,
  ).toEqual([]);
});
it("preserves an archive and its identity if authority is revoked during saved-resource settlement", async () => {
  const { platform, install } = storage();
  await install();
  const archive: ModuleCall = {
    ...call("archive-recovery"),
    action: "archive",
    input: { id: row.id, baseVersion: row.version },
  };
  await enqueue(platform, scope, archive);
  let allowed = true;
  await expect(
    settleJournalEntry(
      platform,
      scope,
      archive.key!,
      async () => {
        allowed = false;
        return {
          key: archive.key,
          outcome: "accepted",
          result: { ...row, archived: true },
        };
      },
      () => allowed,
      "saved-resource",
    ),
  ).rejects.toThrow("Unlock this workspace again");
  const entry = (await readModuleStorage(platform, scope)).journal[0];
  expect(entry).toMatchObject({
    state: "pending",
    call: archive,
    delivery: "unsubmitted",
  });
  expect(entry.recoveredAt).toBeUndefined();
});
it("retains the last device recovery contract separately from original input and rejects altered contracts after uninstall", async () => {
  const { platform, install, root } = storage();
  await install();
  await enqueue(platform, scope, call("retained-original"));
  await install(upgraded);
  await changeModuleStorage(platform, scope, (state) => {
    state.recoveryVersions = { contacts: upgraded.version };
    state.responseContracts![`contacts@${upgraded.version}`] = {
      signed: upgraded,
      publicKey,
    };
    delete state.installed.contacts;
  });
  expect(Object.keys(root().responseContractRefs!).sort()).toEqual([
    "contacts@1.1.0",
    "contacts@2.0.0",
  ]);
  const state = await readModuleStorage(platform, scope);
  expect(state.journal[0].call).toEqual(call("retained-original"));
  expect(
    (await offlineRecoveryContracts(state)).modules.map((m) => m.version),
  ).toEqual(["2.0.0"]);
  state.responseContracts!["contacts@2.0.0"].signed.artifact.name = "Altered";
  expect(await offlineRecoveryContracts(state)).toMatchObject({
    modules: [],
    failures: [expect.any(Error)],
  });
  // An unverifiable latest contract must not fall back to the original input schema.
  state.recoveryVersions = { contacts: "3.0.0" };
  expect((await offlineRecoveryContracts(state)).modules).toEqual([]);
  await changeModuleStorage(platform, scope, (stored) => {
    stored.journal = [];
  });
  expect(root().responseContractRefs).toEqual({});
});
it("preserves archived review input and original release/base metadata atomically without accepting the rejected request", async () => {
  const { platform, install, interrupt } = storage();
  await install();
  const originalCall: ModuleCall = {
    ...call("archived-edit"),
    action: "update",
    input: {
      id: row.id,
      baseVersion: 1,
      baseData: data,
      data: { ...data, name: "Preserved edit" },
    },
  };
  await enqueue(platform, scope, originalCall);
  await changeModuleStorage(platform, scope, (state) => {
    state.journal[0].state = "conflict";
  });
  const review = {
    entryId: "archived-edit",
    recoveryInput: { moduleVersion: "1.1.0", baseVersion: 1 },
  };
  const draft = {
    data: { ...data, name: "Preserved edit" },
    target: { ...row, version: 2, archived: true },
    review,
  };
  const key = resourceDraftKey("contacts", "contacts", review);
  interrupt();
  await expect(
    saveResourceDraft(platform, scope, "contacts", "contacts", draft),
  ).rejects.toThrow("Interrupted commit");
  expect(
    (await readModuleStorage(platform, scope)).drafts[key],
  ).toBeUndefined();
  await saveResourceDraft(platform, scope, "contacts", "contacts", draft);
  const restored = await readModuleStorage(platform, scope);
  expect(restored.drafts[key]).toEqual(draft.data);
  expect(restored.draftTargets?.[key]).toEqual(draft.target);
  expect(restored.draftReviews?.[key]).toEqual(review);
  const recovered = await resourceRecoveryInputs(restored, scope, "contacts");
  expect(recovered.drafts[0].original).toEqual({
    recordId: row.id,
    version: 1,
    data,
  });
  const withoutJournal = await resourceRecoveryInputs(
    { ...restored, journal: [] },
    scope,
    "contacts",
  );
  expect(withoutJournal.drafts[0].original).toEqual({
    recordId: row.id,
    version: 1,
    data: undefined,
  });
  // A later archived snapshot is not evidence of the original submitted base.
  expect(withoutJournal.drafts[0].target?.version).toBe(2);
  expect(restored.journal[0]).toMatchObject({
    call: originalCall,
    state: "conflict",
  });
});

it("atomically orders same-record edits, preserves failed predecessors and reconnects review without a cycle", async () => {
  const { platform, install, interrupt } = storage();
  await install();
  const edit = (key: string, name: string): ModuleCall => ({
    ...call(key),
    action: "update",
    input: {
      id: "record",
      baseVersion: 1,
      baseData: data,
      data: { ...data, name },
    },
  });
  const first = edit("first-edit", "First");
  const second = edit("second-edit", "Second");
  await enqueue(platform, scope, first);
  interrupt();
  await expect(enqueue(platform, scope, second)).rejects.toThrow(
    "Interrupted commit",
  );
  expect((await readModuleStorage(platform, scope)).journal).toHaveLength(1);
  await Promise.all([
    enqueue(platform, scope, second),
    enqueue(platform, scope, edit("third-edit", "Third")),
  ]);
  const entries = () =>
    readModuleStorage(platform, scope).then((s) => s.journal);
  expect((await entries()).map((e) => e.dependencies)).toEqual([
    [],
    ["first-edit"],
    ["second-edit"],
  ]);
  const sent: string[] = [];
  await syncModuleStorage(
    platform,
    scope,
    async (request) => {
      sent.push(request.key!);
      throw { status: 403, message: "Denied" };
    },
    () => true,
  );
  expect(sent).toEqual(["first-edit"]);
  expect((await entries()).map((e) => e.state)).toEqual([
    "rejected",
    "pending",
    "pending",
  ]);
  await enqueue(platform, scope, edit("reviewed-edit", "Reviewed"), [], {
    draftKey: "draft",
    supersedes: "first-edit",
  });
  expect((await entries()).map((e) => e.dependencies)).toEqual([
    [],
    ["reviewed-edit"],
    ["second-edit"],
    [],
  ]);
  await syncModuleStorage(
    platform,
    scope,
    async (request) => {
      sent.push(request.key!);
      return {
        ...row,
        data: (request.input as { data: Record<string, unknown> }).data,
      };
    },
    () => true,
  );
  expect(sent).toEqual([
    "first-edit",
    "reviewed-edit",
    "second-edit",
    "third-edit",
  ]);
  // Ordering never rewrites saved base versions/data or claims a future server version.
  expect((await entries())[1].call).toEqual(second);
  expect((await entries())[0].call).toEqual(first);
});

it("retains original signed versions through updates and uninstall, isolates scopes, and retries uncertain receipts without blocking unrelated work", async () => {
  const { platform, install, root } = storage();
  await install();
  await install(other);
  await enqueue(platform, scope, call("first"));
  await enqueue(platform, scope, call("dependent"), ["first"]);
  await enqueue(platform, scope, call("other", "other", "3.0.0"));
  await install(upgraded);
  await changeModuleStorage(platform, scope, (s) => {
    delete s.installed.other;
    s.journal.push({
      ...s.journal[0],
      userId: "foreign",
      workspaceId: "foreign",
      call: call("foreign"),
    });
  });
  expect(Object.keys(root().responseContractRefs!)).toEqual([
    "contacts@1.1.0",
    "other@3.0.0",
  ]);
  expect(root().responseContracts).toBeUndefined();
  const sent: string[] = [];
  const effects = new Map<string, typeof row>();
  let corrupt = true;
  const send = async (request: ModuleCall) => {
    sent.push(request.key!);
    if (!effects.has(request.key!)) effects.set(request.key!, row);
    return corrupt && request.key === "first"
      ? { ...row, data: { ...data, name: 42 } }
      : effects.get(request.key!);
  };
  await syncModuleStorage(platform, scope, send, () => true);
  let state = await readModuleStorage(platform, scope);
  expect(sent).toEqual(["first", "other"]);
  expect(state.journal[0]).toMatchObject({
    state: "pending",
    attempts: 1,
    call: { key: "first" },
  });
  expect(state.journal[0].result).toBeUndefined();
  expect(state.journal[0].error).toContain("could not be verified");
  expect(state.journal[1]).toMatchObject({ state: "pending", attempts: 0 });
  expect(state.journal[2]).toMatchObject({ state: "accepted", result: row });
  expect(state.journal[3]).toMatchObject({
    userId: "foreign",
    state: "pending",
    attempts: 0,
  });
  await changeModuleStorage(platform, scope, (s) => {
    delete s.installed.contacts;
    s.journal = s.journal.filter((e) => e.userId === scope.userId);
  });
  corrupt = false;
  await syncModuleStorage(platform, scope, send, () => true);
  state = await readModuleStorage(platform, scope);
  expect(sent).toEqual(["first", "other", "first", "dependent"]);
  expect(effects.size).toBe(3);
  expect(state.journal.every((e) => e.state === "accepted" && !e.error)).toBe(
    true,
  );
  expect(root().responseContractRefs).toEqual({});
  expect(state.installed).toEqual({});
});
it("missing or tampered original contracts preserve pending work and do not dispatch, while unrelated entries still synchronize", async () => {
  const { platform, install } = storage();
  await install();
  await install(other);
  await enqueue(platform, scope, call("missing"));
  await enqueue(platform, scope, call("other", "other", "3.0.0"));
  await install(upgraded);
  await changeModuleStorage(platform, scope, (s) => {
    delete s.responseContracts!["contacts@1.1.0"];
  });
  const sent: string[] = [];
  await syncModuleStorage(
    platform,
    scope,
    async (c) => {
      sent.push(c.key!);
      return row;
    },
    () => true,
  );
  expect(sent).toEqual(["other"]);
  let state = await readModuleStorage(platform, scope);
  expect(state.journal[0]).toMatchObject({ state: "pending", attempts: 1 });
  expect(state.journal[0].error).toContain("original signed module version");
  await changeModuleStorage(platform, scope, (s) => {
    s.responseContracts!["contacts@1.1.0"] = {
      signed: {
        ...original,
        artifact: { ...original.artifact, name: "Tampered" },
      },
      publicKey,
    };
  });
  await syncModuleStorage(
    platform,
    scope,
    async () => {
      throw Error("must not dispatch");
    },
    () => true,
  );
  state = await readModuleStorage(platform, scope);
  expect(state.journal[0]).toMatchObject({ state: "pending", attempts: 2 });
  await install();
  await syncModuleStorage(
    platform,
    scope,
    async () => row,
    () => false,
  );
  expect((await readModuleStorage(platform, scope)).journal[0].state).toBe(
    "pending",
  );
  await syncModuleStorage(
    platform,
    scope,
    async () => row,
    () => true,
  );
  expect((await readModuleStorage(platform, scope)).journal[0].state).toBe(
    "accepted",
  );
});
it("atomically retains signed bytes with queued work and recovers missing chunks without losing the journal", async () => {
  const { platform, install, records, root, interrupt } = storage();
  await install();
  await changeModuleStorage(platform, scope, (s) => {
    s.drafts.draft = data;
  });
  interrupt();
  await expect(
    enqueue(platform, scope, call("atomic"), [], { draftKey: "draft" }),
  ).rejects.toThrow("Interrupted commit");
  expect((await readModuleStorage(platform, scope)).journal).toEqual([]);
  expect((await readModuleStorage(platform, scope)).drafts.draft).toEqual(data);
  await enqueue(platform, scope, call("atomic"), [], { draftKey: "draft" });
  await changeModuleStorage(platform, scope, (s) => {
    delete s.installed.contacts;
  });
  const ref = root().responseContractRefs!["contacts@1.1.0"].signedRef;
  records.delete(
    `${scope.userId}/${scope.workspaceId}/module-artifact/${ref.digest}/0`,
  );
  await syncModuleStorage(
    platform,
    scope,
    async () => {
      throw Error("must not dispatch");
    },
    () => true,
  );
  expect((await readModuleStorage(platform, scope)).journal[0]).toMatchObject({
    state: "pending",
    attempts: 1,
  });
  await install();
  await syncModuleStorage(
    platform,
    scope,
    async () => row,
    () => true,
  );
  await changeModuleStorage(platform, scope, (s) => {
    delete s.installed.contacts;
  });
  await changeModuleStorage(platform, scope, () => {});
  expect(
    [...records.keys()].some((k) =>
      isModuleArtifactKey(k.split(`${scope.workspaceId}/`)[1]),
    ),
  ).toBe(false);
  expect((await readModuleStorage(platform, scope)).journal[0].result).toEqual(
    row,
  );
});
it("rejects unversioned or mismatched resource requests before enqueue without discarding the draft", async () => {
  const { platform, install } = storage();
  await install();
  await changeModuleStorage(platform, scope, (s) => {
    s.drafts.draft = data;
  });
  for (const request of [
    { ...call("bad"), moduleVersion: undefined },
    call("bad", "contacts", "2.0.0"),
    { ...call("bad"), resource: "missing" },
  ]) {
    await expect(
      enqueue(platform, scope, request, [], { draftKey: "draft" }),
    ).rejects.toThrow("original signed module version");
  }
  await expect(
    verifyResponseContract({ signed: original, publicKey }, call("valid")),
  ).resolves.toMatchObject({ id: "contacts", version: "1.1.0" });
  expect((await readModuleStorage(platform, scope)).drafts.draft).toEqual(data);
  expect((await readModuleStorage(platform, scope)).journal).toEqual([]);
});

it("derives dependent creates atomically and preserves ordering through rejected-parent review and interrupted storage", async () => {
  const { default: projects } = await import("../../modules/projects/module");
  const { pendingReferenceOptions } =
    await import("../../packages/client/src/modules/storage");
  const { platform, install, interrupt } = storage();
  await install(signPackage(projects, privateKey));
  const projectId = crypto.randomUUID(),
    taskId = crypto.randomUUID();
  const parent: ModuleCall = {
    moduleId: "projects",
    moduleVersion: projects.version,
    resource: "projects",
    action: "create",
    key: "parent",
    input: {
      id: projectId,
      data: { name: "Offline project", status: "planned" },
    },
  };
  const child: ModuleCall = {
    ...parent,
    resource: "tasks",
    key: "child",
    input: {
      id: taskId,
      data: { title: "Dependent task", status: "todo", projectId },
    },
  };
  await enqueue(platform, scope, parent);
  interrupt();
  await expect(enqueue(platform, scope, child)).rejects.toThrow(
    "Interrupted commit",
  );
  expect((await readModuleStorage(platform, scope)).journal).toHaveLength(1);
  await enqueue(platform, scope, child);
  let journal = (await readModuleStorage(platform, scope)).journal;
  expect(journal[1].dependencies).toEqual(["parent"]);
  expect(
    pendingReferenceOptions(journal, scope, {
      kind: "resource",
      moduleId: "projects",
      resource: "projects",
    }),
  ).toEqual([{ value: projectId, label: "Offline project (pending)" }]);
  expect(
    pendingReferenceOptions(
      journal,
      { ...scope, userId: "foreign" },
      { kind: "resource", moduleId: "projects", resource: "projects" },
    ),
  ).toEqual([]);
  const sent: string[] = [];
  await syncModuleStorage(
    platform,
    scope,
    async (request) => {
      sent.push(request.key!);
      throw { status: 403, message: "Permission revoked" };
    },
    () => true,
  );
  expect(sent).toEqual(["parent"]);
  expect((await readModuleStorage(platform, scope)).journal[1].state).toBe(
    "pending",
  );
  const corrected = { ...parent, key: "corrected" };
  await enqueue(platform, scope, corrected, [], {
    draftKey: "draft",
    supersedes: "parent",
  });
  journal = (await readModuleStorage(platform, scope)).journal;
  expect(journal[0].supersededBy).toBe("corrected");
  expect(journal[1].dependencies).toEqual(["corrected"]);
  const send = async (request: ModuleCall) => {
    sent.push(request.key!);
    const input = request.input as {
      id: string;
      data: Record<string, unknown>;
    };
    return { ...row, id: input.id, data: input.data };
  };
  await syncModuleStorage(platform, scope, send, () => true);
  await syncModuleStorage(platform, scope, send, () => true);
  expect(sent).toEqual(["parent", "corrected", "child"]);
  expect(
    (await readModuleStorage(platform, scope)).journal
      .filter((e) => !e.supersededBy)
      .map((e) => e.state),
  ).toEqual(["accepted", "accepted"]);
});

it("rejects changed retry identities, uncertain replacement and dependency cycles without deleting drafts", async () => {
  const { platform, install } = storage();
  await install();
  await enqueue(platform, scope, call("first"));
  await changeModuleStorage(platform, scope, (s) => {
    s.drafts.draft = data;
  });
  await expect(
    enqueue(platform, scope, {
      ...call("first"),
      input: { data: { ...data, name: "Changed" } },
    }),
  ).rejects.toThrow("different content");
  await expect(
    enqueue(platform, scope, call("replacement"), [], {
      draftKey: "draft",
      supersedes: "first",
    }),
  ).rejects.toThrow("uncertain request");
  await expect(
    enqueue(platform, scope, call("cycle"), ["cycle"], { draftKey: "draft" }),
  ).rejects.toThrow("circular reference");
  const stored = await readModuleStorage(platform, scope);
  expect(stored.journal).toHaveLength(1);
  expect(stored.drafts.draft).toEqual(data);
});

it("validates settlement identity and original signed responses before changing uncertain journal state", async () => {
  const { platform, install } = storage();
  await install();
  const originalCall = call("settlement-original");
  await enqueue(platform, scope, originalCall);
  await syncModuleStorage(
    platform,
    scope,
    async () => {
      throw Error("Lost reply");
    },
    () => true,
  );
  const current = async () =>
    (await readModuleStorage(platform, scope)).journal[0];
  await expect(
    settleJournalEntry(
      platform,
      scope,
      "settlement-original",
      async () => ({ key: "another-key", outcome: "cancelled" }),
      () => true,
    ),
  ).rejects.toThrow("different change");
  await expect(
    settleJournalEntry(
      platform,
      scope,
      "settlement-original",
      async () => ({
        key: "settlement-original",
        outcome: "accepted",
        result: { ...row, data: { name: 1 } },
      }),
      () => true,
    ),
  ).rejects.toThrow();
  expect(await current()).toMatchObject({
    state: "pending",
    delivery: "uncertain",
  });
  await install(upgraded);
  expect(
    await settleJournalEntry(
      platform,
      scope,
      "settlement-original",
      async (request) => {
        expect(request).toMatchObject({
          moduleId: "contacts",
          moduleVersion: "1.1.0",
          body: {
            key: "settlement-original",
            call: {
              action: "create",
              resource: "contacts",
              input: originalCall.input,
            },
          },
        });
        return { key: "settlement-original", outcome: "accepted", result: row };
      },
      () => true,
    ),
  ).toBe("accepted");
  expect(await current()).toMatchObject({ state: "accepted", result: row });
  expect((await current()).delivery).toBeUndefined();
});

it("retains uncertainty after interrupted settlement persistence and permits correction only after confirmed cancellation", async () => {
  const { platform, install, interrupt } = storage();
  await install();
  await enqueue(platform, scope, call("settlement-cancel"));
  const settle = vi.fn(async () => ({
    key: "settlement-cancel",
    outcome: "cancelled",
  }));
  await expect(
    settleJournalEntry(
      platform,
      scope,
      "settlement-cancel",
      settle,
      () => true,
    ),
  ).rejects.toThrow("uncertain");
  expect(settle).not.toHaveBeenCalled();
  await syncModuleStorage(
    platform,
    scope,
    async () => {
      throw Error("Lost reply");
    },
    () => true,
  );
  await expect(
    settleJournalEntry(
      platform,
      scope,
      "settlement-cancel",
      settle,
      () => false,
    ),
  ).rejects.toThrow("unlock");
  expect(settle).not.toHaveBeenCalled();
  interrupt();
  await expect(
    settleJournalEntry(
      platform,
      scope,
      "settlement-cancel",
      settle,
      () => true,
    ),
  ).rejects.toThrow("Interrupted commit");
  expect((await readModuleStorage(platform, scope)).journal[0]).toMatchObject({
    state: "pending",
    delivery: "uncertain",
  });
  expect(
    await settleJournalEntry(
      platform,
      scope,
      "settlement-cancel",
      settle,
      () => true,
    ),
  ).toBe("cancelled");
  await enqueue(platform, scope, call("settlement-corrected"), [], {
    draftKey: "contacts/contacts",
    supersedes: "settlement-cancel",
  });
  expect((await readModuleStorage(platform, scope)).journal[0]).toMatchObject({
    state: "rejected",
    supersededBy: "settlement-corrected",
  });
});

it("isolates saved reviews from each other and ordinary drafts, including atomic replacement and stale writers", async () => {
  const { platform, install, interrupt } = storage();
  await install();
  await enqueue(platform, scope, call("review-first"));
  await enqueue(platform, scope, call("review-second"));
  const first = { entryId: "review-first" },
    second = { entryId: "review-second" };
  const firstKey = resourceDraftKey("contacts", "contacts", first);
  const secondKey = resourceDraftKey("contacts", "contacts", second);
  await changeModuleStorage(platform, scope, (state) => {
    state.journal.forEach((entry) => {
      entry.state = "rejected";
    });
    // An existing installation stored its first review in the old shared slot.
    state.drafts["contacts/contacts"] = { ...data, name: "First chosen value" };
    state.draftReviews = { "contacts/contacts": first };
    state.draftTargets = { "contacts/contacts": null };
  });
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: { ...data, name: "Second chosen value" },
    target: null,
    review: second,
  });
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: { ...data, name: "Ordinary draft" },
    target: null,
    generation:
      (await readModuleStorage(platform, scope)).draftGenerations?.[
        "contacts/contacts"
      ] ?? 0,
  });
  let state = await readModuleStorage(platform, scope);
  expect(state.drafts[firstKey].name).toBe("First chosen value");
  expect(state.drafts[secondKey].name).toBe("Second chosen value");
  expect(state.drafts["contacts/contacts"].name).toBe("Ordinary draft");
  interrupt();
  await expect(
    enqueue(platform, scope, call("review-corrected"), [], {
      draftKey: "contacts/contacts",
      supersedes: first.entryId,
    }),
  ).rejects.toThrow("Interrupted commit");
  expect((await readModuleStorage(platform, scope)).drafts).toEqual(
    state.drafts,
  );
  await enqueue(platform, scope, call("review-corrected"), [], {
    draftKey: "contacts/contacts",
    supersedes: first.entryId,
  });
  state = await readModuleStorage(platform, scope);
  expect(state.drafts[firstKey]).toBeUndefined();
  expect(state.drafts[secondKey].name).toBe("Second chosen value");
  expect(state.drafts["contacts/contacts"].name).toBe("Ordinary draft");
  await expect(
    saveResourceDraft(platform, scope, "contacts", "contacts", {
      data,
      target: null,
      review: first,
    }),
  ).rejects.toThrow("no longer belongs");
  await expect(
    saveResourceDraft(
      platform,
      { ...scope, workspaceId: "other" },
      "contacts",
      "contacts",
      { data, target: null, review: second },
    ),
  ).rejects.toThrow("no longer belongs");
  expect((await readModuleStorage(platform, scope)).drafts).toEqual(
    state.drafts,
  );
});

it("retains independent direct comparisons and promotes legacy input without overwriting existing reviews", async () => {
  const { platform, install, root, interrupt } = storage();
  await install();
  // Use the public comparator so fixtures stay tied to the actual stored review format.
  const { reviewFields } = await import("@suite/module-sdk");
  const review = reviewFields(
    { name: "base" },
    { name: "mine" },
    { name: "theirs" },
  ).review;
  const one = { draftId: "direct:first", comparison: review },
    two = { draftId: "direct:second", comparison: review };
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: { name: "mine" },
    target: row,
    review: one,
  });
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: { name: "second" },
    target: { ...row, id: "second" },
    review: two,
  });
  const before = root();
  interrupt();
  await expect(
    saveResourceDraft(platform, scope, "contacts", "contacts", {
      data: { name: "changed" },
      target: row,
      review: one,
    }),
  ).rejects.toThrow("Interrupted commit");
  expect(root()).toEqual(before);
  const state = await readModuleStorage(platform, scope);
  expect(state.drafts[resourceDraftKey("contacts", "contacts", one)].name).toBe(
    "mine",
  );
  expect(state.drafts[resourceDraftKey("contacts", "contacts", two)].name).toBe(
    "second",
  );
  expect(
    resourceDraftKey("contacts", "contacts", { entryId: one.draftId }),
  ).not.toBe(resourceDraftKey("contacts", "contacts", one));
  await changeModuleStorage(platform, scope, (s) => {
    s.drafts["contacts/contacts"] = { name: "Legacy direct choice" };
    (s.draftTargets ??= {})["contacts/contacts"] = row;
    (s.draftReviews ??= {})["contacts/contacts"] = { comparison: review };
  });
  const migrated = await readModuleStorage(platform, scope);
  expect(
    Object.values(migrated.drafts)
      .map((d) => d.name)
      .sort(),
  ).toEqual(["Legacy direct choice", "mine", "second"]);
  expect(migrated.drafts["contacts/contacts"]).toBeUndefined();
  await changeModuleStorage(platform, scope, (state) => {
    state.drafts["contacts/contacts"] = { name: "Legacy alternative" };
    (state.draftTargets ??= {})["contacts/contacts"] = row;
    (state.draftReviews ??= {})["contacts/contacts"] = one;
  });
  const collision = await readModuleStorage(platform, scope);
  expect(
    collision.drafts[resourceDraftKey("contacts", "contacts", one)].name,
  ).toBe("mine");
  expect(collision.drafts["contacts/contacts"].name).toBe("Legacy alternative");
});

const collisionId = "00000000-0000-4000-8000-000000000001";
const separateId = "00000000-0000-4000-8000-000000000002";
const childId = "00000000-0000-4000-8000-000000000003";
const collisionReplacement = (): ModuleCall => ({
  ...call("separate-create"),
  input: { id: separateId, data: { ...data, name: "Corrected" } },
});
async function collisionStorage() {
  const fixture = storage();
  await fixture.install();
  await enqueue(fixture.platform, scope, {
    ...call("original-create"),
    input: { id: collisionId, data },
  });
  await enqueue(fixture.platform, scope, {
    ...call("child-note"),
    resource: "notes",
    input: {
      id: childId,
      data: { contactId: collisionId, text: "Local note" },
    },
  });
  await enqueue(fixture.platform, scope, {
    ...call("independent-create"),
    input: { id: crypto.randomUUID(), data },
  });
  await changeModuleStorage(fixture.platform, scope, (s) => {
    s.journal[0].state = "conflict";
    s.journal[0].errorCode = "RECORD_EXISTS";
    delete s.journal[0].delivery;
    s.journal[0].attempts = 1;
  });
  await saveResourceDraft(fixture.platform, scope, "contacts", "contacts", {
    data,
    target: null,
    review: { entryId: "original-create" },
  });
  return fixture;
}
it("fences failed creates and atomically remaps unsubmitted dependencies with fresh retry identities", async () => {
  const { platform } = await collisionStorage();
  const before = await readModuleStorage(platform, scope);
  const settle = vi.fn(async ({ body }) => ({
    key: body.key,
    outcome: "cancelled",
  }));
  expect(
    await replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      settle,
      () => true,
    ),
  ).toBe("replaced");
  expect(settle.mock.calls[0][0].body).toEqual({
    key: "original-create",
    call: {
      action: "create",
      resource: "contacts",
      input: { id: collisionId, data },
    },
  });
  const state = await readModuleStorage(platform, scope);
  const parent = state.journal.find((e) => e.id === "separate-create")!;
  const child = state.journal.find(
    (e) => e.call.resource === "notes" && !e.supersededBy,
  )!;
  expect(parent).toMatchObject({
    state: "pending",
    delivery: "unsubmitted",
    attempts: 0,
    call: { input: { id: separateId } },
  });
  expect(child).toMatchObject({
    dependencies: [parent.id],
    state: "pending",
    delivery: "unsubmitted",
    attempts: 0,
    call: {
      input: {
        id: childId,
        data: { contactId: separateId, text: "Local note" },
      },
    },
  });
  expect(child.id).not.toBe("child-note");
  expect(child.call.key).toBe(child.id);
  expect(state.journal[0]).toMatchObject({
    settlement: "cancelled",
    supersededBy: parent.id,
    call: before.journal[0].call,
  });
  expect(state.journal[1]).toMatchObject({
    supersededBy: child.id,
    call: before.journal[1].call,
  });
  expect(state.journal[2]).toEqual(before.journal[2]);
  expect(Object.keys(state.drafts)).toEqual([]);
  await expect(
    replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      settle,
      () => true,
    ),
  ).rejects.toThrow("Only a failed create");
  expect(settle).toHaveBeenCalledTimes(1);
});
it("recovers an already accepted create without making a separate record or rewriting its children", async () => {
  const { platform } = await collisionStorage();
  const result = { ...row, id: collisionId };
  expect(
    await replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => ({ key: "original-create", outcome: "accepted", result }),
      () => true,
    ),
  ).toBe("accepted");
  const state = await readModuleStorage(platform, scope);
  expect(state.journal).toHaveLength(3);
  expect(state.journal[0]).toMatchObject({ state: "accepted", result });
  expect(state.journal[0].errorCode).toBeUndefined();
  expect(state.journal[1]).toMatchObject({
    dependencies: ["original-create"],
    call: { input: { data: { contactId: collisionId } } },
  });
  expect(Object.keys(state.drafts)).toEqual([]);
});
it.each([1, 2])(
  "preserves all input across interrupted recovery write %i and safely retries the same server fence",
  async (write) => {
    const { platform, interrupt } = await collisionStorage();
    const settle = vi.fn(async () => ({
      key: "original-create",
      outcome: "cancelled",
    }));
    interrupt(write);
    await expect(
      replaceFailedCreate(
        platform,
        scope,
        "original-create",
        collisionReplacement(),
        settle,
        () => true,
      ),
    ).rejects.toThrow("Interrupted commit");
    const failed = await readModuleStorage(platform, scope);
    expect(failed.journal).toHaveLength(3);
    expect(failed.journal.every((e) => !e.supersededBy)).toBe(true);
    expect(Object.keys(failed.drafts)).toHaveLength(1);
    expect(failed.journal[0].settlement).toBe(
      write === 2 ? "cancelled" : undefined,
    );
    await replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      settle,
      () => true,
    );
    expect(settle).toHaveBeenCalledTimes(2);
    expect((await readModuleStorage(platform, scope)).journal).toHaveLength(5);
  },
);
it("rejects malformed settlement and post-response revocation without replacing input", async () => {
  const { platform } = await collisionStorage();
  const before = await readModuleStorage(platform, scope);
  for (const reply of [
    { key: "wrong-key", outcome: "cancelled" },
    { key: "original-create", outcome: "accepted", result: { bad: true } },
  ]) {
    await expect(
      replaceFailedCreate(
        platform,
        scope,
        "original-create",
        collisionReplacement(),
        async () => reply,
        () => true,
      ),
    ).rejects.toThrow();
    expect(await readModuleStorage(platform, scope)).toEqual(before);
  }
  let allowed = true;
  await expect(
    replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => {
        allowed = false;
        return { key: "original-create", outcome: "cancelled" };
      },
      () => allowed,
    ),
  ).rejects.toThrow("Unlock this workspace again");
  expect(await readModuleStorage(platform, scope)).toEqual(before);
});
it.each([
  "uncertain",
  "legacy",
  "accepted",
  "draft",
  "permission",
  "cycle",
  "same-record",
  "duplicate-id",
  "custom",
])(
  "preserves blocked collision recovery (%s) and its verified cancellation",
  async (problem) => {
    const { platform } = await collisionStorage();
    await changeModuleStorage(platform, scope, (s) => {
      const child = s.journal[1];
      if (problem === "uncertain") child.delivery = "uncertain";
      if (problem === "legacy") delete child.delivery;
      if (problem === "accepted") child.state = "accepted";
      if (problem === "draft")
        s.drafts["contacts/notes"] = { contactId: collisionId, text: "Unsent" };
      if (problem === "cycle") s.journal[0].dependencies = [child.id];
      if (problem === "same-record") {
        child.call = {
          ...call(child.id),
          action: "update",
          input: { id: collisionId, data, baseVersion: 1 },
        };
      }
      if (problem === "duplicate-id")
        s.journal[2].call.input = { id: separateId, data };
      if (problem === "custom")
        child.call = {
          moduleId: "contacts",
          action: "operation",
          operation: "custom",
          input: {},
          key: child.id,
        };
    });
    const before = await readModuleStorage(platform, scope);
    await expect(
      replaceFailedCreate(
        platform,
        scope,
        "original-create",
        collisionReplacement(),
        async () => ({ key: "original-create", outcome: "cancelled" }),
        (call) => problem !== "permission" || call.resource !== "notes",
      ),
    ).rejects.toThrow();
    const after = await readModuleStorage(platform, scope);
    expect(after.journal).toHaveLength(3);
    expect(after.journal.every((e) => !e.supersededBy)).toBe(true);
    expect(after.journal[0].settlement).toBe("cancelled");
    expect(after.journal.slice(1)).toEqual(before.journal.slice(1));
    expect(after.drafts).toEqual(before.drafts);
  },
);
it("requires a server cancellation and fresh valid identities before preparing a replacement", async () => {
  const { platform } = await collisionStorage();
  const state = await readModuleStorage(platform, scope);
  await expect(
    prepareCreateReplacement(
      state,
      scope,
      "original-create",
      collisionReplacement(),
      () => true,
    ),
  ).rejects.toThrow("server must confirm");
  state.journal[0].settlement = "cancelled";
  const before = structuredClone(state);
  for (const replacement of [
    { ...collisionReplacement(), key: "short" },
    { ...collisionReplacement(), key: "original-create" },
    { ...collisionReplacement(), input: { id: collisionId, data } },
    { ...collisionReplacement(), input: { id: "invalid", data } },
    { ...collisionReplacement(), resource: "notes" },
  ])
    await expect(
      prepareCreateReplacement(
        state,
        scope,
        "original-create",
        replacement,
        () => true,
      ),
    ).rejects.toThrow();
  expect(state).toEqual(before);
  await expect(
    prepareCreateReplacement(
      state,
      { ...scope, workspaceId: "foreign" },
      "original-create",
      collisionReplacement(),
      () => true,
    ),
  ).rejects.toThrow();
});

it("remaps transitive linked edits while preserving their server base, foreign scope and ordinary draft", async () => {
  const { platform } = await collisionStorage();
  const baseData = {
    contactId: collisionId,
    kind: "office",
    street: "Old",
    city: "Madrid",
    country: "Spain",
  };
  await enqueue(
    platform,
    scope,
    {
      ...call("linked-address"),
      resource: "addresses",
      action: "update",
      input: {
        id: crypto.randomUUID(),
        data: { ...baseData, street: "Local" },
        baseVersion: 3,
        baseData,
      },
    },
    ["child-note"],
  );
  await changeModuleStorage(platform, scope, (s) => {
    s.drafts["contacts/contacts"] = { ...data, name: "Another draft" };
    s.journal.push({
      ...structuredClone(s.journal[1]),
      id: "foreign-note",
      userId: "foreign",
      workspaceId: "foreign",
    });
  });
  const before = await readModuleStorage(platform, scope);
  await replaceFailedCreate(
    platform,
    scope,
    "original-create",
    collisionReplacement(),
    async () => ({ key: "original-create", outcome: "cancelled" }),
    () => true,
  );
  const after = await readModuleStorage(platform, scope);
  const note = after.journal.find(
    (e) =>
      e.call.resource === "notes" &&
      e.userId === scope.userId &&
      !e.supersededBy,
  )!;
  const address = after.journal.find(
    (e) => e.call.resource === "addresses" && !e.supersededBy,
  )!;
  expect(address.call.input).toEqual({
    ...(before.journal[3].call.input as object),
    data: { ...baseData, street: "Local", contactId: separateId },
  });
  expect(address.dependencies).toEqual([note.id, "separate-create"]);
  expect(after.journal.find((e) => e.id === "foreign-note")).toEqual(
    before.journal.find((e) => e.id === "foreign-note"),
  );
  expect(after.drafts["contacts/contacts"]).toEqual(
    before.drafts["contacts/contacts"],
  );
});

it("rechecks every linked permission after asynchronous contract verification", async () => {
  const { platform } = await collisionStorage();
  let noteChecks = 0;
  await expect(
    replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => ({ key: "original-create", outcome: "cancelled" }),
      (call) => call.resource !== "notes" || ++noteChecks === 1,
    ),
  ).rejects.toThrow("Current access changed");
  const state = await readModuleStorage(platform, scope);
  expect(state.journal).toHaveLength(3);
  expect(state.journal[0].settlement).toBe("cancelled");
  expect(state.journal.every((entry) => !entry.supersededBy)).toBe(true);
  expect(Object.keys(state.drafts)).toHaveLength(1);
});

it("commits legacy ordering gates before dispatch and retains exact uncertain input when a repair write fails", async () => {
  const { platform, install, root, interrupt } = storage();
  await install();
  for (const key of ["legacy-old", "legacy-later", "unrelated"])
    await enqueue(platform, scope, {
      ...call(key),
      action: "update",
      input: {
        id: key === "unrelated" ? "different" : row.id,
        baseVersion: 1,
        baseData: data,
        data: { ...data, name: key },
      },
    });
  const legacy = root();
  legacy.journal.forEach((entry) => {
    entry.dependencies = [];
  });
  delete legacy.journal[0].delivery;
  await platform.save(scope, "module-state", legacy);
  const send = vi.fn(async (_call: ModuleCall) => ({ ...row, version: 2 }));
  interrupt();
  await expect(
    syncModuleStorage(platform, scope, send, () => true),
  ).rejects.toThrow("Interrupted commit");
  expect(send).not.toHaveBeenCalled();
  expect(root().journal).toEqual(legacy.journal);
  await syncModuleStorage(platform, scope, send, () => true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toMatchObject({ key: "unrelated" });
  expect(
    root()
      .journal.slice(0, 2)
      .map((e) => e.orderingRecovery),
  ).toEqual(["outcome", "waiting"]);
  expect(root().journal.map((e) => e.call)).toEqual(
    legacy.journal.map((e) => e.call),
  );
  await settleJournalEntry(
    platform,
    scope,
    "legacy-old",
    async (request) => ({
      key: request.body.key,
      outcome: "cancelled",
    }),
    () => true,
  );
  await syncModuleStorage(platform, scope, send, () => true);
  expect(send).toHaveBeenCalledTimes(1); // cancellation needs review, never counts as acceptance
  expect(root().journal[0]).toMatchObject({
    state: "rejected",
    settlement: "cancelled",
  });
  expect(root().journal[1]).toMatchObject({
    state: "pending",
    dependencies: ["legacy-old"],
  });
  expect(root().journal[1].orderingRecovery).toBeUndefined();
});

it.each(["separate", "existing"] as const)(
  "keeps a same-record descendant inert for explicit %s-record review, then validates its chosen target and prerequisites",
  async (destination) => {
    const { platform } = await collisionStorage();
    const edit = {
      ...call("later-record-edit"),
      action: "update" as const,
      input: {
        id: collisionId,
        baseVersion: 7,
        baseData: data,
        data: { ...data, name: "Later edit" },
      },
    };
    await enqueue(platform, scope, edit);
    await replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => ({ key: "original-create", outcome: "cancelled" }),
      () => true,
      { "later-record-edit": destination },
    );
    let state = await readModuleStorage(platform, scope);
    const prior = state.journal.find((e) => e.id === edit.key)!;
    const retained = state.journal.find((e) => e.id === prior.supersededBy)!;
    const targetId = destination === "separate" ? separateId : collisionId;
    expect(prior.call).toEqual(edit);
    expect(retained.call.input).toEqual(edit.input);
    expect(retained).toMatchObject({
      state: "conflict",
      delivery: "unsubmitted",
      attempts: 0,
      recordRecovery: { targetId, destination },
    });
    const send = vi.fn(async (call: ModuleCall) => ({
      ...row,
      id: (call.input as { id: string }).id,
      data: (call.input as { data: unknown }).data,
    }));
    const reviewed = {
      ...edit,
      key: "reviewed-record-edit",
      input: { ...edit.input, id: targetId, baseVersion: 1 },
    };
    const recovery = {
      draftKey: resourceDraftKey("contacts", "contacts", {
        entryId: retained.id,
      }),
      supersedes: retained.id,
    };
    await expect(
      enqueue(platform, scope, reviewed, [], recovery),
    ).rejects.toThrow("prerequisite");
    await syncModuleStorage(platform, scope, send, () => true);
    expect(send.mock.calls.every(([call]) => call.action === "create")).toBe(
      true,
    );
    const target = { ...row, id: targetId };
    await saveResourceDraft(platform, scope, "contacts", "contacts", {
      data,
      target,
      review: { entryId: retained.id },
    });
    await expect(
      enqueue(
        platform,
        scope,
        { ...reviewed, input: { ...reviewed.input, id: crypto.randomUUID() } },
        [],
        recovery,
      ),
    ).rejects.toThrow("original record target");
    await enqueue(platform, scope, reviewed, [], recovery);
    await syncModuleStorage(platform, scope, send, () => true);
    state = await readModuleStorage(platform, scope);
    expect(state.journal.find((e) => e.id === reviewed.key)?.state).toBe(
      "accepted",
    );
    expect(
      send.mock.calls.filter(([call]) => call.action === "update"),
    ).toEqual([[reviewed]]);
    expect(state.journal.find((e) => e.id === edit.key)?.call).toEqual(edit);
  },
);

it("requires a choice for every affected edit and rejects stale choices without changing the graph", async () => {
  const { platform } = await collisionStorage();
  await enqueue(platform, scope, {
    ...call("later-record-edit"),
    action: "update",
    input: { id: collisionId, data, baseVersion: 1 },
  });
  const before = await readModuleStorage(platform, scope);
  for (const targets of [
    {},
    { "wrong-edit": "separate" },
    { "later-record-edit": "separate", "wrong-edit": "existing" },
  ] as const) {
    await expect(
      replaceFailedCreate(
        platform,
        scope,
        "original-create",
        collisionReplacement(),
        async () => ({ key: "original-create", outcome: "cancelled" }),
        () => true,
        targets,
      ),
    ).rejects.toThrow("Choose where");
    const after = await readModuleStorage(platform, scope);
    expect(after.journal.map((e) => e.call)).toEqual(
      before.journal.map((e) => e.call),
    );
    expect(after.journal.every((e) => !e.supersededBy)).toBe(true);
  }
});

it("requires a fresh target choice if a replacement create collides again, preserving every prior edit body", async () => {
  const { platform } = await collisionStorage();
  const edit: ModuleCall = {
    ...call("later-record-edit"),
    action: "update",
    input: {
      id: collisionId,
      baseVersion: 1,
      baseData: data,
      data: { ...data, name: "Edit" },
    },
  };
  await enqueue(platform, scope, edit);
  await replaceFailedCreate(
    platform,
    scope,
    "original-create",
    collisionReplacement(),
    async () => ({ key: "original-create", outcome: "cancelled" }),
    () => true,
    { "later-record-edit": "separate" },
  );
  await changeModuleStorage(platform, scope, (state) => {
    const parent = state.journal.find((e) => e.id === "separate-create")!;
    parent.state = "conflict";
    parent.errorCode = "RECORD_EXISTS";
    parent.attempts = 1;
    delete parent.delivery;
  });
  const state = await readModuleStorage(platform, scope);
  const retained = state.journal.find((e) => e.recordRecovery)!;
  const nextId = crypto.randomUUID();
  const next = {
    ...collisionReplacement(),
    key: "another-separate-create",
    input: { id: nextId, data },
  };
  await replaceFailedCreate(
    platform,
    scope,
    "separate-create",
    next,
    async () => ({ key: "separate-create", outcome: "cancelled" }),
    () => true,
    { [retained.id]: "separate" },
  );
  const latest = await readModuleStorage(platform, scope);
  const review = latest.journal.find(
    (e) => e.recordRecovery && !e.supersededBy,
  )!;
  expect(review.recordRecovery?.targetId).toBe(nextId);
  expect(review.call.input).toEqual(edit.input);
  expect(review.state).toBe("conflict");
  expect(latest.journal.find((e) => e.id === edit.key)?.call).toEqual(edit);
  // An archived chosen target keeps original source metadata for recovery export.
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: (edit.input as { data: Record<string, unknown> }).data,
    target: { ...row, id: nextId, archived: true },
    review: {
      entryId: review.id,
      recoveryInput: {
        moduleVersion: "1.1.0",
        baseVersion: 1,
        recordId: collisionId,
      },
    },
  });
  const draft = resourceDraftKey("contacts", "contacts", {
    entryId: review.id,
  });
  expect(
    (await readModuleStorage(platform, scope)).draftReviews?.[draft]
      ?.recoveryInput,
  ).toEqual({ moduleVersion: "1.1.0", baseVersion: 1, recordId: collisionId });
});

it("uses original draft schemas to distinguish links from free text and preserves chosen drafts as non-executable reviews", async () => {
  const { platform, install } = await collisionStorage();
  const note = { contactId: collisionId, text: "Unqueued note" };
  await saveResourceDraft(platform, scope, "contacts", "notes", {
    data: note,
    target: null,
  });
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: { ...data, phone: collisionId },
    target: null,
  });
  await install(upgraded);
  const drafts = await collisionDrafts(
    await readModuleStorage(platform, scope),
    scope,
    "original-create",
  );
  expect(drafts.map((draft) => draft.key)).toEqual(["contacts/notes"]);
  expect(drafts[0]).toMatchObject({ moduleVersion: "1.1.0", movable: true });
  await replaceFailedCreate(
    platform,
    scope,
    "original-create",
    collisionReplacement(),
    async () => ({ key: "original-create", outcome: "cancelled" }),
    () => true,
    {},
    {
      [drafts[0].key]: {
        fingerprint: drafts[0].fingerprint,
        destination: "separate",
      },
    },
  );
  const state = await readModuleStorage(platform, scope);
  const key = Object.keys(state.draftReviews!).find(
    (key) => state.draftReviews![key].collision,
  )!;
  expect(state.drafts[key]).toEqual({ ...note, contactId: separateId });
  expect(state.draftReviews![key].collision).toMatchObject({
    sourceData: note,
    sourceTarget: null,
    moduleVersion: "1.1.0",
    parentId: "separate-create",
  });
  expect(state.drafts["contacts/notes"]).toBeUndefined();
  expect(state.drafts["contacts/contacts"].phone).toBe(collisionId);
  expect(state.journal).toHaveLength(5); // no request is invented for the ordinary draft
  await expect(
    saveResourceDraft(platform, scope, "contacts", "notes", {
      data: { ...note, text: "Stale editor" },
      target: null,
      generation: 0,
    }),
  ).rejects.toThrow("another view");
  await expect(
    enqueue(
      platform,
      scope,
      {
        ...call("stale-draft-key"),
        resource: "notes",
        input: { id: crypto.randomUUID(), data: note },
      },
      [],
      { draftKey: "contacts/notes", generation: 0 },
    ),
  ).rejects.toThrow("another view");
  await expect(
    enqueue(
      platform,
      scope,
      {
        ...call("unreviewed-key"),
        resource: "notes",
        input: { id: crypto.randomUUID(), data: note },
      },
      [],
      { draftKey: key },
    ),
  ).rejects.toThrow("Review this draft");
});

it("requires fresh choices after a draft changes and recognizes record targets without embedded reference values", async () => {
  const { platform } = await collisionStorage();
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data,
    target: { ...row, id: collisionId },
  });
  const first = (
    await collisionDrafts(
      await readModuleStorage(platform, scope),
      scope,
      "original-create",
    )
  )[0];
  expect(first.sameRecord).toBe(true);
  await saveResourceDraft(platform, scope, "contacts", "contacts", {
    data: { ...data, name: "Changed elsewhere" },
    target: { ...row, id: collisionId },
  });
  await expect(
    replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => ({ key: "original-create", outcome: "cancelled" }),
      () => true,
      {},
      {
        [first.key]: {
          fingerprint: first.fingerprint,
          destination: "separate",
        },
      },
    ),
  ).rejects.toThrow("fresh choice");
  const current = await readModuleStorage(platform, scope);
  expect(current.drafts[first.key].name).toBe("Changed elsewhere");
  expect(current.journal.every((entry) => !entry.supersededBy)).toBe(true);
  const fresh = (await collisionDrafts(current, scope, "original-create"))[0];
  await replaceFailedCreate(
    platform,
    scope,
    "original-create",
    collisionReplacement(),
    async () => ({ key: "original-create", outcome: "cancelled" }),
    () => true,
    {},
    {
      [fresh.key]: { fingerprint: fresh.fingerprint, destination: "separate" },
    },
  );
  const result = await readModuleStorage(platform, scope);
  const review = Object.values(result.draftReviews!).find(
    (review) => review.collision,
  )!.collision!;
  expect(review.targetId).toBe(separateId);
  expect(review.sourceTarget?.id).toBe(collisionId);
  expect(review.sourceData.name).toBe("Changed elsewhere");
});

it.each(["legacy", "online"])(
  "keeps %s drafts unchanged after explicit preservation and never silently remaps their history",
  async (kind) => {
    const { platform, install } = await collisionStorage();
    if (kind === "online")
      await install(
        signPackage(
          {
            ...contacts,
            version: "3.0.0",
            resources: {
              ...contacts.resources,
              notes: { ...contacts.resources.notes, policy: "online" },
            },
          },
          privateKey,
        ),
      );
    const note = { contactId: collisionId, text: "Preserve exact input" };
    await saveResourceDraft(platform, scope, "contacts", "notes", {
      data: note,
      target: null,
    });
    if (kind === "legacy")
      await changeModuleStorage(platform, scope, (state) => {
        delete state.draftVersions?.["contacts/notes"];
      });
    const draft = (
      await collisionDrafts(
        await readModuleStorage(platform, scope),
        scope,
        "original-create",
      )
    )[0];
    expect(draft.movable).toBe(false);
    await expect(
      replaceFailedCreate(
        platform,
        scope,
        "original-create",
        collisionReplacement(),
        async () => ({ key: "original-create", outcome: "cancelled" }),
        () => true,
        {},
        {
          [draft.key]: {
            fingerprint: draft.fingerprint,
            destination: "separate",
          },
        },
      ),
    ).rejects.toThrow("cannot be moved safely");
    await replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => ({ key: "original-create", outcome: "cancelled" }),
      () => true,
      {},
      {
        [draft.key]: {
          fingerprint: draft.fingerprint,
          destination: "existing",
        },
      },
    );
    expect(
      (await readModuleStorage(platform, scope)).drafts[draft.key],
    ).toEqual(note);
  },
);

it("commits draft promotion and retirement atomically, and prevents stale review resurrection", async () => {
  const { platform, interrupt } = await collisionStorage();
  const note = { contactId: collisionId, text: "Atomic input" };
  await saveResourceDraft(platform, scope, "contacts", "notes", {
    data: note,
    target: null,
  });
  const draft = (
    await collisionDrafts(
      await readModuleStorage(platform, scope),
      scope,
      "original-create",
    )
  )[0];
  const choices = {
    [draft.key]: {
      fingerprint: draft.fingerprint,
      destination: "existing" as const,
    },
  };
  interrupt(2);
  await expect(
    replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => ({ key: "original-create", outcome: "cancelled" }),
      () => true,
      {},
      choices,
    ),
  ).rejects.toThrow("Interrupted commit");
  const intact = await readModuleStorage(platform, scope);
  expect(intact.drafts[draft.key]).toEqual(note);
  expect(intact.draftGenerations?.[draft.key] ?? 0).toBe(0);
  await replaceFailedCreate(
    platform,
    scope,
    "original-create",
    collisionReplacement(),
    async () => ({ key: "original-create", outcome: "cancelled" }),
    () => true,
    {},
    choices,
  );
  const state = await readModuleStorage(platform, scope);
  const [key, review] = Object.entries(state.draftReviews!).find(
    ([, review]) => review.collision,
  )!;
  await changeModuleStorage(platform, scope, (state) => {
    delete state.drafts[key];
    delete state.draftReviews![key];
  });
  await expect(
    saveResourceDraft(platform, scope, "contacts", "notes", {
      data: note,
      target: null,
      review,
    }),
  ).rejects.toThrow("another view");
});

it("reconnects preserved drafts after a repeated parent collision without rewriting an earlier existing-record choice", async () => {
  const { platform } = await collisionStorage();
  const note = { contactId: collisionId, text: "Keep this existing link" };
  await saveResourceDraft(platform, scope, "contacts", "notes", {
    data: note,
    target: null,
  });
  const draft = (
    await collisionDrafts(
      await readModuleStorage(platform, scope),
      scope,
      "original-create",
    )
  )[0];
  await replaceFailedCreate(
    platform,
    scope,
    "original-create",
    collisionReplacement(),
    async () => ({ key: "original-create", outcome: "cancelled" }),
    () => true,
    {},
    {
      [draft.key]: { fingerprint: draft.fingerprint, destination: "existing" },
    },
  );
  const before = await readModuleStorage(platform, scope);
  const key = Object.keys(before.draftReviews!).find(
    (key) => !!before.draftReviews![key].collision,
  )!;
  await changeModuleStorage(platform, scope, (state) => {
    const parent = state.journal.find(
      (entry) => entry.id === "separate-create",
    )!;
    parent.state = "conflict";
    parent.attempts = 1;
    delete parent.delivery;
  });
  const replacement = {
    ...collisionReplacement(),
    key: "second-separate-create",
    input: { id: crypto.randomUUID(), data },
  };
  await replaceFailedCreate(
    platform,
    scope,
    "separate-create",
    replacement,
    async () => ({ key: "separate-create", outcome: "cancelled" }),
    () => true,
  );
  const after = await readModuleStorage(platform, scope);
  expect(after.drafts[key]).toEqual(note);
  expect(after.draftReviews![key].collision).toEqual({
    ...before.draftReviews![key].collision,
    parentId: replacement.key,
  });
});

const commandModule = {
  ...contacts,
  operations: {
    capture: operation({
      title: "Capture note",
      policy: "queued",
      permission: "contacts.contacts.write",
      input: Type.Object(
        {
          text: Type.String(),
          contactId: Type.Optional(field.reference("contacts", "contacts")),
        },
        { additionalProperties: false },
      ),
      output: Type.Object(
        { saved: Type.Boolean() },
        { additionalProperties: false },
      ),
      errors: Type.Object(
        { reason: Type.Literal("closed") },
        { additionalProperties: false },
      ),
    }),
    commit: operation({
      title: "Commit",
      policy: "online",
      permission: "contacts.contacts.write",
      input: Type.Object({}),
      output: Type.Boolean(),
    }),
    lookup: operation({
      title: "Lookup",
      kind: "query",
      policy: "online",
      permission: "contacts.contacts.read",
      input: Type.Object({}),
      output: Type.Boolean(),
    }),
    internal: operation({
      title: "Internal",
      policy: "queued",
      serviceOnly: true,
      public: true,
      permission: "contacts.contacts.write",
      input: Type.Object({}),
      output: Type.Boolean(),
    }),
  },
};
const commandsPackage = signPackage(commandModule, privateKey);
async function commandStorage(authority: () => boolean = () => true) {
  const state = storage();
  await state.install(commandsPackage);
  const send = vi.fn(async () => {
    throw Error("Direct transport must not be used for capture");
  });
  const provider = createModuleQueue(state.platform, scope, authority);
  const client = createModuleClient(commandModule, send, provider);
  return { ...state, client, provider, send };
}

it("captures typed queued commands durably without returning an accepted output or invoking transport", async () => {
  const { client, platform, send } = await commandStorage();
  const result = await client.queue(
    "capture",
    { text: "Offline note" },
    { key: "note:queued/001" },
  );
  expect(result).toMatchObject({
    state: "pending",
    delivery: "unsubmitted",
    input: { text: "Offline note" },
  });
  expect(result).not.toHaveProperty("value");
  expect(send).not.toHaveBeenCalled();
  const restarted = createModuleClient(
    commandModule,
    send,
    createModuleQueue(platform, scope, () => true),
  );
  expect(await restarted.queued("capture", result.key)).toEqual(result);
  expect(
    await restarted.queue(
      "capture",
      { text: "Offline note" },
      { key: result.key },
    ),
  ).toEqual(result);
  expect((await readModuleStorage(platform, scope)).journal).toHaveLength(1);
  if (false) {
    // @ts-expect-error Online commands cannot be queued.
    await client.queue("commit", {});
    // @ts-expect-error Queries cannot be queued.
    await client.queue("lookup", {});
    // @ts-expect-error Service-only commands cannot be queued by a client.
    await client.queue("internal", {});
    // @ts-expect-error Inputs are inferred from the operation schema.
    await client.queue("capture", { text: 4 });
    if (result.state === "pending") {
      // @ts-expect-error Pending is not an operation output.
      result.value;
    }
  }
});

it("rejects unsafe capture policies, invalid input, changed identities and changed prerequisites", async () => {
  const { client, provider, platform } = await commandStorage();
  for (const name of ["commit", "lookup", "internal", "missing"]) {
    await expect(
      provider.capture(
        {
          moduleId: "contacts",
          moduleVersion: commandModule.version,
          action: "operation",
          operation: name,
          input: {},
          key: "invalid-policy",
        },
        [],
      ),
    ).rejects.toThrow();
  }
  await expect(
    provider.capture(
      {
        moduleId: "contacts",
        moduleVersion: commandModule.version,
        action: "operation",
        operation: "capture",
        input: { text: 5 },
        key: "invalid-input",
      },
      [],
    ),
  ).rejects.toThrow();
  expect((await readModuleStorage(platform, scope)).journal).toHaveLength(0);
  await client.queue(
    "capture",
    { text: "First" },
    { key: "stable-identity", dependencies: ["prerequisite-key"] },
  );
  await expect(
    client.queue(
      "capture",
      { text: "Changed" },
      { key: "stable-identity", dependencies: ["prerequisite-key"] },
    ),
  ).rejects.toThrow("different content");
  await expect(
    client.queue("capture", { text: "First" }, { key: "stable-identity" }),
  ).rejects.toThrow("different prerequisites");
  await expect(
    client.queue(
      "capture",
      { text: "Cycle" },
      { key: "circular-key", dependencies: ["circular-key"] },
    ),
  ).rejects.toThrow("itself");
});

it("retains original operation contracts after an upgrade and returns accepted results on exact repeated capture", async () => {
  const { client, platform, install } = await commandStorage();
  const queued = await client.queue(
    "capture",
    { text: "Original release" },
    { key: "original-command" },
  );
  const upgrade = {
    ...commandModule,
    version: "9.0.0",
    operations: {
      ...commandModule.operations,
      capture: { ...commandModule.operations.capture, output: Type.String() },
    },
  };
  await install(signPackage(upgrade, privateKey));
  const sent = vi.fn(async () => ({ saved: true }));
  await syncModuleStorage(platform, scope, sent, () => true);
  expect(sent.mock.calls).toHaveLength(1);
  expect(await client.queued("capture", queued.key)).toMatchObject({
    state: "accepted",
    value: { saved: true },
    moduleVersion: commandModule.version,
  });
  expect(
    await client.queue(
      "capture",
      { text: "Original release" },
      { key: queued.key },
    ),
  ).toMatchObject({ state: "accepted", value: { saved: true } });
  await syncModuleStorage(platform, scope, sent, () => true);
  expect(sent).toHaveBeenCalledTimes(1);
  await expect(
    createModuleClient(
      upgrade,
      sent,
      createModuleQueue(platform, scope, () => true),
    ).queued("capture", queued.key),
  ).rejects.toThrow("original contract");
});

it("orders operation reference dependencies behind captured creates", async () => {
  const { platform, client } = await commandStorage();
  const id = crypto.randomUUID();
  await enqueue(platform, scope, {
    ...call("parent-create-key"),
    input: { id, data },
  });
  const child = await client.queue(
    "capture",
    { text: "Linked", contactId: id },
    { key: "dependent-command" },
  );
  expect(child.dependencies).toEqual(["parent-create-key"]);
  const keys: string[] = [];
  await syncModuleStorage(
    platform,
    scope,
    async (call) => {
      keys.push(call.key!);
      return call.action === "operation" ? { saved: true } : { ...row, id };
    },
    () => true,
  );
  expect(keys).toEqual(["parent-create-key", "dependent-command"]);
  expect(await client.queued("capture", child.key)).toMatchObject({
    state: "accepted",
  });
});

it("retains uncertain command identity across restart and later denial, while definite rejections do not block unrelated work", async () => {
  const { client, platform, send } = await commandStorage();
  const failed = await client.queue(
    "capture",
    { text: "Closed" },
    { key: "business-reject" },
  );
  const independent = await client.queue(
    "capture",
    { text: "Independent" },
    { key: "independent-key" },
  );
  await syncModuleStorage(
    platform,
    scope,
    async (call) => {
      if (call.key === failed.key)
        throw {
          status: 422,
          code: "MODULE_BUSINESS_ERROR",
          message: "Closed",
          detail: {
            moduleId: "contacts",
            operation: "capture",
            error: { reason: "closed" },
          },
        };
      return { saved: true };
    },
    () => true,
  );
  const rejected = await client.queued("capture", failed.key);
  expect(rejected).toMatchObject({
    state: "rejected",
    error: { businessError: { reason: "closed" } },
  });
  if (rejected?.state === "rejected") {
    const reason: "closed" | undefined = rejected.error.businessError?.reason;
    expect(reason).toBe("closed");
  }
  expect(await client.queued("capture", independent.key)).toMatchObject({
    state: "accepted",
  });
  const uncertain = await client.queue(
    "capture",
    { text: "Lost reply" },
    { key: "uncertain-command" },
  );
  await syncModuleStorage(
    platform,
    scope,
    async () => {
      throw Error("Connection lost");
    },
    () => true,
  );
  const restarted = createModuleClient(
    commandModule,
    send,
    createModuleQueue(platform, scope, () => true),
  );
  expect(await restarted.queued("capture", uncertain.key)).toMatchObject({
    state: "pending",
    delivery: "uncertain",
  });
  await syncModuleStorage(
    platform,
    scope,
    async () => {
      throw { status: 403, code: "FORBIDDEN", message: "Revoked" };
    },
    () => true,
  );
  expect(await restarted.queued("capture", uncertain.key)).toMatchObject({
    state: "pending",
    delivery: "uncertain",
  });
  expect(
    (await readModuleStorage(platform, scope)).journal.find(
      (entry) => entry.id === uncertain.key,
    )?.call.key,
  ).toBe(uncertain.key);
});

it("keeps malformed operation output and declared errors uncertain instead of accepting or rejecting them", async () => {
  const { platform, client } = await commandStorage();
  const success = await client.queue(
    "capture",
    { text: "Unverified output" },
    { key: "bad-output-key" },
  );
  const failure = await client.queue(
    "capture",
    { text: "Unverified error" },
    { key: "bad-error-key" },
  );
  await syncModuleStorage(
    platform,
    scope,
    async (call) => {
      if (call.key === success.key) return { saved: "not boolean" };
      throw {
        status: 422,
        code: "MODULE_BUSINESS_ERROR",
        detail: {
          moduleId: "contacts",
          operation: "capture",
          error: { reason: 42 },
        },
      };
    },
    () => true,
  );
  for (const key of [success.key, failure.key])
    expect(await client.queued("capture", key)).toMatchObject({
      state: "pending",
      delivery: "uncertain",
    });
});

it("does not report capture on interrupted writes or expired authority, and isolates inspection by account and operation", async () => {
  let allowed = true;
  const { platform, client, interrupt, send } = await commandStorage(
    () => allowed,
  );
  interrupt();
  await expect(
    client.queue(
      "capture",
      { text: "Interrupted" },
      { key: "interrupted-key" },
    ),
  ).rejects.toThrow("Interrupted commit");
  expect((await readModuleStorage(platform, scope)).journal).toHaveLength(0);
  allowed = false;
  await expect(client.queue("capture", { text: "Denied" })).rejects.toThrow(
    "Current access",
  );
  allowed = true;
  const saved = await client.queue(
    "capture",
    { text: "Scoped" },
    { key: "scoped-command" },
  );
  const foreign = createModuleClient(
    commandModule,
    send,
    createModuleQueue(
      platform,
      { ...scope, userId: "someone-else" },
      () => true,
    ),
  );
  expect(await foreign.queued("capture", saved.key)).toBeUndefined();
  allowed = false;
  await expect(client.queued("capture", saved.key)).rejects.toThrow(
    "Current access",
  );
  let checks = 0;
  const racing = createModuleClient(
    commandModule,
    send,
    createModuleQueue(platform, scope, () => ++checks === 1),
  );
  await expect(
    racing.queue(
      "capture",
      { text: "Expired during capture" },
      { key: "racing-authority" },
    ),
  ).rejects.toThrow("Current access changed");
  expect((await readModuleStorage(platform, scope)).journal).toHaveLength(1);
});

it("exposes the generated identity after an unconfirmed capture reply so retry cannot invent another command", async () => {
  const { platform, provider, send } = await commandStorage();
  const broken = createModuleClient(commandModule, send, {
    ...provider,
    capture: async (call, dependencies) => {
      await provider.capture(call, dependencies);
      throw Error("Host reply lost after durable commit");
    },
  });
  let key = "";
  try {
    await broken.queue("capture", { text: "Recover capture" });
    expect.unreachable("The host reply must fail");
  } catch (error) {
    expect(error).toBeInstanceOf(QueueCaptureError);
    key = (error as QueueCaptureError).identity.key;
  }
  const restored = createModuleClient(commandModule, send, provider);
  expect(await restored.queued("capture", key)).toMatchObject({
    state: "pending",
  });
  expect(
    await restored.queue("capture", { text: "Recover capture" }, { key }),
  ).toMatchObject({ key, state: "pending" });
  expect((await readModuleStorage(platform, scope)).journal).toHaveLength(1);
});

it("retains signed schemas for ordinary drafts even without a pending journal entry", async () => {
  const { platform, install } = storage();
  await install();
  await saveResourceDraft(platform, scope, "contacts", "notes", {
    data: { contactId: crypto.randomUUID(), text: "Only a draft" },
    target: null,
  });
  await install(upgraded);
  const state = await readModuleStorage(platform, scope);
  expect(state.journal).toHaveLength(0);
  expect(
    state.responseContracts?.[`contacts@${contacts.version}`]?.signed.digest,
  ).toBe(original.digest);
});

it("rejects altered host receipts and preserves caller input while capture is in flight", async () => {
  const { provider, send } = await commandStorage();
  for (const corrupt of [
    (receipt: Record<string, unknown>) => ({
      ...receipt,
      key: "different-key",
    }),
    (receipt: Record<string, unknown>) => ({
      ...receipt,
      value: { saved: true },
    }),
    (receipt: Record<string, unknown>) => ({
      ...receipt,
      input: { text: "Changed by host" },
    }),
    (receipt: Record<string, unknown>) => ({
      ...receipt,
      state: "accepted",
      value: { saved: "invalid" },
    }),
  ]) {
    const client = createModuleClient(commandModule, send, {
      ...provider,
      capture: async (call, dependencies) =>
        corrupt(
          (await provider.capture(call, dependencies)) as Record<
            string,
            unknown
          >,
        ),
    });
    await expect(
      client.queue("capture", { text: "Original" }),
    ).rejects.toBeInstanceOf(QueueCaptureError);
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = createModuleClient(commandModule, send, {
    ...provider,
    capture: async (call, dependencies) => {
      await gate;
      return provider.capture(call, dependencies);
    },
  });
  const input = { text: "Captured snapshot" };
  const pending = client.queue("capture", input);
  input.text = "Later edit";
  release();
  expect(await pending).toMatchObject({ input: { text: "Captured snapshot" } });
});

it("recognizes capture identities across independent SDK copies without relying on instanceof", () => {
  const identity = {
    moduleId: "contacts",
    moduleVersion: commandModule.version,
    operation: "capture",
    key: "saved-identity",
  };
  const copied: unknown = {
    code: "QUEUED_CAPTURE_UNCONFIRMED",
    identity,
    message: "Reply lost",
  };
  expect(copied).not.toBeInstanceOf(QueueCaptureError);
  expect(isQueueCaptureError(copied)).toBe(true);
  if (isQueueCaptureError(copied))
    expect(copied.identity.key).toBe(identity.key);
  for (const error of [
    null,
    {},
    { code: "QUEUED_CAPTURE_UNCONFIRMED", message: "Missing identity" },
    {
      code: "QUEUED_CAPTURE_UNCONFIRMED",
      identity: { ...identity, key: 12 },
      message: "Invalid identity",
    },
  ])
    expect(isQueueCaptureError(error)).toBe(false);
});

async function archiveFixture() {
  const f = storage();
  await f.install();
  const id = crypto.randomUUID();
  const originalCall: ModuleCall = {
    moduleId: "contacts",
    moduleVersion: contacts.version,
    resource: "contacts",
    action: "archive",
    key: "original-archive-key",
    input: { id, baseVersion: 1 },
  };
  await enqueue(f.platform, scope, originalCall);
  await changeModuleStorage(f.platform, scope, (s) => {
    s.journal[0].state = "conflict";
    s.journal[0].attempts = 1;
    delete s.journal[0].delivery;
  });
  return {
    ...f,
    id,
    originalCall,
    replacement: {
      ...originalCall,
      key: "reviewed-archive-key",
      input: { id, baseVersion: 2 },
    },
  };
}

it("fences a conflicting archive before queuing its current-version review and reconnecting an unsent dependent", async () => {
  const f = await archiveFixture();
  await enqueue(f.platform, scope, {
    ...f.originalCall,
    key: "dependent-archive-key",
  });
  const result = await replaceArchive(
    f.platform,
    scope,
    f.originalCall.key!,
    f.replacement,
    async (request) => {
      expect(request.body).toMatchObject({
        key: f.originalCall.key,
        call: { action: "archive", input: f.originalCall.input },
      });
      expect((await readModuleStorage(f.platform, scope)).journal).toHaveLength(
        2,
      );
      return { key: f.originalCall.key, outcome: "cancelled" };
    },
    () => true,
  );
  expect(result).toBe("replaced");
  const state = await readModuleStorage(f.platform, scope);
  expect(state.journal[0]).toMatchObject({
    call: f.originalCall,
    settlement: "cancelled",
    supersededBy: f.replacement.key,
  });
  expect(state.journal[1].dependencies).toEqual([f.replacement.key]);
  expect(state.journal[2]).toMatchObject({
    state: "pending",
    attempts: 0,
    delivery: "unsubmitted",
    call: f.replacement,
  });
});

it("recovers an accepted original archive without generating a second effect", async () => {
  const f = await archiveFixture();
  const accepted = { ...row, id: f.id, archived: true, version: 2 };
  await expect(
    replaceArchive(
      f.platform,
      scope,
      f.originalCall.key!,
      f.replacement,
      async () => ({
        key: f.originalCall.key,
        outcome: "accepted",
        result: accepted,
      }),
      () => true,
    ),
  ).resolves.toBe("accepted");
  const state = await readModuleStorage(f.platform, scope);
  expect(state.journal).toHaveLength(1);
  expect(state.journal[0]).toMatchObject({
    state: "accepted",
    call: f.originalCall,
    result: accepted,
  });
});

it("retains a cancelled archive through interrupted local replacement and safely resumes", async () => {
  const f = await archiveFixture();
  const settle = async () => ({
    key: f.originalCall.key,
    outcome: "cancelled",
  });
  f.interrupt(2);
  await expect(
    replaceArchive(
      f.platform,
      scope,
      f.originalCall.key!,
      f.replacement,
      settle,
      () => true,
    ),
  ).rejects.toThrow("Interrupted commit");
  expect((await readModuleStorage(f.platform, scope)).journal).toHaveLength(1);
  expect(
    (await readModuleStorage(f.platform, scope)).journal[0].settlement,
  ).toBe("cancelled");
  await expect(
    replaceArchive(
      f.platform,
      scope,
      f.originalCall.key!,
      f.replacement,
      settle,
      () => true,
    ),
  ).resolves.toBe("replaced");
});

it.each(["permission", "release"])(
  "does not replace an archive after %s changes during settlement",
  async (change) => {
    const f = await archiveFixture();
    let allowed = true;
    await expect(
      replaceArchive(
        f.platform,
        scope,
        f.originalCall.key!,
        f.replacement,
        async () => {
          if (change === "permission") allowed = false;
          else await f.install(upgraded);
          return { key: f.originalCall.key, outcome: "cancelled" };
        },
        () => allowed,
      ),
    ).rejects.toThrow(
      change === "permission" ? "Current access" : "installed release",
    );
    expect((await readModuleStorage(f.platform, scope)).journal).toHaveLength(
      1,
    );
    expect(
      (await readModuleStorage(f.platform, scope)).journal[0].call,
    ).toEqual(f.originalCall);
  },
);

it.each(["uncertain", "target", "child"])(
  "refuses archive replacement with unsafe %s state before settlement",
  async (reason) => {
    const f = await archiveFixture();
    if (reason === "target")
      f.replacement.input = { id: crypto.randomUUID(), baseVersion: 2 };
    else if (reason === "uncertain")
      await changeModuleStorage(f.platform, scope, (s) => {
        s.journal[0].state = "pending";
        s.journal[0].delivery = "uncertain";
      });
    else {
      await enqueue(f.platform, scope, {
        ...f.originalCall,
        key: "submitted-archive-child",
      });
      await changeModuleStorage(f.platform, scope, (s) => {
        s.journal[1].delivery = "uncertain";
        s.journal[1].attempts = 1;
      });
    }
    const settle = vi.fn();
    await expect(
      replaceArchive(
        f.platform,
        scope,
        f.originalCall.key!,
        f.replacement,
        settle,
        () => true,
      ),
    ).rejects.toThrow();
    expect(settle).not.toHaveBeenCalled();
  },
);

it.each(["separate", "existing"] as const)(
  "keeps a collision archive inert until explicit %s-target review and authoritative replacement",
  async (destination) => {
    const { platform } = await collisionStorage();
    const archive: ModuleCall = {
      ...call("collision-archive"),
      action: "archive",
      input: { id: collisionId, baseVersion: 7 },
    };
    await enqueue(platform, scope, archive);
    await replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => ({ key: "original-create", outcome: "cancelled" }),
      () => true,
      { "collision-archive": destination },
    );
    let state = await readModuleStorage(platform, scope);
    const retained = state.journal.find((e) => e.recordRecovery)!;
    const target = destination === "separate" ? separateId : collisionId;
    expect(retained.call.input).toEqual(archive.input);
    expect(retained).toMatchObject({
      state: "conflict",
      delivery: "unsubmitted",
      recordRecovery: { targetId: target, destination },
    });
    const reviewed = {
      ...archive,
      key: "reviewed-collision-archive",
      input: { id: target, baseVersion: 1 },
    };
    const settle = vi.fn(async () => ({
      key: retained.id,
      outcome: "cancelled",
    }));
    await expect(
      replaceArchive(
        platform,
        scope,
        retained.id,
        reviewed,
        settle,
        () => true,
      ),
    ).rejects.toThrow("prerequisite");
    expect(settle).not.toHaveBeenCalled();
    const send = vi.fn(async (request: ModuleCall) => ({
      ...row,
      id: (request.input as { id: string }).id,
      archived: request.action === "archive",
    }));
    await syncModuleStorage(platform, scope, send, () => true);
    expect(
      send.mock.calls.every(([request]) => request.action === "create"),
    ).toBe(true);
    await replaceArchive(
      platform,
      scope,
      retained.id,
      reviewed,
      settle,
      () => true,
    );
    await syncModuleStorage(platform, scope, send, () => true);
    expect(
      send.mock.calls.filter(([request]) => request.action === "archive"),
    ).toEqual([[reviewed]]);
    state = await readModuleStorage(platform, scope);
    expect(state.journal.find((e) => e.id === archive.key)?.call).toEqual(
      archive,
    );
    expect(state.journal.find((e) => e.id === reviewed.key)?.state).toBe(
      "accepted",
    );
  },
);

it("requires an explicit target for a same-record archive without rewriting original work", async () => {
  const { platform } = await collisionStorage();
  await enqueue(platform, scope, {
    ...call("collision-archive"),
    action: "archive",
    input: { id: collisionId, baseVersion: 1 },
  });
  const before = await readModuleStorage(platform, scope);
  await expect(
    replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => ({ key: "original-create", outcome: "cancelled" }),
      () => true,
    ),
  ).rejects.toThrow("Choose where");
  const after = await readModuleStorage(platform, scope);
  expect(after.journal.map((e) => e.call)).toEqual(
    before.journal.map((e) => e.call),
  );
  expect(after.journal.some((e) => e.supersededBy)).toBe(false);
});

it.each(["update", "archive"] as const)(
  "preserves an existing-target %s review across a repeated parent collision",
  async (action) => {
    const { platform } = await collisionStorage();
    const source: ModuleCall = {
      ...call("existing-target-change"),
      action,
      input: {
        id: collisionId,
        baseVersion: 7,
        ...(action === "update" ? { data, baseData: data } : {}),
      },
    };
    await enqueue(platform, scope, source);
    await replaceFailedCreate(
      platform,
      scope,
      "original-create",
      collisionReplacement(),
      async () => ({ key: "original-create", outcome: "cancelled" }),
      () => true,
      { [source.key!]: "existing" },
    );
    await changeModuleStorage(platform, scope, (s) => {
      const parent = s.journal.find((e) => e.id === "separate-create")!;
      parent.state = "conflict";
      parent.attempts = 1;
      delete parent.delivery;
    });
    await replaceFailedCreate(
      platform,
      scope,
      "separate-create",
      {
        ...collisionReplacement(),
        key: "second-separate-create",
        input: { id: crypto.randomUUID(), data },
      },
      async () => ({ key: "separate-create", outcome: "cancelled" }),
      () => true,
    );
    const latest = (await readModuleStorage(platform, scope)).journal.find(
      (e) => e.call.action === action && !e.supersededBy,
    )!;
    expect(latest).toMatchObject({
      state: "conflict",
      delivery: "unsubmitted",
      recordRecovery: { targetId: collisionId, destination: "existing" },
    });
    expect(latest.call.input).toEqual(source.input);
  },
);

it("continues an unsent archive of another record without remapping its target or body", async () => {
  const { platform } = await collisionStorage();
  const target = crypto.randomUUID();
  const archive: ModuleCall = {
    ...call("other-record-archive"),
    action: "archive",
    input: { id: target, baseVersion: 3 },
  };
  await enqueue(platform, scope, archive, ["original-create"]);
  await replaceFailedCreate(
    platform,
    scope,
    "original-create",
    collisionReplacement(),
    async () => ({ key: "original-create", outcome: "cancelled" }),
    () => true,
  );
  const send = vi.fn(async (request: ModuleCall) => ({
    ...row,
    id: (request.input as { id: string }).id,
    archived: request.action === "archive",
    version: request.action === "archive" ? 4 : 1,
  }));
  await syncModuleStorage(platform, scope, send, () => true);
  const archives = send.mock.calls.filter(
    ([request]) => request.action === "archive",
  );
  expect(archives).toHaveLength(1);
  expect(archives[0][0].input).toStrictEqual(archive.input);
  expect(archives[0][0].key).not.toBe(archive.key);
  const state = await readModuleStorage(platform, scope);
  expect(state.journal.find((e) => e.id === archives[0][0].key)?.state).toBe(
    "accepted",
  );
  expect(state.journal.find((e) => e.id === archive.key)?.call).toEqual(
    archive,
  );
});

it("continues two collision archive reviews in order without automatically executing either target", async () => {
  const { platform } = await collisionStorage();
  for (const key of ["first-collision-archive", "second-collision-archive"])
    await enqueue(platform, scope, {
      ...call(key),
      action: "archive",
      input: { id: collisionId, baseVersion: 7 },
    });
  await replaceFailedCreate(
    platform,
    scope,
    "original-create",
    collisionReplacement(),
    async () => ({ key: "original-create", outcome: "cancelled" }),
    () => true,
    {
      "first-collision-archive": "separate",
      "second-collision-archive": "existing",
    },
  );
  const reviews = (await readModuleStorage(platform, scope)).journal.filter(
    (e) => e.recordRecovery && !e.supersededBy,
  );
  expect(reviews).toHaveLength(2);
  const send = vi.fn(async (request: ModuleCall) => ({
    ...row,
    id: (request.input as { id: string }).id,
    archived: request.action === "archive",
  }));
  await syncModuleStorage(platform, scope, send, () => true);
  expect(
    send.mock.calls.some(([request]) => request.action === "archive"),
  ).toBe(false);
  for (const [index, entry] of reviews.entries()) {
    const reviewed: ModuleCall = {
      ...entry.call,
      key: `reviewed-collision-archive-${index}`,
      input: { id: entry.recordRecovery!.targetId, baseVersion: 1 },
    };
    await replaceArchive(
      platform,
      scope,
      entry.id,
      reviewed,
      async () => ({ key: entry.id, outcome: "cancelled" }),
      () => true,
    );
    await syncModuleStorage(platform, scope, send, () => true);
    expect(
      send.mock.calls.filter(([request]) => request.action === "archive"),
    ).toHaveLength(index + 1);
    if (index === 0)
      expect(
        (await readModuleStorage(platform, scope)).journal.find(
          (e) => e.id === reviews[1].id,
        ),
      ).toMatchObject({
        state: "conflict",
        delivery: "unsubmitted",
        call: reviews[1].call,
        dependencies: [reviewed.key],
      });
  }
  expect(
    send.mock.calls
      .filter(([request]) => request.action === "archive")
      .map(([request]) => request.input),
  ).toEqual([
    { id: separateId, baseVersion: 1 },
    { id: collisionId, baseVersion: 1 },
  ]);
});

async function collisionCommandStorage() {
  const fixture = storage();
  const definition = {
    ...contacts,
    operations: {
      ...contacts.operations,
      link: operation({
        title: "Link contact",
        policy: "queued",
        permission: "contacts.contacts.write",
        input: Type.Object({
          contactId: field.reference("contacts", "contacts"),
        }),
        output: Type.Object({ linked: Type.Boolean() }),
      }),
    },
  };
  await fixture.install(signPackage(definition, privateKey));
  await enqueue(fixture.platform, scope, {
    ...call("original-create"),
    input: { id: collisionId, data },
  });
  const command: ModuleCall = {
    moduleId: "contacts",
    moduleVersion: contacts.version,
    action: "operation",
    operation: "link",
    key: "dependent-command",
    input: { contactId: collisionId },
  };
  await enqueue(fixture.platform, scope, command, ["original-create"]);
  await changeModuleStorage(fixture.platform, scope, (state) => {
    state.journal[0].state = "conflict";
  });
  return { ...fixture, command };
}
const cancelCollision = async (
  platform: Platform,
  originalId = "original-create",
  replacement = collisionReplacement(),
) =>
  replaceFailedCreate(
    platform,
    scope,
    originalId,
    replacement,
    async () => ({ key: originalId, outcome: "cancelled" }),
    () => true,
  );

it("preserves custom collision capture identity and requires accepted prerequisites and an explicit corrected command", async () => {
  const { platform, command } = await collisionCommandStorage();
  await cancelCollision(platform);
  const state = await readModuleStorage(platform, scope);
  const child = state.journal.find((e) => e.id === command.key)!;
  expect(child.call).toEqual(command);
  expect(child.supersededBy).toBeUndefined();
  expect(child.state).toBe("conflict");
  expect(child.captureDependencies).toEqual(["original-create"]);
  expect(child.requestedDependencies).toEqual(["separate-create"]);
  expect(child.dependencies).toEqual(["separate-create"]);
  expect(child.createRecovery).toEqual([
    {
      moduleId: "contacts",
      resource: "contacts",
      originalId: collisionId,
      replacementId: separateId,
    },
  ]);
  const retry = await createModuleQueue(platform, scope, () => true).capture(
    command,
    ["original-create"],
  );
  expect(retry).toMatchObject({ state: "conflict" });
  const review = await saveCollisionCommandReview(
    platform,
    scope,
    child.id,
    contacts.version,
    { contactId: separateId },
    0,
    () => true,
  );
  const settle = vi.fn(async () => ({ key: child.id, outcome: "cancelled" }));
  await expect(
    replaceCommand(
      platform,
      scope,
      child.id,
      review.revision,
      "corrected-command",
      [],
      settle,
      () => true,
    ),
  ).rejects.toThrow("Wait for prerequisite");
  expect(settle).not.toHaveBeenCalled();
  const send = vi.fn(async (call: ModuleCall) => ({
    ...row,
    id: separateId,
    data: (call.input as { data: unknown }).data,
  }));
  await syncModuleStorage(platform, scope, send, () => true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    (await readModuleStorage(platform, scope)).journal.find(
      (e) => e.id === child.id,
    )?.state,
  ).toBe("conflict");
  await replaceCommand(
    platform,
    scope,
    child.id,
    review.revision,
    "corrected-command",
    [],
    settle,
    () => true,
  );
  const perform = vi.fn(async (_call: ModuleCall) => ({ linked: true }));
  await syncModuleStorage(platform, scope, perform, () => true);
  await syncModuleStorage(platform, scope, perform, () => true);
  expect(perform).toHaveBeenCalledTimes(1);
  expect(perform.mock.calls[0]?.[0]).toMatchObject({
    input: { contactId: separateId },
    key: "corrected-command",
  });
  const final = await readModuleStorage(platform, scope);
  expect(final.journal.find((e) => e.id === child.id)?.call).toEqual(command);
  expect(final.journal.find((e) => e.id === "corrected-command")?.state).toBe(
    "accepted",
  );
});

it("retains command reviews across repeated create collisions and rejects stale recovery context before settlement", async () => {
  const { platform, command } = await collisionCommandStorage();
  await cancelCollision(platform);
  const review = await saveCollisionCommandReview(
    platform,
    scope,
    command.key!,
    contacts.version,
    { contactId: separateId },
    0,
    () => true,
  );
  await changeModuleStorage(platform, scope, (state) => {
    state.journal.find((e) => e.id === "separate-create")!.state = "conflict";
  });
  const nextId = crypto.randomUUID();
  await cancelCollision(platform, "separate-create", {
    ...collisionReplacement(),
    key: "third-create",
    input: { id: nextId, data },
  });
  const state = await readModuleStorage(platform, scope);
  const child = state.journal.find((e) => e.id === command.key)!;
  expect(child.call).toEqual(command);
  expect(child.createRecovery).toEqual([
    {
      moduleId: "contacts",
      resource: "contacts",
      originalId: collisionId,
      replacementId: nextId,
    },
  ]);
  expect(state.commandReviews?.[child.id]).toEqual(review);
  const settle = vi.fn();
  await expect(
    replaceCommand(
      platform,
      scope,
      child.id,
      review.revision,
      "corrected-command",
      [],
      settle,
      () => true,
    ),
  ).rejects.toThrow("changed after this review");
  expect(settle).not.toHaveBeenCalled();
  await expect(
    createModuleQueue(platform, scope, () => true).capture(command, [
      "original-create",
    ]),
  ).resolves.toMatchObject({ state: "conflict" });
});

it.each(["permission", "uncertain", "attempted", "legacy"])(
  "keeps a custom collision graph intact when %s prevents recovery",
  async (reason) => {
    const { platform } = await collisionCommandStorage();
    await changeModuleStorage(platform, scope, (state) => {
      const child = state.journal[1];
      if (reason === "uncertain") child.delivery = "uncertain";
      if (reason === "attempted") child.attempts = 1;
      if (reason === "legacy") delete child.delivery;
    });
    const before = await readModuleStorage(platform, scope);
    await expect(
      replaceFailedCreate(
        platform,
        scope,
        "original-create",
        collisionReplacement(),
        async () => ({ key: "original-create", outcome: "cancelled" }),
        (call) => reason !== "permission" || call.action !== "operation",
      ),
    ).rejects.toThrow();
    const after = await readModuleStorage(platform, scope);
    expect(after.journal[1]).toEqual(before.journal[1]);
    expect(after.journal).toHaveLength(2);
    expect(after.journal[0].supersededBy).toBeUndefined();
  },
);

it("continues a reviewed command chain after collision without automatically submitting later reviews", async () => {
  const { platform, command } = await collisionCommandStorage();
  await enqueue(platform, scope, { ...command, key: "second-command" }, [
    command.key!,
  ]);
  await cancelCollision(platform);
  await syncModuleStorage(
    platform,
    scope,
    async (call) => ({
      ...row,
      id: separateId,
      data: (call.input as { data: unknown }).data,
    }),
    () => true,
  );
  let state = await readModuleStorage(platform, scope);
  const later = state.journal.find((e) => e.id === "second-command")!;
  const review = await saveCollisionCommandReview(
    platform,
    scope,
    command.key!,
    contacts.version,
    { contactId: separateId },
    0,
    () => true,
    [commandContinuation(later)],
  );
  await replaceCommand(
    platform,
    scope,
    command.key!,
    review.revision,
    "corrected-first",
    [commandContinuation(later)],
    async () => ({ key: command.key!, outcome: "cancelled" }),
    () => true,
  );
  const send = vi.fn(async (_call: ModuleCall) => ({ linked: true }));
  await syncModuleStorage(platform, scope, send, () => true);
  expect(send).toHaveBeenCalledTimes(1);
  state = await readModuleStorage(platform, scope);
  const held = state.journal.find((e) => e.id === later.id)!;
  expect(held.state).toBe("conflict");
  expect(held.call).toEqual(later.call);
  expect(held.dependencies).toContain("corrected-first");
  const next = await saveCollisionCommandReview(
    platform,
    scope,
    later.id,
    contacts.version,
    { contactId: collisionId },
    0,
    () => true,
  );
  await replaceCommand(
    platform,
    scope,
    later.id,
    next.revision,
    "corrected-second",
    [],
    async () => ({ key: later.id, outcome: "cancelled" }),
    () => true,
  );
  await syncModuleStorage(platform, scope, send, () => true);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].input).toEqual({ contactId: collisionId });
});

async function saveCollisionCommandReview(
  ...args: Parameters<typeof saveCommandReview>
) {
  const state = await readModuleStorage(args[0], args[1]);
  args[8] = state.journal.find((entry) => entry.id === args[2])?.createRecovery;
  return saveCommandReview(...args);
}

it("rejects a stale command recovery context when saving a review without losing input", async () => {
  const { platform, command } = await collisionCommandStorage();
  await cancelCollision(platform);
  const before = await readModuleStorage(platform, scope);
  await expect(
    saveCommandReview(
      platform,
      scope,
      command.key!,
      contacts.version,
      { contactId: separateId },
      0,
      () => true,
    ),
  ).rejects.toThrow("Reopen its current recovery details");
  expect(await readModuleStorage(platform, scope)).toEqual(before);
});

it("keeps command capture prerequisites immutable when an archive review rewires execution order", async () => {
  const { platform, command } = await collisionCommandStorage();
  await enqueue(
    platform,
    scope,
    {
      ...call("original-archive"),
      action: "archive",
      input: { id: collisionId, baseVersion: 1 },
    },
    ["original-create"],
  );
  await enqueue(platform, scope, { ...command, key: "archive-child-command" }, [
    "original-archive",
  ]);
  await replaceFailedCreate(
    platform,
    scope,
    "original-create",
    collisionReplacement(),
    async () => ({ key: "original-create", outcome: "cancelled" }),
    () => true,
    { "original-archive": "existing" },
  );
  await syncModuleStorage(
    platform,
    scope,
    async (call) => ({
      ...row,
      id: separateId,
      data: (call.input as { data: unknown }).data,
    }),
    () => true,
  );
  let state = await readModuleStorage(platform, scope);
  const archive = state.journal.find(
    (e) => e.call.action === "archive" && !e.supersededBy,
  )!;
  const archiveCall = { ...archive.call, key: "reviewed-archive" };
  await replaceArchive(
    platform,
    scope,
    archive.id,
    archiveCall,
    async () => ({ key: archive.id, outcome: "cancelled" }),
    () => true,
  );
  await syncModuleStorage(
    platform,
    scope,
    async () => ({ ...row, id: collisionId, archived: true, version: 2 }),
    () => true,
  );
  state = await readModuleStorage(platform, scope);
  const child = state.journal.find((e) => e.id === "archive-child-command")!;
  expect(child.state).toBe("conflict");
  expect(child.requestedDependencies).toEqual(["reviewed-archive"]);
  expect(child.captureDependencies).toEqual(["original-archive"]);
  const review = await saveCollisionCommandReview(
    platform,
    scope,
    child.id,
    contacts.version,
    { contactId: separateId },
    0,
    () => true,
  );
  await replaceCommand(
    platform,
    scope,
    child.id,
    review.revision,
    "reviewed-archive-child",
    [],
    async () => ({ key: child.id, outcome: "cancelled" }),
    () => true,
  );
  const send = vi.fn(async (_call: ModuleCall) => ({ linked: true }));
  await syncModuleStorage(platform, scope, send, () => true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0].key).toBe("reviewed-archive-child");
});

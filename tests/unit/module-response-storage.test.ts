import { prepareCreateReplacement } from "../../packages/client/src/modules/collisions";
import {
  replaceFailedCreate,
  settleJournalEntry,
} from "../../packages/client/src/modules/settlement";
import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { Type, type ModuleCall } from "@suite/module-sdk";
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

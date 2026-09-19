import { afterEach, expect, it, vi } from "vitest";
import { Type, field, createModuleClient } from "@suite/module-sdk";
import { referenceTargetKey } from "@suite/module-sdk/references";
import type { Platform } from "../../packages/client/src";
import {
  readModuleStorage,
  changeModuleStorage,
  type ModuleStorage,
} from "../../packages/client/src/modules/storage";
import { readModuleReferences } from "../../packages/client/src/modules/reference-reads";
import {
  cacheReferenceOptions,
  pruneReferenceCache,
  referenceDownloadedAt,
  clearReferenceCache,
  referenceCacheLimits,
  type ReferenceCacheState,
} from "../../packages/client/src/modules/reference-cache";
import module from "../fixtures/reference-client/module";
const scope = { userId: "owner", workspaceId: "company" };
function harness() {
  const values = new Map<string, unknown>();
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (name: string, fn: () => Promise<unknown>) => {
        const result = (locks.get(name) ?? Promise.resolve())
          .catch(() => {})
          .then(fn);
        locks.set(name, result);
        return result;
      },
    },
  });
  const platform: Platform = {
    accountRevision: async () => "initial",
    kind: "web",
    load: async <T>(s: typeof scope, key: string) =>
      structuredClone(values.get(`${s.userId}/${s.workspaceId}/${key}`)) as T,
    save: async (s, key, value) => {
      values.set(`${s.userId}/${s.workspaceId}/${key}`, structuredClone(value));
    },
    pruneModuleArtifacts: async () => {},
    purgeWorkspace: async () => {},
    purgeUser: async () => {},
    identity: async () => undefined,
    rememberIdentity: async () => {},
    saveFile: async () => {},
    notify: async () => {},
  };
  return { platform, read: () => readModuleStorage(platform, scope) };
}
afterEach(() => vi.unstubAllGlobals());

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const option = (n: number, label = `Target ${n}`) => ({ value: id(n), label });
const key = `${module.id}@${module.version}/notes/references-v1`;
const target = referenceTargetKey({
  kind: "resource",
  moduleId: module.id,
  resource: "targets",
});
const query = { field: "/properties/link", limit: 25 };
function fixture() {
  const h = harness();
  let allowed = true,
    cache = true,
    revision = "1";
  const context = {
    ...h,
    scope,
    module,
    resource: "notes",
    online: true,
    authorization: () => revision,
    check: () => {
      if (!allowed) throw Error("Access changed");
    },
    canCache: () => cache,
    send: vi.fn(async () => ({
      items: [option(1)],
      nextCursor: null as string | null,
    })),
  };
  return {
    ...h,
    context,
    deny: () => {
      allowed = false;
    },
    expire: () => {
      cache = false;
    },
    revise: () => {
      revision = "2";
    },
  };
}
it("bounds all legacy targets and labels, cleans metadata, and migrates durably without changing pending input", async () => {
  const { platform, read } = harness();
  const initial: ModuleStorage = {
    journal: [],
    pages: {},
    installed: {},
    drafts: { retained: { title: "Pending work" } },
    referenceOptions: {},
  };
  for (let n = 0; n < 60; n++)
    initial.referenceOptions![`old-${n}`] = {
      target: Array.from({ length: 250 }, (_, i) => option(n * 250 + i + 1)),
    };
  await platform.save(scope, "module-state", initial);
  const saved = vi.spyOn(platform, "save");
  const migrated = await read();
  expect(
    Object.values(migrated.referenceOptions!).flatMap(Object.values),
  ).toHaveLength(50);
  expect(
    Object.values(migrated.referenceOptions!).flatMap(Object.values).flat(),
  ).toHaveLength(referenceCacheLimits.options);
  expect(migrated.drafts).toEqual(initial.drafts);
  expect(migrated.journal).toEqual(initial.journal);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(await read()).toEqual(migrated);
  expect(saved).toHaveBeenCalledTimes(1);
});
it("bounds UTF-8 bytes and preserves timestamps for old labels across later downloads", () => {
  const state: ReferenceCacheState = {};
  cacheReferenceOptions(state, key, target, [option(1)], undefined, 100);
  cacheReferenceOptions(state, key, target, [option(2)], undefined, 200);
  expect(referenceDownloadedAt(state, key, target, [id(1), id(2)], 300)).toBe(
    100,
  );
  cacheReferenceOptions(
    state,
    key,
    target,
    [option(3, "😀".repeat(400000))],
    undefined,
    300,
  );
  expect(state.referenceOptions![key][target].map((x) => x.value)).toEqual([
    id(1),
    id(2),
  ]);
  expect(referenceDownloadedAt(state, key, target, [id(1)], 300)).toBe(100);
  expect(pruneReferenceCache(state, 300)).toBe(false);
});
it("keeps the latest labels at the per-target limit and removes explicit missing selections", () => {
  const state: ReferenceCacheState = {};
  cacheReferenceOptions(
    state,
    key,
    target,
    Array.from({ length: 200 }, (_, i) => option(i + 1)),
    undefined,
    100,
  );
  cacheReferenceOptions(state, key, target, [option(201)], id(150), 200);
  const values = state.referenceOptions![key][target].map((item) => item.value);
  expect(values).toHaveLength(200);
  expect(values).toContain(id(1));
  expect(values).toContain(id(201));
  expect(values).not.toContain(id(150));
  cacheReferenceOptions(state, key, target, [option(202)], undefined, 300);
  expect(state.referenceOptions![key][target].map((x) => x.value)).toContain(
    id(202),
  );
  expect(state.referenceMetadata![key][target].labels[id(150)]).toBeUndefined();
});
it("shares offline paging/search and selected labels with typed public clients", async () => {
  const { context, read } = fixture();
  context.send.mockResolvedValue({
    items: [option(1), option(2)],
    nextCursor: null,
  });
  const online = await readModuleReferences(context, query);
  expect(online.read).toEqual({ source: "server" });
  context.online = false;
  const offline = await readModuleReferences(context, {
    ...query,
    search: "Target 2",
    selected: id(1),
  });
  expect(offline).toMatchObject({
    items: [option(2)],
    selected: option(1),
    offline: true,
    read: { source: "cache", downloadedAt: expect.any(Number) },
  });
  expect(context.send).toHaveBeenCalledTimes(1);
  const client = createModuleClient(module, (call) =>
    readModuleReferences(context, call.input as typeof query),
  );
  expect((await client.resource("notes").references(query)).read?.source).toBe(
    "cache",
  );
  await expect(
    client.resource("notes").references(query, { source: "server" }),
  ).rejects.toThrow("server response is required");
  const snapshot = await read();
  clearReferenceCache(snapshot);
  expect(snapshot.referenceOptions).toEqual({});
  expect(snapshot.referenceMetadata).toEqual({});
});
it("rechecks permission and consent after I/O, rejects malformed replies and never caches lost authority", async () => {
  const first = fixture();
  first.context.send.mockImplementation(async () => {
    first.deny();
    return { items: [option(1)], nextCursor: null };
  });
  await expect(readModuleReferences(first.context, query)).rejects.toThrow(
    "Access changed",
  );
  expect((await first.read()).referenceOptions).toBeUndefined();
  const second = fixture();
  await readModuleReferences(second.context, query);
  second.context.online = false;
  const load = second.context.platform.load;
  second.context.platform.load = async (...args) => {
    const state = await load(...args);
    second.expire();
    return state as never;
  };
  await expect(readModuleReferences(second.context, query)).rejects.toThrow(
    "renew access",
  );
  const third = fixture();
  await expect(
    readModuleReferences(
      {
        ...third.context,
        send: async () => ({
          items: [{ value: "bad", label: "Bad" }],
          nextCursor: null,
        }),
      },
      query,
    ),
  ).rejects.toThrow();
  expect((await third.read()).referenceOptions).toBeUndefined();
});
it("invalidates source-scoped cross-module grant evidence after received policy changes", async () => {
  const h = fixture();
  const foreign = {
    ...module,
    dependencies: { provider: "^1" },
    resources: {
      ...module.resources,
      notes: {
        ...module.resources.notes,
        schema: Type.Object({ link: field.reference("provider", "targets") }),
      },
    },
  };
  const context = { ...h.context, module: foreign };
  await readModuleReferences(context, query);
  context.online = false;
  expect((await readModuleReferences(context, query)).items).toEqual([
    option(1),
  ]);
  h.revise();
  await expect(readModuleReferences(context, query)).rejects.toThrow(
    "verify this module",
  );
  context.online = true;
  await readModuleReferences(context, query);
  context.online = false;
  expect((await readModuleReferences(context, query)).items).toEqual([
    option(1),
  ]);
  expect((await h.read()).drafts).toEqual({});
});
it("removes previously downloaded labels on server denial and retains selected identifiers", async () => {
  const { context, read } = fixture();
  await readModuleReferences(context, query);
  context.send.mockRejectedValue(
    Object.assign(Error("Grant revoked"), { status: 403 }),
  );
  await expect(readModuleReferences(context, query)).rejects.toThrow(
    "Grant revoked",
  );
  context.online = false;
  expect(
    await readModuleReferences(context, { ...query, selected: id(1) }),
  ).toMatchObject({
    items: [],
    selected: null,
    offline: true,
    read: { source: "cache", downloadedAt: null },
  });
  expect((await read()).referenceOptions).toEqual({});
});
it("never shares labels across account, workspace, source release or resource", async () => {
  const { context } = fixture();
  await readModuleReferences(context, query);
  context.online = false;
  for (const other of [
    { ...scope, userId: "other" },
    { ...scope, workspaceId: "other" },
  ])
    expect(
      (await readModuleReferences({ ...context, scope: other }, query)).items,
    ).toEqual([]);
  expect(
    (
      await readModuleReferences(
        { ...context, module: { ...module, version: "2.0.0" } },
        query,
      )
    ).items,
  ).toEqual([]);
  const other = {
    ...module,
    resources: { ...module.resources, other: module.resources.notes },
  };
  expect(
    (
      await readModuleReferences(
        { ...context, module: other, resource: "other" },
        query,
      )
    ).items,
  ).toEqual([]);
});

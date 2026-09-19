import { afterEach, expect, it, vi } from "vitest";
import {
  createModuleClient,
  type ModuleCall,
  type ResourceReadMetadata,
} from "@suite/module-sdk";
import type { Platform } from "../../packages/client/src";
import {
  changeModuleStorage,
  readModuleStorage,
  type ModuleStorage,
} from "../../packages/client/src/modules/storage";
import { readModuleResource } from "../../packages/client/src/modules/reads";
import module from "../fixtures/queued-resources/module";
const scope = { userId: "owner", workspaceId: "company" };
const page = (name = "One", nextCursor: string | null = null) => ({
  items: [
    {
      id: crypto.randomUUID(),
      data: { name },
      version: 1,
      archived: false,
      updatedAt: new Date().toISOString(),
    },
  ],
  nextCursor,
});
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

function fixture() {
  const { platform, read } = harness();
  let allowed = true,
    lease = true;
  const call: ModuleCall = {
    moduleId: module.id,
    moduleVersion: module.version,
    resource: "notes",
    action: "list",
    input: { search: "One", limit: 10 },
  };
  const send = vi.fn(async () => page());
  const context = {
    platform,
    scope,
    module,
    online: true,
    check: () => {
      if (!allowed) throw Error("Context changed");
    },
    canCache: () => lease,
    send,
  };
  return {
    call,
    context,
    read,
    deny: () => {
      allowed = false;
    },
    expire: () => {
      lease = false;
    },
  };
}
it("persists exact authorized list/get reads and replaces untrusted provenance", async () => {
  const { call, context, read } = fixture();
  const result = page();
  context.send.mockResolvedValue({
    ...result,
    read: { source: "cache", downloadedAt: 1 },
  } as typeof result);
  const online = (await readModuleResource(context, call)) as typeof result & {
    read: ResourceReadMetadata;
  };
  expect(online.read).toEqual({ source: "server" });
  context.online = false;
  const offline = (await readModuleResource(context, call)) as typeof online;
  expect(offline.items).toEqual(result.items);
  expect(offline.read).toMatchObject({
    source: "cache",
    downloadedAt: expect.any(Number),
  });
  expect(context.send).toHaveBeenCalledTimes(1);
  context.online = true;
  const record = result.items[0];
  const get: ModuleCall = { ...call, action: "get", input: { id: record.id } };
  const direct = { ...context, send: vi.fn(async () => record) };
  await readModuleResource(direct, get);
  direct.online = false;
  expect(await readModuleResource(direct, get)).toMatchObject({
    id: record.id,
    read: { source: "cache" },
  });
  expect(Object.keys((await read()).pages)).toHaveLength(2);
  await expect(
    readModuleResource(direct, { ...get, input: { id: crypto.randomUUID() } }),
  ).rejects.toThrow("not been downloaded");
});
it("does not substitute another scope, release, filter or page, and does not fall back on server failure", async () => {
  const { context, call } = fixture();
  await readModuleResource(context, call);
  context.online = false;
  for (const input of [
    { search: "Two", limit: 10 },
    { ...(call.input as object), limit: 20 },
    { ...(call.input as object), archived: true },
  ])
    await expect(
      readModuleResource(context, { ...call, input }),
    ).rejects.toThrow("not been downloaded");
  for (const other of [
    { userId: "other", workspaceId: scope.workspaceId },
    { ...scope, workspaceId: "other" },
  ])
    await expect(
      readModuleResource({ ...context, scope: other }, call),
    ).rejects.toThrow("not been downloaded");
  await expect(
    readModuleResource(
      { ...context, module: { ...module, version: "2.0.0" } },
      { ...call, moduleVersion: "2.0.0" },
    ),
  ).rejects.toThrow("not been downloaded");
  context.online = true;
  context.send.mockRejectedValue(Error("Server denied"));
  await expect(readModuleResource(context, call)).rejects.toThrow(
    "Server denied",
  );
});
it("checks authority after delayed network and cache reads and never persists a revoked response", async () => {
  const first = fixture();
  first.context.send.mockImplementation(async () => {
    first.deny();
    return page();
  });
  await expect(readModuleResource(first.context, first.call)).rejects.toThrow(
    "Context changed",
  );
  expect((await first.read()).pages).toEqual({});
  const second = fixture();
  await readModuleResource(second.context, second.call);
  second.context.online = false;
  const load = second.context.platform.load;
  second.context.platform.load = async (...args) => {
    const value = await load(...args);
    second.expire();
    return value as never;
  };
  await expect(readModuleResource(second.context, second.call)).rejects.toThrow(
    "expired or changed",
  );
});
it("does not cache without consent/lease and requires a server for explicit reads", async () => {
  const { call, context, read, expire } = fixture();
  expire();
  expect(await readModuleResource(context, call)).toMatchObject({
    read: { source: "server" },
  });
  expect((await read()).pages).toEqual({});
  context.online = false;
  await expect(readModuleResource(context, call)).rejects.toThrow(
    "offline access policy",
  );
  await expect(
    readModuleResource(context, call, { source: "server" }),
  ).rejects.toThrow("server response is required");
});
it("revalidates downloaded schemas and reports unknown historical download times", async () => {
  const { context, call } = fixture();
  await readModuleResource(context, call);
  await changeModuleStorage(context.platform, scope, (state) => {
    state.pageMetadata = {};
  });
  context.online = false;
  expect(await readModuleResource(context, call)).toMatchObject({
    read: { source: "cache", downloadedAt: null },
  });
  await changeModuleStorage(context.platform, scope, (state) => {
    Object.values(state.pages)[0].items[0].data = { name: 42 };
  });
  await expect(readModuleResource(context, call)).rejects.toThrow(
    "could not be verified",
  );
});
it("rejects wrong record identities, malformed requests and operations before using a cache", async () => {
  const { context, call } = fixture();
  await expect(
    readModuleResource(context, {
      ...call,
      action: "operation",
      operation: "capture",
    }),
  ).rejects.toThrow("ordinary resource read");
  await expect(
    readModuleResource(context, { ...call, input: { unknown: true } }),
  ).rejects.toThrow();
  const record = page().items[0];
  await expect(
    readModuleResource(
      { ...context, send: async () => record },
      { ...call, action: "get", input: { id: crypto.randomUUID() } },
    ),
  ).rejects.toThrow("does not match");
  expect(context.send).not.toHaveBeenCalled();
});
it("honors aborts after responses without storing data", async () => {
  const { context, call, read } = fixture();
  const abort = new AbortController();
  context.send.mockImplementation(async () => {
    abort.abort();
    return page();
  });
  await expect(
    readModuleResource(context, call, { signal: abort.signal }),
  ).rejects.toThrow();
  expect((await read()).pages).toEqual({});
});
it("the public SDK rejects unverified server-only responses even on transports without cache support", async () => {
  const row = page();
  let metadata: unknown = undefined;
  const client = createModuleClient(module, async () => ({
    ...row,
    ...(metadata === undefined ? {} : { read: metadata }),
  }));
  expect((await client.resource("notes").list()).read).toBeUndefined();
  await expect(
    client.resource("notes").list({}, { source: "server" }),
  ).rejects.toThrow("server response is required");
  metadata = { source: "cache", downloadedAt: null };
  await expect(
    client.resource("notes").list({}, { source: "server" }),
  ).rejects.toThrow("server response is required");
  metadata = { source: "server" };
  expect(
    (await client.resource("notes").list({}, { source: "server" })).read,
  ).toEqual(metadata);
  metadata = { source: "cache", downloadedAt: "today" };
  await expect(client.resource("notes").list()).rejects.toThrow();
  if (false) {
    // @ts-expect-error Read policy identifiers are closed and inferred.
    void client.resource("notes").list({}, { source: "optimistic" });
    // @ts-expect-error Resource data retains its declared field types.
    const invalid: number = (await client.resource("notes").get("one")).data
      .name;
    void invalid;
  }
});

it("captures query identity before a caller changes its input during transport", async () => {
  const { context, call } = fixture();
  const original = structuredClone(call);
  const input = call.input as { search: string };
  const request = {
    ...context,
    send: async (sent: ModuleCall) => {
      input.search = "Changed after request";
      expect(sent.input).toEqual(original.input);
      return page();
    },
  };
  await readModuleResource(request, call);
  expect(
    await readModuleResource({ ...context, online: false }, original),
  ).toMatchObject({ read: { source: "cache" } });
});

it("reads complete list records offline and chooses the highest downloaded version within the exact release", async () => {
  const { context, call } = fixture();
  const row = page().items[0];
  const get: ModuleCall = { ...call, action: "get", input: { id: row.id } };
  const send = async () => ({ items: [row], nextCursor: null });
  await readModuleResource({ ...context, send }, call);
  expect(
    await readModuleResource({ ...context, online: false }, get),
  ).toMatchObject({ id: row.id, version: 1, read: { source: "cache" } });
  const newer = { ...row, version: 2, data: { name: "Newer downloaded edit" } };
  await readModuleResource(
    { ...context, send: async () => ({ items: [newer], nextCursor: null }) },
    { ...call, input: { search: "Newer", limit: 10 } },
  );
  // A later retry of an older GET must not replace known newer information.
  await readModuleResource({ ...context, send: async () => row }, get);
  const other = {
    ...context,
    module: { ...module, version: "2.0.0" },
    send: async () => ({
      items: [{ ...newer, version: 99 }],
      nextCursor: null,
    }),
  };
  await readModuleResource(other, { ...call, moduleVersion: "2.0.0" });
  expect(
    await readModuleResource({ ...context, online: false }, get),
  ).toMatchObject({
    id: row.id,
    version: 2,
    data: newer.data,
    read: { source: "cache" },
  });
});

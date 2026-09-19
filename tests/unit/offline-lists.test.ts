import { afterEach, expect, it, vi } from "vitest";
import type { Platform } from "../../packages/client/src";
import {
  changeModuleStorage,
  readModuleStorage,
  type ModuleStorage,
} from "../../packages/client/src/modules/storage";
import { downloadOfflineList } from "../../packages/client/src/modules/offline-lists";
import {
  cacheResourcePage,
  commitOfflineList,
  clearRecentResourcePages,
  removeOfflineList,
  resourceCacheLimits,
  type OfflineList,
} from "../../packages/client/src/modules/cache";
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
const empty = (): ModuleStorage => ({
  pages: {},
  drafts: { retained: { name: "Pending draft" } },
  installed: {},
  journal: [],
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
  const base = {
    platform,
    scope,
    module,
    resource: "notes",
    title: "Office route",
    query: { search: "Office", limit: 10 },
    maxPages: 5,
    check: () => {},
  };
  return { platform, base, read: () => readModuleStorage(platform, scope) };
}
afterEach(() => vi.unstubAllGlobals());

it("downloads selected pages and commits their query, counts and truncation together", async () => {
  const { base, read } = harness();
  const cursor = crypto.randomUUID();
  const send = vi
    .fn()
    .mockResolvedValueOnce(page("First", cursor))
    .mockResolvedValueOnce(page("Second"));
  const list = await downloadOfflineList({ ...base, send });
  expect(send.mock.calls[0][0].input).toEqual({ search: "Office", limit: 10 });
  expect(send.mock.calls[1][0].input.cursor).toBe(cursor);
  expect(list).toMatchObject({
    records: 2,
    truncated: false,
    query: base.query,
  });
  expect(Object.keys((await read()).pages)).toHaveLength(2);
  expect((await read()).offlineLists?.[list.id]).toEqual(list);
  const capped = await downloadOfflineList({
    ...base,
    maxPages: 1,
    send: async () => page("Capped", cursor),
  });
  expect(capped.truncated).toBe(true);
});

it("preserves a prior list when permission changes after a response or a later page fails", async () => {
  const { base, read } = harness();
  const list = await downloadOfflineList({ ...base, send: async () => page() });
  const before = await read();
  let allowed = true;
  await expect(
    downloadOfflineList({
      ...base,
      existing: list,
      check: () => {
        if (!allowed) throw Error("Revoked");
      },
      send: async () => {
        allowed = false;
        return page("Unauthorized");
      },
    }),
  ).rejects.toThrow("Revoked");
  expect(await read()).toEqual(before);
  const send = vi
    .fn()
    .mockResolvedValueOnce(page("Partial", crypto.randomUUID()))
    .mockRejectedValueOnce(Error("Disconnected"));
  await expect(
    downloadOfflineList({ ...base, existing: list, send }),
  ).rejects.toThrow("Disconnected");
  expect(await read()).toEqual(before);
});

it("does not resurrect a list removed by another window during refresh", async () => {
  const { base, platform, read } = harness();
  const list = await downloadOfflineList({ ...base, send: async () => page() });
  await expect(
    downloadOfflineList({
      ...base,
      existing: list,
      send: async () => {
        await changeModuleStorage(platform, scope, (state) =>
          removeOfflineList(state, list.id),
        );
        return page("Late result");
      },
    }),
  ).rejects.toThrow("changed or was removed");
  expect((await read()).offlineLists?.[list.id]).toBeUndefined();
});

it("retains selected pages through recent-cache eviction and clears only unselected pages", () => {
  const state = empty();
  const list: OfflineList = {
    id: "list",
    moduleId: module.id,
    moduleVersion: module.version,
    resource: "notes",
    title: "Chosen",
    query: {},
    maxPages: 1,
    pages: ["chosen"],
    records: 1,
    downloadedAt: 1,
    truncated: false,
    revision: "one",
  };
  commitOfflineList(state, list, [
    { key: "chosen", page: page(), downloadedAt: 1 },
  ]);
  for (let i = 0; i < 60; i++)
    cacheResourcePage(state, `recent-${i}`, page(), 100 + i);
  expect(state.pages.chosen).toBeDefined();
  expect(Object.keys(state.pages)).toHaveLength(50);
  clearRecentResourcePages(state);
  expect(Object.keys(state.pages)).toEqual(["chosen"]);
  expect(state.drafts).toEqual({ retained: { name: "Pending draft" } });
  const second = { ...list, id: "second" };
  commitOfflineList(state, second, []);
  removeOfflineList(state, list.id);
  expect(state.pages.chosen).toBeDefined();
  removeOfflineList(state, second.id);
  expect(state.pages).toEqual({});
});

it("rejects an oversized selected refresh atomically and preserves its prior download", async () => {
  const { base, read } = harness();
  const list = await downloadOfflineList({ ...base, send: async () => page() });
  const state = await read();
  const original = structuredClone(state);
  const oversized = page("x".repeat(resourceCacheLimits.bytes));
  expect(() =>
    commitOfflineList(state, list, [
      { key: list.pages[0], page: oversized, downloadedAt: Date.now() },
    ]),
  ).toThrow("page budget");
  expect(state).toEqual(original);
  cacheResourcePage(state, list.pages[0], oversized);
  expect(state).toEqual(original);
});

it("rejects invalid server pages and repeated cursors before publishing an offline list", async () => {
  const { base, read } = harness();
  await expect(
    downloadOfflineList({
      ...base,
      send: async () => ({ items: [{ broken: true }], nextCursor: null }),
    }),
  ).rejects.toThrow();
  const cursor = crypto.randomUUID();
  await expect(
    downloadOfflineList({
      ...base,
      send: async () => page("Repeated", cursor),
    }),
  ).rejects.toThrow("repeated page");
  expect((await read()).offlineLists).toBeUndefined();
});

import { expect, it } from "vitest";
import {
  cacheResourcePage,
  pruneResourcePages,
  resourceCacheLimits,
  resourcePageDownloadedAt,
} from "../../packages/client/src/modules/cache";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";

const page = (text: string) => ({
  items: [
    {
      id: "record",
      data: { text },
      version: 1,
      archived: false,
      updatedAt: "2026-09-19T00:00:00Z",
    },
  ],
  nextCursor: null,
});
const state = (): ModuleStorage => ({
  pages: {},
  installed: {},
  drafts: {},
  journal: [],
});

it("bounds cached queries by count and retains the most recent downloads", () => {
  const s = state();
  for (let i = 0; i < resourceCacheLimits.pages + 10; i++)
    cacheResourcePage(s, `query-${i}`, page(String(i)), 100 + i);
  expect(Object.keys(s.pages)).toHaveLength(resourceCacheLimits.pages);
  expect(Object.keys(s.pageMetadata!)).toHaveLength(resourceCacheLimits.pages);
  expect(s.pages["query-0"]).toBeUndefined();
  expect(resourcePageDownloadedAt(s, "query-59", 200)).toBe(159);
  expect(pruneResourcePages(s, 200)).toBe(false);
});

it("bounds real UTF-8 payload bytes and removes an oversized refresh instead of retaining stale data", () => {
  const s = state();
  const large = page("😀".repeat(350_000));
  for (let i = 0; i < 5; i++)
    cacheResourcePage(s, `query-${i}`, large, 100 + i);
  expect(Object.keys(s.pages)).toEqual(["query-2", "query-3", "query-4"]);
  cacheResourcePage(
    s,
    "query-4",
    page("x".repeat(resourceCacheLimits.bytes)),
    200,
  );
  expect(s.pages["query-4"]).toBeUndefined();
  expect(s.pageMetadata?.["query-4"]).toBeUndefined();
  expect(s.pages["query-3"]).toEqual(large);
});

it("prunes legacy pages before known downloads and never invents historical freshness", () => {
  const s = state();
  for (let i = 0; i < resourceCacheLimits.pages; i++)
    s.pages[`legacy-${i}`] = page(String(i));
  cacheResourcePage(s, "new", page("Latest"), 100);
  expect(Object.keys(s.pages)).toHaveLength(resourceCacheLimits.pages);
  expect(s.pages.new).toEqual(page("Latest"));
  expect(resourcePageDownloadedAt(s, "legacy-2", 200)).toBeUndefined();
  s.pageMetadata!.orphan = { downloadedAt: 50 };
  s.pageMetadata!.new = { downloadedAt: 300 };
  expect(resourcePageDownloadedAt(s, "new", 200)).toBeUndefined();
  pruneResourcePages(s, 200);
  expect(s.pageMetadata).toEqual({});
  expect(s.pages.new).toEqual(page("Latest"));
});

it("preserves drafts, original requests, reviews and response contracts when cache entries are evicted", () => {
  const s = state();
  s.drafts["contacts/contacts"] = { name: "Unsaved company work" };
  s.journal.push({
    id: "pending",
    userId: "u",
    workspaceId: "w",
    call: {
      moduleId: "contacts",
      resource: "contacts",
      action: "create",
      input: { data: s.drafts["contacts/contacts"] },
      key: "pending",
    },
    dependencies: [],
    state: "pending",
    delivery: "uncertain",
    createdAt: 1,
    attempts: 1,
  });
  s.draftReviews = { review: { entryId: "pending" } };
  s.responseContracts = {};
  const original = structuredClone(s);
  const broken = page("Broken");
  broken.items[0].data = { text: "" };
  Object.assign(broken.items[0].data, { cyclic: broken });
  s.pages.broken = broken;
  expect(pruneResourcePages(s)).toBe(true);
  expect(s).toEqual(original);
});

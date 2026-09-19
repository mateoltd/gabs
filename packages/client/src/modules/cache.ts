import type { ResourcePage, ResourceListOptions } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import { resourceCursorCacheKey } from "@suite/module-sdk/queries";

/** Disposable downloaded pages, independent of drafts, requests and recovery data. */
export const resourceCacheLimits = {
  pages: 50,
  bytes: 5 * 1024 * 1024,
} as const;
export interface ResourcePageMetadata {
  downloadedAt: number;
}
export interface ResourcePageCache {
  pages: Record<string, ResourcePage>;
  pageMetadata?: Record<string, ResourcePageMetadata>;
  offlineLists?: Record<string, OfflineList>;
}
export interface OfflineList {
  id: string;
  moduleId: string;
  moduleVersion: string;
  resource: string;
  title: string;
  query: Omit<ResourceListOptions, "cursor">;
  maxPages: number;
  pages: string[];
  records: number;
  downloadedAt: number;
  truncated: boolean;
  revision: string;
}

export function resourcePageCacheKey(
  moduleId: string,
  version: string,
  resource: string,
  query: ResourceListOptions,
) {
  return canonical([
    moduleId,
    version,
    resource,
    query.search ?? "",
    resourceCursorCacheKey(query.cursor),
    query.archived ?? false,
    query.limit ?? 50,
    query.where ?? {},
    ...(Object.keys(query.ranges ?? {}).length ? [query.ranges] : []),
    ...(query.orderBy?.length ? [{ sort: query.orderBy }] : []),
  ]);
}

const selectedKeys = (state: ResourcePageCache) =>
  new Set(
    Object.values(state.offlineLists ?? {}).flatMap((list) => list.pages),
  );
const pageBytes = (state: ResourcePageCache, key: string) =>
  new TextEncoder().encode(
    JSON.stringify([key, state.pages[key], state.pageMetadata?.[key] ?? null]),
  ).byteLength;

function selectedPagesFit(state: ResourcePageCache) {
  const keys = [...selectedKeys(state)];
  return (
    keys.length <= resourceCacheLimits.pages &&
    keys.reduce((bytes, key) => bytes + pageBytes(state, key), 0) <=
      resourceCacheLimits.bytes
  );
}

/** Replace a complete download atomically; a failed budget check preserves the prior list. */
export function commitOfflineList(
  state: ResourcePageCache,
  list: OfflineList,
  downloaded: { key: string; page: ResourcePage; downloadedAt: number }[],
) {
  const candidate: ResourcePageCache = {
    pages: { ...state.pages },
    pageMetadata: { ...state.pageMetadata },
    offlineLists: { ...state.offlineLists, [list.id]: list },
  };
  if (Object.keys(candidate.offlineLists!).length > 20)
    throw Error(
      "Remove an offline list before saving another. This workspace can keep 20 lists.",
    );
  for (const entry of downloaded) {
    candidate.pages[entry.key] = entry.page;
    candidate.pageMetadata![entry.key] = { downloadedAt: entry.downloadedAt };
  }
  if (!selectedPagesFit(candidate))
    throw Error(
      "These offline lists exceed this device’s page budget. Choose fewer records or remove another list; your previous downloads are unchanged.",
    );
  pruneResourcePages(candidate);
  Object.assign(state, candidate);
}

export function removeOfflineList(state: ResourcePageCache, id: string) {
  const list = state.offlineLists?.[id];
  if (!list) return;
  delete state.offlineLists![id];
  const retained = selectedKeys(state);
  for (const key of list.pages)
    if (!retained.has(key)) {
      delete state.pages[key];
      if (state.pageMetadata) delete state.pageMetadata[key];
    }
}

export function clearRecentResourcePages(state: ResourcePageCache) {
  const retained = selectedKeys(state);
  for (const key of Object.keys(state.pages))
    if (!retained.has(key)) {
      delete state.pages[key];
      if (state.pageMetadata) delete state.pageMetadata[key];
    }
}

export function clearDownloadedResourcePages(state: ResourcePageCache) {
  state.pages = {};
  state.pageMetadata = {};
  state.offlineLists = {};
}

export function resourcePageDownloadedAt(
  state: ResourcePageCache,
  key: string,
  now = Date.now(),
): number | undefined {
  const value = state.pageMetadata?.[key]?.downloadedAt;
  return Object.hasOwn(state.pages, key) &&
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= now
    ? value
    : undefined;
}

/** Keep recent downloads; absent/invalid historical timestamps never imply freshness. */
export function pruneResourcePages(
  state: ResourcePageCache,
  now = Date.now(),
): boolean {
  let changed = false;
  let bytes = 0;
  let count = 0;
  const selected = selectedKeys(state);
  const entries = Object.entries(state.pages).sort(
    ([a], [b]) =>
      Number(selected.has(b)) - Number(selected.has(a)) ||
      (resourcePageDownloadedAt(state, b, now) ?? 0) -
        (resourcePageDownloadedAt(state, a, now) ?? 0) ||
      a.localeCompare(b),
  );
  for (const [key] of entries) {
    let size: number;
    try {
      size = pageBytes(state, key);
    } catch {
      // An unusable cache entry must not prevent saving unrelated pending work.
      size = Infinity;
    }
    if (
      count >= resourceCacheLimits.pages ||
      bytes + size > resourceCacheLimits.bytes
    ) {
      delete state.pages[key];
      changed = true;
    } else {
      bytes += size;
      count++;
    }
  }
  for (const key of Object.keys(state.pageMetadata ?? {})) {
    if (
      !Object.hasOwn(state.pages, key) ||
      !resourcePageDownloadedAt(state, key, now)
    ) {
      delete state.pageMetadata![key];
      changed = true;
    }
  }
  return changed;
}

export function cacheResourcePage(
  state: ResourcePageCache,
  key: string,
  page: ResourcePage,
  downloadedAt = Date.now(),
) {
  const candidate: ResourcePageCache = {
    ...state,
    pages: { ...state.pages, [key]: page },
    pageMetadata: { ...state.pageMetadata, [key]: { downloadedAt } },
  };
  if (selectedKeys(state).has(key) && !selectedPagesFit(candidate)) return;
  state.pages[key] = page;
  (state.pageMetadata ??= {})[key] = { downloadedAt };
  pruneResourcePages(state, downloadedAt);
}

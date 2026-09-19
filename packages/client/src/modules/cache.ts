import type { ResourcePage } from "@suite/module-sdk";

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
  const encoder = new TextEncoder();
  const entries = Object.entries(state.pages).sort(
    ([a], [b]) =>
      (resourcePageDownloadedAt(state, b, now) ?? 0) -
        (resourcePageDownloadedAt(state, a, now) ?? 0) || a.localeCompare(b),
  );
  for (const [key, page] of entries) {
    let size: number;
    try {
      size = encoder.encode(
        JSON.stringify([key, page, state.pageMetadata?.[key] ?? null]),
      ).byteLength;
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
  state.pages[key] = page;
  (state.pageMetadata ??= {})[key] = { downloadedAt };
  pruneResourcePages(state, downloadedAt);
}

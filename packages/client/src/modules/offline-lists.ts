import type {
  ModuleCall,
  ModuleDefinition,
  ResourceListOptions,
  ResourcePage,
} from "@suite/module-sdk";
import { validateResourceList } from "@suite/module-sdk/queries";
import { canonical } from "@suite/module-sdk/registry";
import type { Platform, Scope } from "../index";
import { changeModuleStorage } from "./storage";
import { validateModuleResponse } from "./response";
import {
  commitOfflineList,
  resourcePageCacheKey,
  resourceCacheLimits,
  type OfflineList,
} from "./cache";
export {
  removeOfflineList,
  clearRecentResourcePages,
  clearDownloadedResourcePages,
  resourcePageCacheKey,
  type OfflineList,
} from "./cache";

/** Download only the selected query, then commit its complete bounded result under the scope lock. */
export async function downloadOfflineList(options: {
  platform: Platform;
  scope: Scope;
  module: ModuleDefinition;
  resource: string;
  title: string;
  query: ResourceListOptions;
  maxPages: number;
  existing?: OfflineList;
  check(): void;
  send(call: ModuleCall): Promise<unknown>;
}) {
  const { module, resource, existing } = options;
  const definition = module.resources[resource];
  const title = options.title.trim();
  if (
    !definition ||
    !title ||
    title.length > 80 ||
    ![1, 5, 10].includes(options.maxPages)
  )
    throw Error("Choose a list name and a supported record limit.");
  const { cursor: _cursor, ...query } = options.query;
  query.limit ??= 50;
  validateResourceList(definition.schema, query);
  if (
    existing &&
    (existing.moduleId !== module.id ||
      existing.moduleVersion !== module.version ||
      existing.resource !== resource)
  )
    throw Error(
      "This saved list belongs to another module release. Save a new list using the current release.",
    );
  const downloaded: {
    key: string;
    page: ResourcePage;
    downloadedAt: number;
  }[] = [];
  const seen = new Set<string>();
  let downloadedBytes = 0;
  let cursor: string | undefined;
  for (let index = 0; index < options.maxPages; index++) {
    options.check();
    const input = { ...query, ...(cursor ? { cursor } : {}) };
    const key = resourcePageCacheKey(
      module.id,
      module.version,
      resource,
      input,
    );
    if (seen.has(key))
      throw Error(
        "The server returned a repeated page. The previous offline list is unchanged.",
      );
    seen.add(key);
    const call: ModuleCall = {
      moduleId: module.id,
      moduleVersion: module.version,
      resource,
      action: "list",
      input,
    };
    const result = await options.send(call);
    options.check();
    validateModuleResponse(module, call, result);
    const page = result as ResourcePage;
    downloadedBytes += new TextEncoder().encode(
      JSON.stringify(page),
    ).byteLength;
    if (
      page.items.length > query.limit ||
      downloadedBytes > resourceCacheLimits.bytes
    )
      throw Error(
        "This download exceeds the selected record or page budget. Choose fewer records; the previous list is unchanged.",
      );
    downloaded.push({ key, page, downloadedAt: Date.now() });
    cursor = page.nextCursor ?? undefined;
    if (!cursor) break;
  }
  const list: OfflineList = {
    id: existing?.id ?? crypto.randomUUID(),
    moduleId: module.id,
    moduleVersion: module.version,
    resource,
    title,
    query,
    maxPages: options.maxPages,
    pages: downloaded.map((entry) => entry.key),
    records: downloaded.reduce(
      (count, entry) => count + entry.page.items.length,
      0,
    ),
    downloadedAt: Date.now(),
    truncated: !!cursor,
    revision: crypto.randomUUID(),
  };
  await changeModuleStorage(options.platform, options.scope, (state) => {
    options.check();
    if (
      existing &&
      canonical(state.offlineLists?.[existing.id] ?? null) !==
        canonical(existing)
    )
      throw Error(
        "This offline list changed or was removed while downloading. Reload the lists before trying again.",
      );
    commitOfflineList(state, list, downloaded);
  });
  return list;
}

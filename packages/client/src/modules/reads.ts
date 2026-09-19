import {
  assertSchema,
  Type,
  type ModuleCall,
  type ModuleDefinition,
  type ModuleTransport,
  type ResourceListOptions,
  type ResourcePage,
  type ResourceRecord,
  type ResourceReadMetadata,
  type ResourceReadOptions,
} from "@suite/module-sdk";
import { validateResourceList } from "@suite/module-sdk/queries";
import { canonical } from "@suite/module-sdk/registry";
import type { Platform, Scope } from "../index";
import { changeModuleStorage, readModuleStorage } from "./storage";
import { validateModuleResponse } from "./response";
import {
  cacheResourcePage,
  resourcePageCacheKey,
  resourcePageDownloadedAt,
  type ResourcePageCache,
} from "./cache";

/** Full list rows are also downloaded records. Never cross a module/release/resource boundary. */
function downloadedRecord(
  state: ResourcePageCache,
  call: ModuleCall,
): { record: ResourceRecord; downloadedAt: number | null } | undefined {
  const id = (call.input as { id: string }).id;
  let best: { record: ResourceRecord; downloadedAt: number | null } | undefined;
  for (const [key, page] of Object.entries(state.pages)) {
    let identity: unknown;
    try {
      identity = JSON.parse(key);
    } catch {
      continue;
    }
    if (
      !Array.isArray(identity) ||
      identity.length < 4 ||
      identity[0] !== call.moduleId ||
      identity[1] !== call.moduleVersion ||
      identity[2] !== call.resource
    )
      continue;
    for (const record of page.items) {
      if (record.id !== id) continue;
      const downloadedAt = resourcePageDownloadedAt(state, key) ?? null;
      if (
        !best ||
        record.version > best.record.version ||
        (record.version === best.record.version &&
          (downloadedAt ?? 0) > (best.downloadedAt ?? 0))
      )
        best = { record, downloadedAt };
    }
  }
  return best;
}

/** Exact downloaded reads share the disposable page budget and never include provisional edits. */
export async function readModuleResource(
  context: {
    platform: Platform;
    scope: Scope;
    module: ModuleDefinition;
    online: boolean;
    /** Recheck current scope, installed release, view/resource permissions and cancellation. */
    check(): void;
    /** Current consent and authorization lease; checked again before storage/return. */
    canCache(): boolean;
    send: ModuleTransport;
  },
  call: ModuleCall,
  options: ResourceReadOptions = {},
): Promise<(ResourcePage | ResourceRecord) & { read: ResourceReadMetadata }> {
  call = structuredClone(call);
  const { module } = context;
  const check = () => {
    options.signal?.throwIfAborted();
    context.check();
  };
  check();
  if (
    call.moduleId !== module.id ||
    call.moduleVersion !== module.version ||
    !call.resource ||
    !Object.hasOwn(module.resources, call.resource) ||
    !["get", "list"].includes(call.action)
  )
    throw Error(
      "This request is not an ordinary resource read from the active release.",
    );
  let key: string;
  if (call.action === "list") {
    validateResourceList(module.resources[call.resource].schema, call.input);
    key = resourcePageCacheKey(
      module.id,
      module.version,
      call.resource,
      call.input as ResourceListOptions,
    );
  } else {
    assertSchema(
      Type.Object(
        { id: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      call.input,
    );
    key = canonical([
      module.id,
      module.version,
      call.resource,
      { get: (call.input as { id: string }).id },
    ]);
  }
  const validate = (value: unknown) => {
    validateModuleResponse(module, call, value);
    if (
      call.action === "get" &&
      (value as ResourceRecord).id !== (call.input as { id: string }).id
    )
      throw Error("The downloaded record does not match this request.");
  };
  if (context.online) {
    const result = await context.send(call, options);
    check();
    // The host owns provenance. Never retain a server- or cache-supplied source claim.
    const value = { ...(result as ResourcePage | ResourceRecord) };
    delete (value as { read?: unknown }).read;
    validate(value);
    const downloadedAt = Date.now();
    if (context.canCache())
      await changeModuleStorage(context.platform, context.scope, (state) => {
        check();
        if (context.canCache())
          cacheResourcePage(
            state,
            key,
            call.action === "list"
              ? (value as ResourcePage)
              : { items: [value as ResourceRecord], nextCursor: null },
            downloadedAt,
          );
      });
    check();
    return {
      ...value,
      read: { source: "server" } satisfies ResourceReadMetadata,
    };
  }
  if (options.source === "server")
    throw Error(
      "A server response is required for this read. Reconnect and try again.",
    );
  if (!context.canCache())
    throw Error(
      "Downloaded records are not available under the current offline access policy. Reconnect to verify access.",
    );
  const state = await readModuleStorage(context.platform, context.scope);
  check();
  if (!context.canCache())
    throw Error(
      "Offline access expired or changed. Reconnect to verify access.",
    );
  const page = call.action === "list" ? state.pages[key] : undefined;
  const record =
    call.action === "get" ? downloadedRecord(state, call) : undefined;
  const value = page ?? record?.record;
  if (!value)
    throw Error(
      "These records have not been downloaded for this request. Reconnect to load them.",
    );
  validate(value);
  return {
    ...(value as ResourcePage | ResourceRecord),
    read: {
      source: "cache",
      downloadedAt: record
        ? record.downloadedAt
        : (resourcePageDownloadedAt(state, key) ?? null),
    } satisfies ResourceReadMetadata,
  };
}

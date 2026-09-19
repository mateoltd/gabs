import {
  assertSchema,
  type ModuleDefinition,
  type ResourceReadOptions,
} from "@suite/module-sdk";
import {
  referenceQueryField,
  referenceFields,
  referenceTargetKey,
  pageReferenceOptions,
  ReferencePageSchema,
  type ReferenceQuery,
  type ReferenceTarget,
  type ReferencePage,
  type ReferenceReadPage,
} from "@suite/module-sdk/references";
import type { Platform, Scope } from "../index";
import {
  changeModuleStorage,
  readModuleStorage,
  pendingReferenceOptions,
} from "./storage";
import {
  cacheReferenceOptions,
  referenceDownloadedAt,
  removeReferenceTarget,
} from "./reference-cache";
export { clearReferenceCache, mergeReferenceOptions } from "./reference-cache";

export async function readModuleReferences(
  context: {
    platform: Platform;
    scope: Scope;
    module: ModuleDefinition;
    resource: string;
    online: boolean;
    authorization?(): string | undefined;
    check(target: ReferenceTarget): void;
    canCache(): boolean;
    send(query: ReferenceQuery, options: ResourceReadOptions): Promise<unknown>;
  },
  input: ReferenceQuery,
  options: ResourceReadOptions = {},
): Promise<ReferenceReadPage> {
  const query = structuredClone(input);
  const schema = context.module.resources[context.resource]?.schema;
  if (!schema) throw Error("The module does not declare this resource.");
  const field = referenceQueryField(schema, query);
  const target = field.target;
  const targetKey = referenceTargetKey(target);
  const crossModule =
    target.kind === "resource" && target.moduleId !== context.module.id;
  const revision = context.authorization?.();
  const legacy = `${context.module.id}@${context.module.version}/${context.resource}`;
  const key = `${legacy}/references-v1`;
  const legacyField = /^\/properties\/[^/]+$/.test(field.schemaPath)
    ? field.schemaPath.slice(12).replaceAll("~1", "/").replaceAll("~0", "~")
    : undefined;
  const check = () => {
    options.signal?.throwIfAborted();
    context.check(target);
    if (crossModule && context.authorization?.() !== revision)
      throw Error(
        "Reference access changed during this lookup. Retry with current permissions.",
      );
  };
  check();
  if (context.online) {
    let result: unknown;
    try {
      result = await context.send(query, options);
    } catch (error) {
      if (
        [403, 404].includes((error as { status?: number })?.status ?? 0) &&
        context.canCache()
      ) {
        check();
        await changeModuleStorage(context.platform, context.scope, (state) => {
          check();
          if (!context.canCache()) return;
          removeReferenceTarget(state, key, targetKey);
          for (const declaration of referenceFields(schema))
            if (
              referenceTargetKey(declaration.target) === targetKey &&
              /^\/properties\/[^/]+$/.test(declaration.schemaPath)
            )
              removeReferenceTarget(
                state,
                legacy,
                declaration.schemaPath
                  .slice(12)
                  .replaceAll("~1", "/")
                  .replaceAll("~0", "~"),
              );
        });
      }
      throw error;
    }
    check();
    // Source belongs to the host. The authoritative API contract itself has no offline claims.
    assertSchema(ReferencePageSchema, result);
    const page = result as ReferencePage;
    if (context.canCache())
      await changeModuleStorage(context.platform, context.scope, (state) => {
        check();
        if (context.canCache())
          cacheReferenceOptions(
            state,
            key,
            targetKey,
            [...page.items, ...(page.selected ? [page.selected] : [])],
            page.selected === null ? query.selected : undefined,
            Date.now(),
            revision,
          );
      });
    check();
    return { ...page, read: { source: "server" } };
  }
  if (options.source === "server")
    throw Error(
      "A server response is required for this lookup. Reconnect and try again.",
    );
  if (!context.canCache())
    throw Error("Connect to renew access to downloaded choices.");
  const state = await readModuleStorage(context.platform, context.scope);
  check();
  if (!context.canCache())
    throw Error("Connect to renew access to downloaded choices.");
  if (
    crossModule &&
    (!revision ||
      state.referenceMetadata?.[key]?.[targetKey]?.policyRevision !== revision)
  )
    throw Error(
      "Connect to verify this module’s access to downloaded reference choices.",
    );
  const current = state.referenceOptions?.[key]?.[targetKey];
  const downloaded =
    current ??
    (legacyField
      ? state.referenceOptions?.[legacy]?.[legacyField]
      : undefined) ??
    [];
  // A successful source lookup is required before exposing cross-module pending labels.
  const pending =
    target.kind !== "resource" ||
    target.moduleId === context.module.id ||
    current !== undefined
      ? pendingReferenceOptions(state.journal, context.scope, target)
      : [];
  const rows = [
    ...new Map(
      [...pending, ...downloaded].map((item) => [
        item.value.toLowerCase(),
        item,
      ]),
    ).values(),
  ];
  const page = pageReferenceOptions(rows, query);
  const ids = [...page.items, ...(page.selected ? [page.selected] : [])].map(
    (item) => item.value,
  );
  const downloadedAt = referenceDownloadedAt(
    state,
    current ? key : legacy,
    current ? targetKey : (legacyField ?? ""),
    ids,
  );
  return { ...page, offline: true, read: { source: "cache", downloadedAt } };
}

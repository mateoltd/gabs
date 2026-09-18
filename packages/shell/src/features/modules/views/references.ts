import { ApiError } from "@suite/client/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModuleDefinition } from "@suite/module-sdk";
import {
  referenceFields,
  referenceTargetKey,
  type ReferenceOption,
  type ReferencePage,
} from "@suite/module-sdk/references";
import { canUse, type FeatureProps } from "@suite/client";
import {
  changeModuleStorage,
  readModuleStorage,
  pendingReferenceOptions,
} from "@suite/client/module-storage";
import type { ReferenceLoader } from "@suite/ui-web";

type Options = Record<string, ReferenceOption[]>;
const mergeOptions = (old: ReferenceOption[], next: ReferenceOption[]) => {
  const options = new Map<string, ReferenceOption>();
  // Most recently used labels win; the cache is bounded per declared target.
  for (const item of [...old, ...next]) {
    options.delete(item.value.toLowerCase());
    options.set(item.value.toLowerCase(), item);
  }
  return [...options.values()].slice(-200);
};
export function useModuleReferences(
  props: FeatureProps,
  module: ModuleDefinition,
  resource: string,
) {
  const {
    client,
    scope,
    bootstrap,
    platform,
    online,
    offlineEnabled,
    moduleCatalog,
  } = props;
  const schema = module.resources[resource]?.schema;
  const declarations = useMemo(
    () => (schema ? referenceFields(schema) : []),
    [schema],
  );
  const legacyCacheKey = `${module.id}@${module.version}/${resource}`;
  const key = `${legacyCacheKey}/references-v1`;
  const [references, setReferences] = useState<Options>({});
  const [error, setError] = useState<unknown>();
  const [denied, setDenied] = useState<Record<string, true>>({});
  const load = useCallback<ReferenceLoader>(
    async (target, query, signal) => {
      signal.throwIfAborted();
      if (
        !canUse(
          bootstrap,
          module.id,
          `${module.id}.${resource}.read`,
          moduleCatalog,
        )
      )
        throw Error("You no longer have access to this resource.");
      const targetKey = referenceTargetKey(target);
      const declaration = declarations.find(
        (field) => referenceTargetKey(field.target) === targetKey,
      );
      if (!declaration)
        throw Error("The module does not declare this reference.");
      if (
        target.kind === "resource" &&
        !canUse(
          bootstrap,
          target.moduleId,
          `${target.moduleId}.${target.resource}.read`,
          moduleCatalog,
        )
      )
        throw Error("You no longer have access to the referenced resource.");
      if (!online) {
        if (
          !offlineEnabled ||
          !bootstrap.offlineHours ||
          Date.now() >=
            new Date(bootstrap.authorizedAt).getTime() +
              bootstrap.offlineHours * 3600000
        )
          throw Error("Connect to renew access to downloaded choices.");
        const stored = await readModuleStorage(platform, scope);
        signal.throwIfAborted();
        const cached = stored.referenceOptions?.[key] ?? {};
        const legacyKey =
          declaration.schemaPath.startsWith("/properties/") &&
          !declaration.schemaPath.slice(12).includes("/")
            ? declaration.schemaPath
                .slice(12)
                .replaceAll("~1", "/")
                .replaceAll("~0", "~")
            : undefined;
        const downloaded =
          cached[targetKey] ??
          (legacyKey &&
          Object.hasOwn(
            stored.referenceOptions?.[legacyCacheKey] ?? {},
            legacyKey,
          )
            ? stored.referenceOptions![legacyCacheKey][legacyKey]
            : []);
        // Pending creates are selectable but never added to authoritative pages or label caches.
        // Target permission and the corporate lease have already been checked above.
        const options = [
          ...new Map(
            [
              ...(target.kind !== "resource" ||
              target.moduleId === module.id ||
              cached[targetKey] !== undefined
                ? pendingReferenceOptions(stored.journal, scope, target)
                : []),
              ...downloaded,
            ].map((option) => [option.value.toLowerCase(), option]),
          ).values(),
        ];
        const rows = [...options]
          .sort((a, b) =>
            a.value.toLowerCase().localeCompare(b.value.toLowerCase()),
          )
          .filter(
            (item) =>
              (!query.cursor ||
                item.value.toLowerCase() > query.cursor.toLowerCase()) &&
              (!query.search ||
                item.label.toLowerCase().includes(query.search.toLowerCase())),
          );
        return {
          items: rows.slice(0, query.limit),
          nextCursor:
            rows.length > query.limit ? rows[query.limit - 1].value : null,
          ...(query.selected
            ? {
                selected:
                  options.find(
                    (item) =>
                      item.value.toLowerCase() ===
                      query.selected!.toLowerCase(),
                  ) ?? null,
              }
            : {}),
          offline: true,
        };
      }
      let page: ReferencePage;
      try {
        page = await client
          .module(module, scope.workspaceId)
          .resource(resource)
          .references({ ...query, field: declaration.schemaPath }, { signal });
      } catch (error) {
        if (error instanceof ApiError && [403, 404].includes(error.status)) {
          if (!signal.aborted)
            setDenied((current) =>
              current[targetKey] ? current : { ...current, [targetKey]: true },
            );
          setReferences((current) => {
            const next = { ...current };
            delete next[targetKey];
            return next;
          });
          if (offlineEnabled)
            await changeModuleStorage(platform, scope, (stored) => {
              const cached = stored.referenceOptions;
              if (cached?.[key]) delete cached[key][targetKey];
              for (const field of declarations) {
                if (
                  referenceTargetKey(field.target) !== targetKey ||
                  !/^\/properties\/[^/]+$/.test(field.schemaPath)
                )
                  continue;
                const legacyField = field.schemaPath
                  .slice(12)
                  .replaceAll("~1", "/")
                  .replaceAll("~0", "~");
                if (cached?.[legacyCacheKey])
                  delete cached[legacyCacheKey][legacyField];
              }
            });
        }
        throw error;
      }
      signal.throwIfAborted();
      setDenied((current) => {
        if (!current[targetKey]) return current;
        const next = { ...current };
        delete next[targetKey];
        return next;
      });
      const incoming = [
        ...page.items,
        ...(page.selected ? [page.selected] : []),
      ];
      setReferences((current) =>
        signal.aborted
          ? current
          : {
              ...current,
              [targetKey]: mergeOptions(current[targetKey] ?? [], incoming),
            },
      );
      if (offlineEnabled && bootstrap.offlineHours)
        await changeModuleStorage(platform, scope, (stored) => {
          if (signal.aborted) return;
          const options = ((stored.referenceOptions ??= {})[key] ??= {});
          options[targetKey] = mergeOptions(options[targetKey] ?? [], incoming);
        });
      signal.throwIfAborted();
      return page;
    },
    [
      client,
      scope.userId,
      scope.workspaceId,
      platform,
      module.id,
      module.version,
      resource,
      declarations,
      online,
      offlineEnabled,
      bootstrap,
      moduleCatalog,
    ],
  );
  useEffect(() => {
    const controller = new AbortController();
    setReferences({});
    setError(undefined);
    const targets = new Map(
      declarations.map((field) => [
        referenceTargetKey(field.target),
        field.target,
      ]),
    );
    void (async () => {
      if (
        !canUse(
          bootstrap,
          module.id,
          `${module.id}.${resource}.read`,
          moduleCatalog,
        )
      )
        return;
      // Only a first page per declared target. Further pages are requested by the picker.
      for (const target of targets.values()) {
        const page = await load(target, { limit: 25 }, controller.signal);
        if (!online)
          setReferences((current) =>
            controller.signal.aborted
              ? current
              : {
                  ...current,
                  [referenceTargetKey(target)]: page.items,
                },
          );
      }
    })().catch((error) => {
      if (!controller.signal.aborted) setError(error);
    });
    return () => controller.abort();
  }, [load]);
  const labels = useMemo(
    () =>
      Object.fromEntries(
        declarations
          .filter((field) => /^\/properties\/[^/]+$/.test(field.schemaPath))
          .map((field) => [
            field.schemaPath
              .slice(12)
              .replaceAll("~1", "/")
              .replaceAll("~0", "~"),
            references[referenceTargetKey(field.target)] ?? [],
          ]),
      ),
    [declarations, references],
  );
  // Invalidate mounted consumers when any lookup learns of a denial. Preloading
  // keeps the underlying stable callback so a persistent denial cannot retry-loop.
  const scopedLoad = useCallback<ReferenceLoader>(
    (...args) => load(...args),
    [load, denied],
  );
  return { references: labels, loadReferences: scopedLoad, error };
}

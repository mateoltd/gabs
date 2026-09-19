import { ApiError } from "@suite/client/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModuleDefinition } from "@suite/module-sdk";
import {
  referenceFields,
  referenceTargetKey,
  type ReferenceOption,
} from "@suite/module-sdk/references";
import { canUse, type FeatureProps } from "@suite/client";
import {
  readModuleReferences,
  mergeReferenceOptions,
} from "@suite/client/reference-reads";
import { assertReferenceAccess } from "../offline/reference-access";
import { canReadSavedWork } from "../recovery/access";
import type { ReferenceLoader } from "@suite/ui-web";

type Options = Record<string, ReferenceOption[]>;
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
  const latest = useRef({ props, module, resource });
  latest.current = { props, module, resource };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [references, setReferences] = useState<Options>({});
  const [error, setError] = useState<unknown>();
  const [denied, setDenied] = useState<Record<string, true>>({});
  const load = useCallback<ReferenceLoader>(
    async (target, query, signal) => {
      const targetKey = referenceTargetKey(target);
      const declaration = declarations.find(
        (field) => referenceTargetKey(field.target) === targetKey,
      );
      if (!declaration)
        throw Error("The module does not declare this reference.");
      const check = () => {
        signal.throwIfAborted();
        const current = latest.current;
        if (
          !mounted.current ||
          current.props.scope.userId !== scope.userId ||
          current.props.scope.workspaceId !== scope.workspaceId ||
          current.module.id !== module.id ||
          current.module.version !== module.version ||
          current.resource !== resource
        )
          throw Error(
            "This reference field is no longer active. Reopen it before loading choices.",
          );
        assertReferenceAccess(current.props, module, resource, target);
      };
      let page: Awaited<ReturnType<ReferenceLoader>>;
      try {
        page = await readModuleReferences(
          {
            platform,
            scope,
            module,
            resource,
            online: latest.current.props.online && navigator.onLine,
            authorization: () => latest.current.props.bootstrap.policyRevision,
            check,
            canCache: () =>
              latest.current.props.bootstrap.offlineHours > 0 &&
              canReadSavedWork(latest.current.props),
            send: (input, options) =>
              client
                .module(module, scope.workspaceId)
                .resource(resource)
                .references(input, options),
          },
          { ...query, field: declaration.schemaPath },
          { signal },
        );
        check();
      } catch (error) {
        if (!signal.aborted && mounted.current) {
          if (error instanceof ApiError && [403, 404].includes(error.status))
            setDenied((current) =>
              current[targetKey] ? current : { ...current, [targetKey]: true },
            );
          setReferences((current) => {
            const next = { ...current };
            delete next[targetKey];
            return next;
          });
        }
        throw error;
      }
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
      setReferences((current) => ({
        ...current,
        [targetKey]: page.offline
          ? incoming
          : mergeReferenceOptions(
              (current[targetKey] ?? []).filter(
                (item) =>
                  page.selected !== null ||
                  item.value.toLowerCase() !== query.selected?.toLowerCase(),
              ),
              incoming,
            ),
      }));
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
            (() => {
              try {
                assertReferenceAccess(props, module, resource, field.target);
              } catch {
                return [];
              }
              return references[referenceTargetKey(field.target)] ?? [];
            })(),
          ]),
      ),
    [declarations, references, load, props.snapshot],
  );
  // Invalidate mounted consumers when any lookup learns of a denial. Preloading
  // keeps the underlying stable callback so a persistent denial cannot retry-loop.
  const scopedLoad = useCallback<ReferenceLoader>(
    (...args) => load(...args),
    [load, denied],
  );
  return { references: labels, loadReferences: scopedLoad, error };
}

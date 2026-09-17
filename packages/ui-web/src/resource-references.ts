import { useEffect, useState } from "react";
import type { ResourceRecord, TSchema } from "@suite/module-sdk";
import {
  referencePointer,
  referenceTargetKey,
  referenceValues,
  type ReferenceLoader,
  type ReferenceTarget,
} from "@suite/module-sdk/references";

interface Request {
  key: string;
  target: ReferenceTarget;
  value: string;
}
export interface TableReferencePlan {
  rows: Map<string, Map<string, string>>;
  requests: Request[];
}
/** Resolve only displayed, schema-validated links; repeated targets share one lookup. */
export function tableReferencePlan(
  schema: TSchema,
  rows: readonly ResourceRecord[],
  columns: readonly string[],
): TableReferencePlan {
  const requests = new Map<string, Request>();
  const paths = new Map<string, Map<string, string>>();
  const prefixes = columns.map((key) => referencePointer("", key));
  for (const row of rows) {
    const fields = new Map<string, string>();
    try {
      for (const link of referenceValues(schema, row.data)) {
        if (
          !prefixes.some(
            (path) => link.path === path || link.path.startsWith(path + "/"),
          )
        )
          continue;
        const value = link.value.toLowerCase();
        const key = `${referenceTargetKey(link.target)}:${value}`;
        // An intersection may annotate the same path more than once. Ambiguous targets
        // are not presented as a single, potentially misleading reference label.
        if (fields.has(link.path) && fields.get(link.path) !== key) {
          fields.set(link.path, "ambiguous");
          continue;
        }
        fields.set(link.path, key);
        requests.set(key, { key, target: link.target, value });
      }
    } catch {
      // Retained provisional/legacy data can be invalid. Display its original values,
      // but do not invent target queries from data that the contract cannot interpret.
    }
    paths.set(row.id, fields);
  }
  const used = new Set(
    [...paths.values()].flatMap((fields) => [...fields.values()]),
  );
  return {
    rows: paths,
    requests: [...requests.values()].filter((request) => used.has(request.key)),
  };
}
export interface TableReferenceLabel {
  label?: string;
  offline?: boolean;
  failed?: boolean;
}
export function useTableReferences(
  plan: TableReferencePlan,
  load?: ReferenceLoader,
) {
  const key = JSON.stringify(plan.requests);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    load: ReferenceLoader;
    key: string;
    retry: number;
    labels: Record<string, TableReferenceLabel>;
  }>();
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    const requests = JSON.parse(key) as Request[];
    let next = 0;
    const denied = new Set<string>();
    setState({ load, key, retry, labels: {} });
    const run = async () => {
      while (!controller.signal.aborted && next < requests.length) {
        const request = requests[next++];
        const targetKey = referenceTargetKey(request.target);
        let result: TableReferenceLabel;
        if (denied.has(targetKey)) continue;
        try {
          const page = await load(
            request.target,
            { selected: request.value, limit: 1 },
            controller.signal,
          );
          const selected = page.selected;
          result = {
            ...(selected?.value.toLowerCase() === request.value
              ? { label: selected.label }
              : {}),
            ...(page.offline ? { offline: true } : {}),
          };
        } catch (error) {
          if (controller.signal.aborted) return;
          result = { failed: true };
          if (
            error &&
            typeof error === "object" &&
            (("status" in error && [403, 404].includes(Number(error.status))) ||
              ("code" in error &&
                ["FORBIDDEN", "GRANT_REQUIRED"].includes(String(error.code))))
          ) {
            denied.add(targetKey);
          }
        }
        if (controller.signal.aborted) return;
        setState((current) =>
          current?.load === load &&
          current.key === key &&
          current.retry === retry
            ? {
                ...current,
                labels: {
                  ...current.labels,
                  [request.key]: denied.has(targetKey)
                    ? { failed: true }
                    : result,
                  ...Object.fromEntries(
                    requests
                      .filter((item) =>
                        denied.has(referenceTargetKey(item.target)),
                      )
                      .map((item) => [item.key, { failed: true }]),
                  ),
                },
              }
            : current,
        );
      }
    };
    // A large page must not create one simultaneous request per cell.
    for (let worker = 0; worker < Math.min(4, requests.length); worker++)
      void run();
    return () => controller.abort();
  }, [load, key, retry]);
  const labels =
    state && state.load === load && state.key === key && state.retry === retry
      ? state.labels
      : {};
  return {
    labels,
    loading:
      !!load &&
      plan.requests.some((request) => !Object.hasOwn(labels, request.key)),
    failed: Object.values(labels).some((item) => item.failed),
    refresh: () => setRetry((value) => value + 1),
  };
}

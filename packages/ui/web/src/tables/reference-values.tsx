import { useMemo } from "react";
import type { ResourceRecord, TSchema } from "@suite/module-sdk";
import type { ReferenceLoader } from "@suite/module-sdk/references";
import { tableReferencePlan, useTableReferences } from "./resource-references";

/** Share schema-scoped labels across displayed snapshots, with bounded authorized lookups. */
export function useResourceValueReferences(
  schema: TSchema,
  rows: readonly Pick<ResourceRecord, "id" | "data">[],
  fields: readonly string[],
  load?: ReferenceLoader,
) {
  const plan = useMemo(
    () => tableReferencePlan(schema, rows, fields),
    [schema, rows, fields],
  );
  const resolved = useTableReferences(plan, load);
  return {
    ...resolved,
    renderReference: (rowId: string, id: string, path: string) => {
      const target = plan.rows.get(rowId)?.get(path);
      if (!load || !target) return undefined;
      const result = resolved.labels[target];
      return (
        <span title={id} aria-busy={!result && target !== "ambiguous"}>
          {result?.label ??
            (target === "ambiguous"
              ? "Ambiguous reference"
              : !result
                ? "Loading reference…"
                : result.offline
                  ? "Label not downloaded"
                  : "Reference unavailable")}
        </span>
      );
    },
  };
}

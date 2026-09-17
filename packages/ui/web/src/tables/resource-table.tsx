import { useMemo, type ReactNode } from "react";
import {
  objectPropertySchema,
  parseSchemaInput,
} from "@suite/module-sdk/forms";
import {
  referencePointer,
  type ReferenceLoader,
} from "@suite/module-sdk/references";
import { tableReferencePlan, useTableReferences } from "./resource-references";
import { Button } from "../controls/actions";
import type {
  ResourceRecord,
  Static,
  TObject,
  TSchema,
} from "@suite/module-sdk";
import { fieldLabel } from "../forms/schema-form";
import { Table } from "./work-list";

const emptyCells = {};

export function ResourceValue({
  value,
  schema,
  path = "",
  renderReference,
}: {
  value: unknown;
  schema?: TSchema;
  path?: string;
  renderReference?: (value: string, path: string) => ReactNode;
}) {
  if (typeof value === "string" && renderReference) {
    const rendered = renderReference(value, path);
    if (rendered !== undefined) return rendered;
  }
  if (schema?.anyOf) {
    const match = schema.anyOf.find(
      (candidate: TSchema) => parseSchemaInput(candidate, value).ok,
    );
    if (match) schema = match;
  }
  if (value === undefined) return <span>Not set</span>;
  if (value === null) return <span>No value</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "object") {
    const entries = Object.entries(value);
    const array = Array.isArray(value);
    return (
      <details className="resource-value">
        <summary>
          {entries.length}{" "}
          {array
            ? entries.length === 1
              ? "item"
              : "items"
            : entries.length === 1
              ? "field"
              : "fields"}
        </summary>
        <dl>
          {entries.map(([key, item]) => {
            const child = array
              ? Array.isArray(schema?.items)
                ? schema.items[Number(key)]
                : schema?.items
              : schema
                ? objectPropertySchema(schema, key)
                : undefined;
            return (
              <div key={key}>
                <dt>
                  {child?.title ?? (array ? Number(key) + 1 : fieldLabel(key))}
                </dt>
                <dd>
                  <ResourceValue
                    value={item}
                    schema={child}
                    path={referencePointer(path, key)}
                    renderReference={renderReference}
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      </details>
    );
  }
  if (value === "") return <span>Empty text</span>;
  const literal =
    schema?.enum?.includes(value) ||
    schema?.anyOf?.some((s: TSchema) => s.const === value);
  return (
    <span>
      {literal && typeof value === "string" ? fieldLabel(value) : String(value)}
    </span>
  );
}

/** Schema owns column keys and row types. Row actions and individual cells remain composable. */
export function TypedResourceTable<S extends TObject>({
  schema,
  columns,
  rows,
  label,
  references = {},
  loadReferences,
  renderActions,
  cells = emptyCells,
}: {
  schema: S;
  columns?: readonly (keyof Static<NoInfer<S>> & string)[];
  rows: readonly ResourceRecord<Static<NoInfer<S>>>[];
  label: string;
  references?: Record<string, readonly { value: string; label: string }[]>;
  loadReferences?: ReferenceLoader;
  renderActions?: (row: ResourceRecord<Static<NoInfer<S>>>) => ReactNode;
  cells?: {
    [K in keyof Static<NoInfer<S>>]?: (
      value: Static<S>[K],
      row: ResourceRecord<Static<S>>,
    ) => ReactNode;
  };
}) {
  const keys = columns ?? Object.keys(schema.properties);
  const plan = useMemo(
    () =>
      tableReferencePlan(
        schema,
        rows,
        keys.filter((key) => !Object.hasOwn(cells, key)),
      ),
    [schema, rows, columns, cells],
  );
  const resolved = useTableReferences(plan, loadReferences);
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      <Table className="module-table resource-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {keys.map((key) => (
              <th scope="col" key={key}>
                {schema.properties[key]?.title ?? fieldLabel(key)}
              </th>
            ))}
            {renderActions && (
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {keys.map((key) => {
                const value = (
                  Object.hasOwn(row.data, key) ? row.data[key] : undefined
                ) as Static<S>[typeof key];
                const render = Object.hasOwn(cells, key)
                  ? cells[key]
                  : undefined;
                return (
                  <td key={key}>
                    {render ? (
                      render(value, row)
                    ) : (
                      <ResourceValue
                        value={value}
                        schema={schema.properties[key]}
                        path={referencePointer("", key)}
                        renderReference={(id, path) => {
                          const target = plan.rows.get(row.id)?.get(path);
                          if (loadReferences && target) {
                            const result = resolved.labels[target];
                            return (
                              <span
                                title={id}
                                aria-busy={!result && target !== "ambiguous"}
                              >
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
                          }
                          if (loadReferences) return undefined;
                          const options = Object.hasOwn(references, path)
                            ? references[path]
                            : path === referencePointer("", key) &&
                                Object.hasOwn(references, key)
                              ? references[key]
                              : undefined;
                          return options?.find(
                            (option) =>
                              option.value.toLowerCase() === id.toLowerCase(),
                          )?.label;
                        }}
                      />
                    )}
                  </td>
                );
              })}
              {renderActions && <td>{renderActions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
      {resolved.failed && (
        <div className="actions">
          <p role="status">Some reference labels could not be loaded.</p>
          <Button
            type="button"
            variant="ghost"
            disabled={resolved.loading}
            onClick={resolved.refresh}
          >
            Retry reference labels
          </Button>
        </div>
      )}
    </div>
  );
}

import type { ReactNode } from "react";
import type {
  ResourceRecord,
  Static,
  TObject,
  TSchema,
} from "@suite/module-sdk";
import { fieldLabel } from "./schema-form";
import { Table } from "./work-list";

export function ResourceValue({
  value,
  schema,
}: {
  value: unknown;
  schema?: TSchema;
}) {
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
          {entries.map(([key, item]) => (
            <div key={key}>
              <dt>
                {array
                  ? Number(key) + 1
                  : (schema?.properties?.[key]?.title ?? fieldLabel(key))}
              </dt>
              <dd>
                <ResourceValue
                  value={item}
                  schema={array ? schema?.items : schema?.properties?.[key]}
                />
              </dd>
            </div>
          ))}
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
  renderActions,
  cells = {},
}: {
  schema: S;
  columns?: readonly (keyof Static<NoInfer<S>> & string)[];
  rows: readonly ResourceRecord<Static<NoInfer<S>>>[];
  label: string;
  references?: Record<string, readonly { value: string; label: string }[]>;
  renderActions?: (row: ResourceRecord<Static<NoInfer<S>>>) => ReactNode;
  cells?: {
    [K in keyof Static<NoInfer<S>>]?: (
      value: Static<S>[K],
      row: ResourceRecord<Static<S>>,
    ) => ReactNode;
  };
}) {
  const keys = columns ?? Object.keys(schema.properties);
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      <Table className="module-table">
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
                const options = Object.hasOwn(references, key)
                  ? references[key]
                  : undefined;
                return (
                  <td key={key}>
                    {render
                      ? render(value, row)
                      : (options?.find((option) => option.value === value)
                          ?.label ?? (
                          <ResourceValue
                            value={value}
                            schema={schema.properties[key]}
                          />
                        ))}
                  </td>
                );
              })}
              {renderActions && <td>{renderActions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

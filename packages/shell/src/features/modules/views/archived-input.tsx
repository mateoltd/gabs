import { useMemo } from "react";
import type { TObject } from "@suite/module-sdk";
import {
  referencePointer,
  type ReferenceLoader,
} from "@suite/module-sdk/references";
import {
  Button,
  ResourceValue,
  fieldLabel,
  useResourceValueReferences,
} from "@suite/ui-web";

export function ArchivedInput({
  schema,
  data,
  columns,
  loadReferences,
}: {
  schema: TObject;
  data: Record<string, unknown>;
  columns: readonly string[];
  loadReferences?: ReferenceLoader;
}) {
  const fields = useMemo(
    () =>
      [...new Set([...columns, ...Object.keys(data)])].filter((key) =>
        Object.hasOwn(data, key),
      ),
    [columns, data],
  );
  const snapshots = useMemo(() => [{ id: "input", data }], [data]);
  const references = useResourceValueReferences(
    schema,
    snapshots,
    fields,
    loadReferences,
  );
  return (
    <section className="form-stack" aria-label="Archived input">
      <p>
        This record has been archived. Your saved input is preserved below.
        Export a copy to recover it.
      </p>
      <dl className="module-conflict-values module-saved-values">
        {fields.map((key) => (
          <div key={key}>
            <dt>{schema.properties[key]?.title ?? fieldLabel(key)}</dt>
            <dd>
              <ResourceValue
                schema={schema.properties[key]}
                value={data[key]}
                path={referencePointer("", key)}
                renderReference={(id, path) =>
                  references.renderReference("input", id, path)
                }
              />
            </dd>
          </div>
        ))}
      </dl>
      {references.failed && (
        <div className="actions">
          <p role="status">Some reference labels could not be loaded.</p>
          <Button
            variant="ghost"
            disabled={references.loading}
            onClick={references.refresh}
          >
            Retry reference labels
          </Button>
        </div>
      )}
    </section>
  );
}

import { useMemo, useState } from "react";
import {
  Type,
  hydrateSchema,
  type Static,
  type TObject,
  type TSchema,
} from "@suite/module-sdk";
import { createSchemaDraft, parseSchemaInput } from "@suite/module-sdk/forms";
import { Button, Field } from "./index";
import { Select, SelectOption } from "./controls";
import { TypedSchemaForm, fieldLabel } from "./schema-form";

/** Uses the same editor and validators as writes; selected fields combine with AND. */
export function TypedResourceFilters<S extends TObject>({
  schema,
  value,
  onChange,
  references,
}: {
  schema: S;
  value: Partial<Static<NoInfer<S>>>;
  onChange: (value: Partial<Static<NoInfer<S>>>) => void;
  references?: Record<string, { value: string; label: string }[]>;
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState(Object.keys(schema.properties)[0] ?? "");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState("");
  const editor = useMemo(
    () =>
      Type.Required(
        Type.Pick(
          hydrateSchema(schema) as TObject,
          (Object.hasOwn(schema.properties, field) ? [field] : []) as string[],
        ),
      ),
    [schema, field],
  );
  const entries = Object.entries(value);
  const begin = (key: string) => {
    setField(key);
    const selected = Type.Required(
      Type.Pick(hydrateSchema(schema) as TObject, [key]),
    );
    setDraft(
      Object.hasOwn(value, key)
        ? { [key]: value[key] }
        : createSchemaDraft(selected),
    );
    setInvalid(false);
    setError("");
  };
  return (
    <div className="resource-filters">
      <div className="module-toolbar">
        <Button
          aria-expanded={open}
          onClick={() => {
            if (!open)
              begin(
                Object.hasOwn(schema.properties, field)
                  ? field
                  : Object.keys(schema.properties)[0],
              );
            setOpen(!open);
          }}
          disabled={!Object.keys(schema.properties).length}
        >
          Filters{entries.length ? ` (${entries.length})` : ""}
        </Button>
        {entries.map(([key, item]) => (
          <Button
            key={key}
            variant="ghost"
            aria-label={`Remove ${schema.properties[key]?.title ?? fieldLabel(key)} filter`}
            onClick={() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}
          >
            <span className="resource-filter-label">
              {schema.properties[key]?.title ?? fieldLabel(key)}:{" "}
              {JSON.stringify(item)}
            </span>
            <span aria-hidden="true">×</span>
          </Button>
        ))}
        {entries.length > 1 && (
          <Button variant="ghost" onClick={() => onChange({})}>
            Clear filters
          </Button>
        )}
      </div>
      {open && (
        <form
          className="resource-filter-editor form-stack"
          aria-label="Filter records"
          onSubmit={(event) => {
            event.preventDefault();
            const result = parseSchemaInput(editor, draft);
            if (!result.ok || invalid) {
              setError("Enter a valid filter value.");
              return;
            }
            if (entries.length >= 16 && !Object.hasOwn(value, field)) {
              setError(
                "Remove a filter before adding another. Up to 16 fields can be filtered together.",
              );
              return;
            }
            onChange({ ...value, ...result.value });
            setOpen(false);
            setError("");
          }}
        >
          <Field label="Filter by">
            <Select value={field} onValueChange={begin}>
              {Object.entries(schema.properties).map(([key, definition]) => (
                <SelectOption key={key} value={key}>
                  {(definition as TSchema).title ?? fieldLabel(key)}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <TypedSchemaForm
            key={field}
            schema={editor}
            value={draft}
            onChange={setDraft}
            referenceOptions={references}
            onValidityChange={(valid) => setInvalid(!valid)}
          />
          <p className="muted">
            Matches this field exactly. All active filters must match.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="actions">
            <Button type="submit" disabled={invalid}>
              Apply filter
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

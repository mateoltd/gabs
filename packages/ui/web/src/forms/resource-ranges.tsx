import { referenceFields } from "@suite/module-sdk/references";
import { useId, useMemo, useState } from "react";
import {
  Type,
  hydrateSchema,
  type TObject,
  type Static,
  type TSchema,
  type ResourceRanges,
  type ResourceRangeBounds,
} from "@suite/module-sdk";
import {
  resourceRangeKind,
  validateResourceList,
} from "@suite/module-sdk/queries";
import { createSchemaDraft, parseSchemaInput } from "@suite/module-sdk/forms";
import { Button } from "../controls/actions";
import { Field } from "./fields";
import { Select, SelectOption } from "../controls/controls";
import { TypedSchemaForm, fieldLabel } from "./schema-form";

const operators = {
  gte: "At least",
  gt: "Greater than",
  lte: "At most",
  lt: "Less than",
  between: "Between (inclusive)",
} as const;
type Operator = keyof typeof operators;

/** Optional range controls compose with equality filters; all conditions combine with AND. */
export function TypedResourceRanges<S extends TObject>({
  schema,
  value,
  onChange,
}: {
  schema: S;
  value: ResourceRanges<Static<NoInfer<S>>>;
  onChange: (value: ResourceRanges<Static<NoInfer<S>>>) => void;
}) {
  const descriptionId = useId();
  const fields = Object.entries(schema.properties).filter(
    ([, field]) =>
      resourceRangeKind(field as TSchema) &&
      referenceFields(field as TSchema).length === 0,
  );
  const [open, setOpen] = useState(false);
  const [selectedField, setField] = useState(fields[0]?.[0] ?? "");
  const field = fields.some(([key]) => key === selectedField)
    ? selectedField
    : (fields[0]?.[0] ?? "");
  const [operator, setOperator] = useState<Operator>("gte");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState("");
  const makeEditor = (key: string, op: Operator): TObject => {
    const original = (hydrateSchema(schema) as TObject).properties[key];
    const child = Type.Exclude(original, Type.Null());
    return Type.Required(
      Type.Object(
        op === "between"
          ? {
              lower: { ...child, title: "Lower bound" },
              upper: { ...child, title: "Upper bound" },
            }
          : { bound: { ...child, title: "Bound" } },
      ),
    );
  };
  const editor = useMemo<TObject>(
    () => (fields.length ? makeEditor(field, operator) : Type.Object({})),
    [schema, field, operator],
  );
  const begin = (key: string, op: Operator) => {
    setField(key);
    setOperator(op);
    setDraft(createSchemaDraft(makeEditor(key, op)) as Record<string, unknown>);
    setInvalid(false);
    setError("");
  };
  const entries = Object.entries(value) as [string, ResourceRangeBounds][];
  if (!fields.length) return null;
  return (
    <div className="resource-filters">
      <div className="module-toolbar">
        <Button
          aria-expanded={open}
          onClick={() => {
            if (!open) begin(field, operator);
            setOpen(!open);
          }}
        >
          Ranges{entries.length ? ` (${entries.length})` : ""}
        </Button>
        {entries.map(([key, bounds], index) => (
          <Button
            key={key}
            variant="ghost"
            aria-describedby={`${descriptionId}-${index}`}
            title={Object.entries(bounds)
              .map(
                ([op, value]) =>
                  `${operators[op as Exclude<Operator, "between">]} ${JSON.stringify(value)}`,
              )
              .join(", ")}
            aria-label={`Remove ${schema.properties[key]?.title ?? fieldLabel(key)} range`}
            onClick={() => {
              const next = { ...value };
              delete next[key as keyof typeof next];
              onChange(next);
            }}
          >
            <span
              id={`${descriptionId}-${index}`}
              className="resource-filter-label"
            >
              {schema.properties[key]?.title ?? fieldLabel(key)}:{" "}
              {Object.entries(bounds)
                .map(
                  ([op, value]) =>
                    `${operators[op as Exclude<Operator, "between">]} ${JSON.stringify(value)}`,
                )
                .join(", ")}
            </span>
            <span aria-hidden="true">×</span>
          </Button>
        ))}
        {entries.length > 1 && (
          <Button variant="ghost" onClick={() => onChange({})}>
            Clear ranges
          </Button>
        )}
      </div>
      {open && (
        <form
          className="resource-filter-editor form-stack"
          aria-label="Filter ranges"
          onSubmit={(event) => {
            event.preventDefault();
            const result = parseSchemaInput(editor, draft);
            if (!result.ok || invalid) {
              setError("Enter valid range bounds.");
              return;
            }
            const bounds =
              operator === "between"
                ? { gte: result.value.lower, lte: result.value.upper }
                : { [operator]: result.value.bound };
            const next = { ...value, [field]: bounds };
            try {
              validateResourceList(schema, { ranges: next });
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Check the range bounds.",
              );
              return;
            }
            onChange(next);
            setOpen(false);
            setError("");
          }}
        >
          <Field label="Range field">
            <Select value={field} onValueChange={(key) => begin(key, operator)}>
              {fields.map(([key, definition]) => (
                <SelectOption key={key} value={key}>
                  {definition.title ?? fieldLabel(key)}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <Field label="Comparison">
            <Select
              value={operator}
              onValueChange={(op) => begin(field, op as Operator)}
            >
              {Object.entries(operators).map(([op, title]) => (
                <SelectOption key={op} value={op}>
                  {title}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <TypedSchemaForm
            key={`${field}/${operator}`}
            schema={editor}
            value={draft}
            onChange={setDraft}
            onValidityChange={(valid) => setInvalid(!valid)}
          />
          <p className="muted">
            All active ranges and filters must match. Null and missing values
            are excluded.
            {resourceRangeKind(schema.properties[field]) === "string"
              ? " Text uses case-sensitive character order. Dates use their stored text order."
              : ""}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="actions">
            <Button type="submit" disabled={invalid}>
              Apply range
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

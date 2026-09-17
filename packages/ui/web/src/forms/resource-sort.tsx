import { useId, useState } from "react";
import type {
  ResourceOrder,
  ResourceSort,
  Static,
  TObject,
  TSchema,
} from "@suite/module-sdk";
import {
  resourceSortKind,
  validateResourceList,
} from "@suite/module-sdk/queries";
import { referenceFields } from "@suite/module-sdk/references";
import { Button } from "../controls/actions";
import { Field } from "./fields";
import { Select, SelectOption } from "../controls/controls";
import { fieldLabel } from "./schema-form";

/** Priority is explicit; all entries and callbacks retain the resource's scalar field types. */
export function TypedResourceSort<S extends TObject>({
  schema,
  value,
  onChange,
}: {
  schema: S;
  value: ResourceOrder<Static<NoInfer<S>>>;
  onChange: (value: ResourceOrder<Static<NoInfer<S>>>) => void;
}) {
  const descriptionId = useId();
  const fields = Object.entries(schema.properties).filter(
    ([, field]) =>
      resourceSortKind(field as TSchema) &&
      !referenceFields(field as TSchema).length,
  );
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<ResourceSort[]>([]),
    [error, setError] = useState("");
  const label = (field: string) =>
    schema.properties[field]?.title ?? fieldLabel(field);
  const change = (index: number, next: ResourceSort) =>
    setDraft(draft.map((item, i) => (i === index ? next : item)));
  if (!fields.length) return null;
  const description = value
    .map(
      (item) =>
        `${label(item.field)} ${item.direction === "asc" ? "ascending" : "descending"}`,
    )
    .join(", then ");
  return (
    <div className="resource-filters">
      <div className="module-toolbar">
        <Button
          aria-expanded={open}
          aria-describedby={value.length ? descriptionId : undefined}
          onClick={() => {
            if (!open) {
              setDraft(
                value.length
                  ? value.map((item) => ({ ...item }))
                  : [{ field: fields[0][0], direction: "asc" }],
              );
              setError("");
            }
            setOpen(!open);
          }}
        >
          Sort{value.length ? ` (${value.length})` : ""}
        </Button>
        {value.length > 0 && (
          <>
            <span
              id={descriptionId}
              className="resource-filter-label"
              title={description}
            >
              {description}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
            >
              Reset sort
            </Button>
          </>
        )}
      </div>
      {open && (
        <form
          className="resource-filter-editor form-stack"
          aria-label="Sort records"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              validateResourceList(schema, { orderBy: draft });
              onChange(draft as unknown as ResourceOrder<Static<S>>);
              setOpen(false);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Check the sort fields.",
              );
            }
          }}
        >
          {draft.map((item, index) => (
            <fieldset key={index} className="sort-level">
              <legend>
                {index === 0 ? "Sort first" : `Then sort ${index + 1}`}
              </legend>
              <Field label={`Sort field ${index + 1}`}>
                <Select
                  value={item.field}
                  onValueChange={(field) => change(index, { ...item, field })}
                >
                  {fields
                    .filter(
                      ([key]) =>
                        !draft.some(
                          (other, i) => i !== index && other.field === key,
                        ),
                    )
                    .map(([key]) => (
                      <SelectOption key={key} value={key}>
                        {label(key)}
                      </SelectOption>
                    ))}
                </Select>
              </Field>
              <Field label={`Direction ${index + 1}`}>
                <Select
                  value={item.direction}
                  onValueChange={(direction) =>
                    change(index, {
                      ...item,
                      direction: direction as "asc" | "desc",
                    })
                  }
                >
                  <SelectOption value="asc">Ascending</SelectOption>
                  <SelectOption value="desc">Descending</SelectOption>
                </Select>
              </Field>
              <div className="actions">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={`Move sort ${index + 1} earlier`}
                  onClick={() => {
                    const next = [...draft];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    setDraft(next);
                  }}
                >
                  Move earlier
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove sort ${index + 1}`}
                  onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            </fieldset>
          ))}
          {draft.length < Math.min(3, fields.length) && (
            <Button
              type="button"
              onClick={() =>
                setDraft([
                  ...draft,
                  {
                    field: fields.find(
                      ([key]) => !draft.some((item) => item.field === key),
                    )![0],
                    direction: "asc",
                  },
                ])
              }
            >
              Add sort field
            </Button>
          )}
          <p className="muted">
            Unspecified values come last in both directions. Add another field
            to order matching values. Text order is case-sensitive.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="actions">
            <Button type="submit">Apply sort</Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

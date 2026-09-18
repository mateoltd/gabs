import type { FieldReview, TObject } from "@suite/module-sdk";
import {
  Field,
  Select,
  SelectOption,
  ResourceValue,
  fieldLabel,
} from "@suite/ui-web";

export function ConflictReview({
  review,
  version,
  schema,
  disabled,
  onChoose,
}: {
  review: FieldReview;
  version: number;
  schema: TObject;
  disabled: boolean;
  onChoose(field: string, source: "local" | "remote"): void;
}) {
  return (
    <section className="form-stack" aria-label="Conflict comparison">
      <h3>Review competing changes</h3>
      <p>
        Server values are from version {version}. Saving rechecks the current
        server state. Unrelated server changes are preserved.
      </p>
      {!review.base && (
        <p role="status">
          The original values were not retained. Choose explicitly for every
          differing field.
        </p>
      )}
      {!review.conflicts.length && (
        <p role="status">
          These edits do not overlap. Review the combined values below before
          saving.
        </p>
      )}
      {review.conflicts.map((key) => {
        const label = schema.properties[key]?.title ?? fieldLabel(key);
        return (
          <fieldset key={key} className="form-stack" disabled={disabled}>
            <legend>{label}</legend>
            <dl className="module-conflict-values">
              <div>
                <dt>Original</dt>
                <dd>
                  {review.base ? (
                    <ResourceValue
                      schema={schema.properties[key]}
                      value={review.base[key]}
                    />
                  ) : (
                    "Unavailable"
                  )}
                </dd>
              </div>
              <div>
                <dt>Your change</dt>
                <dd>
                  <ResourceValue
                    schema={schema.properties[key]}
                    value={review.local[key]}
                  />
                </dd>
              </div>
              <div>
                <dt>Server</dt>
                <dd>
                  <ResourceValue
                    schema={schema.properties[key]}
                    value={review.remote[key]}
                  />
                </dd>
              </div>
            </dl>
            <Field label={`Use value for ${label.toLowerCase()}`}>
              <Select
                value={
                  Object.hasOwn(review.choices, key) ? review.choices[key] : ""
                }
                onValueChange={(value) => {
                  if (value === "local" || value === "remote")
                    onChoose(key, value);
                }}
              >
                <SelectOption value="local">Your change</SelectOption>
                <SelectOption value="remote">Server value</SelectOption>
              </Select>
            </Field>
          </fieldset>
        );
      })}
    </section>
  );
}

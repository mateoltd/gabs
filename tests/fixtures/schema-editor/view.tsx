import { useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import {
  createSchemaDraft,
  parseSchemaInput,
  type SchemaDraft,
} from "@suite/module-sdk/forms";
import type { Static } from "@suite/module-sdk";
import {
  TypedSchemaForm,
  Button,
  ErrorMessage,
  PageHeading,
} from "@suite/ui-web";
import module from "./module";
const schema = module.resources.records.schema;
export default defineView(module, function Intake({ client, online }) {
  const [value, setValue] = useState<SchemaDraft<Static<typeof schema>>>(() =>
    createSchemaDraft(schema),
  );
  const [review, setReview] = useState(false),
    [valid, setValid] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState<Static<typeof schema>>();
  return (
    <>
      <PageHeading
        title="Supplier intake"
        description="Reusable typed fields from the module contract."
      />
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setReview(true);
          const result = parseSchemaInput(schema, value);
          if (!result.ok || !valid) return;
          setBusy(true);
          setError(undefined);
          void client
            .resource("records")
            .create(result.value)
            .then((row) => setSaved(row.data))
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <fieldset
          className="form-stack"
          disabled={busy}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <TypedSchemaForm
            schema={schema}
            value={value}
            onChange={setValue}
            validate={review}
            onValidityChange={setValid}
          />
        </fieldset>
        <div className="actions">
          <Button type="button" onClick={() => setReview(true)}>
            Check fields
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !online || !valid}
          >
            Save intake
          </Button>
        </div>
        <ErrorMessage error={error} />
        {saved && (
          <p role="status">
            Saved {saved.candidate}: {saved.lines.length} lines.
          </p>
        )}
      </form>
    </>
  );
});

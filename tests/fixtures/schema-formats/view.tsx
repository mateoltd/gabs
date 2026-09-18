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
import module, { schema } from "./module";
export default defineView(module, function FormattedIntake({ client }) {
  const [value, setValue] = useState<SchemaDraft<Static<typeof schema>>>(() =>
    createSchemaDraft(schema),
  );
  const [valid, setValid] = useState(false);
  const [review, setReview] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeading
        title="Formatted intake"
        description="Format validation shared by the host and module."
      />
      <form
        className="form-stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setReview(true);
          const result = parseSchemaInput(schema, value);
          if (!result.ok || !valid || busy) return;
          setBusy(true);
          setError(undefined);
          void client
            .resource("records")
            .create(result.value)
            .then((row) => setSaved(row.data.email))
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <TypedSchemaForm
          schema={schema}
          value={value}
          onChange={setValue}
          validate={review}
          onValidityChange={setValid}
        />
        <div className="actions">
          <Button type="button" onClick={() => setReview(true)}>
            Check fields
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            Save record
          </Button>
        </div>
        <ErrorMessage error={error} />
        {saved && <p role="status">Saved {saved}</p>}
      </form>
    </>
  );
});

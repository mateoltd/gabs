import { useMemo, useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import { createSchemaDraft, parseSchemaInput } from "@suite/module-sdk/forms";
import {
  TypedSchemaForm,
  Button,
  PageHeading,
  ErrorMessage,
} from "@suite/ui-web";
import module from "./module";
const schema = module.resources.records.schema;
export default defineView(module, function Form({ client }) {
  const records = useMemo(() => client.resource("records"), [client]);
  const [value, setValue] = useState(() => createSchemaDraft(schema));
  const [valid, setValid] = useState(false),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState("");
  return (
    <>
      <PageHeading
        title="Structured links"
        description="Choose records, name map entries and fill each tuple position."
      />
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          const result = parseSchemaInput(schema, value);
          if (!result.ok) return;
          setError(undefined);
          void records
            .create(result.value)
            .then((row) => setSaved(row.id))
            .catch(setError);
        }}
      >
        <TypedSchemaForm
          schema={schema}
          value={value}
          onChange={setValue}
          onValidityChange={setValid}
          loadReferences={records.loadReferences}
        />
        <Button type="submit" disabled={!valid}>
          Save structured record
        </Button>
        <ErrorMessage error={error} />
        {saved && <p role="status">Saved structured record</p>}
      </form>
    </>
  );
});

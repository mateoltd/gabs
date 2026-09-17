import { parseSchemaInput } from "@suite/module-sdk/forms";
import { useMemo, useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import {
  TypedSchemaForm,
  Button,
  ErrorMessage,
  PageHeading,
} from "@suite/ui-web";
import type { Static } from "@suite/module-sdk";
import module from "./module";
const schema = module.resources.notes.schema;
export default defineView(module, function ReferenceView({ client }) {
  const notes = useMemo(() => client.resource("notes"), [client]);
  const [value, setValue] = useState<Partial<Static<typeof schema>>>({
    name: "",
    link: "",
  });
  const [valid, setValid] = useState(false),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState(""),
    [checked, setChecked] = useState("");
  return (
    <>
      <PageHeading
        title="Linked note"
        description="Choose a target through the public module client."
      />
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setError(undefined);
          const parsed = parseSchemaInput(schema, value);
          if (!parsed.ok) return;
          void notes
            .create(parsed.value)
            .then((row) => setSaved(row.data.name))
            .catch(setError);
        }}
      >
        <TypedSchemaForm
          schema={schema}
          value={value}
          onChange={setValue}
          onValidityChange={setValid}
          loadReferences={notes.loadReferences}
        />
        <div className="actions">
          <Button type="submit" disabled={!valid}>
            Save linked note
          </Button>
          <Button
            type="button"
            disabled={!value.link}
            onClick={() => {
              setError(undefined);
              void client
                .call("lookup", {
                  field: "/properties/link",
                  selected: value.link,
                })
                .then((page) =>
                  setChecked(page.selected?.label ?? "Unavailable"),
                )
                .catch(setError);
            }}
          >
            Check server lookup
          </Button>
        </div>
        <ErrorMessage error={error} />
        {saved && <p role="status">Saved {saved}</p>}
        {checked && <p role="status">Server verified {checked}</p>}
      </form>
    </>
  );
});

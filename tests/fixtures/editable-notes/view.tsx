import { useEffect, useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import { Button, Input, Field, PageHeading, ErrorMessage } from "@suite/ui-web";
import module from "./module";
export default defineView(
  module,
  "home",
  function Notes({ client, online, state }) {
    const name = state.value?.name ?? "";
    const setName = (name: string) => state.save({ name });
    const [names, setNames] = useState<string[]>([]);
    const [error, setError] = useState<unknown>();
    const [busy, setBusy] = useState(false);
    const refresh = async () =>
      setNames(
        (await client.resource("notes").list()).items.map(
          (row) => row.data.name,
        ),
      );
    useEffect(() => {
      void refresh().catch(setError);
    }, [client]);
    return (
      <>
        <PageHeading
          title="Custom notes"
          description="A separately signed module using the host UI kit."
        />
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(undefined);
            void client
              .call("capture", { name })
              .then(async () => {
                state.clear();
                await refresh();
              })
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          <Field label="Note name">
            <Input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Button variant="primary" type="submit" disabled={!online || busy}>
            Save note
          </Button>
          <ErrorMessage error={error} />
        </form>
        <ul aria-label="Saved notes">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </>
    );
  },
);

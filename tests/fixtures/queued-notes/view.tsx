import { useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import { isQueueCaptureError } from "@suite/module-sdk";
import { Button, Input, Field, PageHeading, ErrorMessage } from "@suite/ui-web";
import module from "./module";
export default defineView(module, function Notes({ client, hasPermission }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [parent, setParent] = useState<string>();
  const capture = (dependency?: string) => {
    setBusy(true);
    setError(undefined);
    void client
      .queue(
        "capture",
        { name },
        { dependencies: dependency ? [dependency] : [] },
      )
      .then((receipt) => {
        setSaved(`Saved provisionally: ${receipt.key}`);
        if (!dependency) setParent(receipt.key);
        setName("");
      })
      .catch((error) => {
        setError(error);
        if (isQueueCaptureError(error))
          setSaved(`Check saved identity: ${error.identity.key}`);
      })
      .finally(() => setBusy(false));
  };
  return (
    <>
      <PageHeading
        title="Queued notes"
        description="Capture notes offline and inspect server acceptance separately."
      />
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          capture();
        }}
      >
        <Field label="Note name">
          <Input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !hasPermission("custom-notes.capture")}
        >
          Save pending note
        </Button>
        <Button
          disabled={
            busy || !parent || !name || !hasPermission("custom-notes.capture")
          }
          onClick={() => capture(parent)}
        >
          Save dependent note
        </Button>
        <ErrorMessage error={error} />
        <p role="status">{saved}</p>
      </form>
    </>
  );
});

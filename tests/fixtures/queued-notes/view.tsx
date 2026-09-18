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
          setBusy(true);
          setError(undefined);
          void client
            .queue("capture", { name })
            .then((receipt) => {
              setSaved(`Saved provisionally: ${receipt.key}`);
              setName("");
            })
            .catch((error) => {
              setError(error);
              if (isQueueCaptureError(error))
                setSaved(`Check saved identity: ${error.identity.key}`);
            })
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
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !hasPermission("custom-notes.capture")}
        >
          Save pending note
        </Button>
        <ErrorMessage error={error} />
        <p role="status">{saved}</p>
      </form>
    </>
  );
});

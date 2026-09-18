import { useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import { isQueueCaptureError, type ResourceRecord } from "@suite/module-sdk";
import { Button, Input, Field, PageHeading, ErrorMessage } from "@suite/ui-web";
import module from "./module";
export default defineView(module, function Notes({ client, hasPermission }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [parent, setParent] = useState<string>();
  const [recordId, setRecordId] = useState("");
  const [base, setBase] = useState<ResourceRecord<{ name: string }>>();
  const load = async () => {
    setError(undefined);
    setBusy(true);
    try {
      setBase(await client.resource("notes").get(recordId));
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const captureExisting = async (action: "update" | "archive") => {
    if (!base) return;
    setError(undefined);
    setBusy(true);
    const options = { dependencies: parent ? [parent] : [] };
    try {
      const queue = client.resource("notes").queue;
      const receipt =
        action === "update"
          ? await queue.update(base.id, { name }, base, options)
          : await queue.archive(base.id, base.version, options);
      setSaved(`Saved provisionally: ${receipt.key}`);
      setName("");
      setBase(undefined);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const capture = (dependency?: string) => {
    setBusy(true);
    setError(undefined);
    void client
      .resource("notes")
      .queue.create({ name }, { dependencies: dependency ? [dependency] : [] })
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
        <Field label="Prerequisite identity">
          <Input
            value={parent ?? ""}
            onChange={(event) => setParent(event.target.value)}
          />
        </Field>
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
          disabled={busy || !hasPermission("custom-notes.notes.write")}
        >
          Save pending note
        </Button>
        <Button
          disabled={
            busy ||
            !parent ||
            !name ||
            !hasPermission("custom-notes.notes.write")
          }
          onClick={() => capture(parent)}
        >
          Save dependent note
        </Button>
        <Field label="Accepted record identity">
          <Input
            value={recordId}
            onChange={(event) => setRecordId(event.target.value)}
          />
        </Field>
        <Button disabled={busy || !recordId} onClick={() => void load()}>
          Load accepted record
        </Button>
        {base && (
          <p>
            Loaded server version {base.version}: {base.data.name}
          </p>
        )}
        <Button
          disabled={
            busy || !base || !name || !hasPermission("custom-notes.notes.write")
          }
          onClick={() => void captureExisting("update")}
        >
          Save pending update
        </Button>
        <Button
          disabled={busy || !base || !hasPermission("custom-notes.notes.write")}
          onClick={() => void captureExisting("archive")}
        >
          Save pending archive
        </Button>
        <ErrorMessage error={error} />
        <p role="status">{saved}</p>
      </form>
    </>
  );
});

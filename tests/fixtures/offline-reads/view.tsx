import { useEffect, useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import type { ResourceReadMetadata } from "@suite/module-sdk";
import { Button, Input, Field, PageHeading, ErrorMessage } from "@suite/ui-web";
import module from "./module";

const sourceLabel = (read: ResourceReadMetadata | undefined) =>
  !read
    ? "Source unknown"
    : read.source === "server"
      ? "Server response"
      : read.downloadedAt === null
        ? "Downloaded records, time unknown"
        : `Downloaded ${new Date(read.downloadedAt).toLocaleString()}`;

export default defineView(module, function Notes({ client }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string }[]>([]);
  const [source, setSource] = useState("");
  const [record, setRecord] = useState("");
  const [error, setError] = useState<unknown>();
  const load = async (server = false) => {
    setError(undefined);
    try {
      const page = await client
        .resource("notes")
        .list(
          { search, limit: 10 },
          { source: server ? "server" : "available" },
        );
      setRows(page.items.map((row) => ({ id: row.id, name: row.data.name })));
      setSource(sourceLabel(page.read));
    } catch (cause) {
      setError(cause);
    }
  };
  useEffect(() => {
    void load();
  }, [client]);
  return (
    <>
      <PageHeading
        title="Downloaded notes"
        description="Public SDK resource reads with explicit source information."
      />
      <p role="status" aria-label="List source">
        {source}
      </p>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <Field label="Find downloaded notes">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <div className="actions">
          <Button type="submit">Read notes</Button>
          <Button type="button" onClick={() => void load(true)}>
            Require server response
          </Button>
          <Button
            type="button"
            onClick={() => {
              setError(undefined);
              void client
                .call("capture", { name: "Authoritative write" })
                .catch(setError);
            }}
          >
            Create authoritative note
          </Button>
        </div>
      </form>
      <ErrorMessage error={error} />
      <ul aria-label="Downloaded notes">
        {rows.map((row) => (
          <li key={row.id}>
            <span>{row.name}</span>{" "}
            <Button
              type="button"
              onClick={() => {
                setError(undefined);
                void client
                  .resource("notes")
                  .get(row.id)
                  .then((value) =>
                    setRecord(`${value.data.name}: ${sourceLabel(value.read)}`),
                  )
                  .catch(setError);
              }}
            >
              Read {row.name}
            </Button>
          </li>
        ))}
      </ul>
      <p role="status" aria-label="Record source">
        {record}
      </p>
    </>
  );
});

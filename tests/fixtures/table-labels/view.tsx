import { useEffect, useMemo, useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import {
  TypedResourceTable,
  Button,
  ErrorMessage,
  PageHeading,
} from "@suite/ui-web";
import type { ResourceRecord, Static } from "@suite/module-sdk";
import module from "./module";
const schema = module.resources.records.schema;
export default defineView(module, function ReferenceTable({ client }) {
  const [revision, setRevision] = useState(0);
  const resource = useMemo(
    () => client.resource("records"),
    [client, revision],
  );
  const [rows, setRows] = useState<ResourceRecord<Static<typeof schema>>[]>([]);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    setRows([]);
    setError(undefined);
    void resource
      .list()
      .then((page) => {
        if (!controller.signal.aborted) setRows(page.items);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error);
      });
    return () => controller.abort();
  }, [resource]);
  return (
    <>
      <PageHeading
        title="Reference records"
        description="Structured records with authorized labels."
      />
      <Button onClick={() => setRevision((value) => value + 1)}>
        Refresh records
      </Button>
      <ErrorMessage error={error} />
      <TypedResourceTable
        schema={schema}
        rows={rows}
        label="Reference table"
        loadReferences={resource.loadReferences}
      />
    </>
  );
});

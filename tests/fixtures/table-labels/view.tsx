import { defineView } from "@suite/module-sdk/ui";
import {
  useResourceList,
  TypedResourceTable,
  Button,
  ErrorMessage,
  PageHeading,
} from "@suite/ui-web";
import module from "./module";
const schema = module.resources.records.schema;
export default defineView(module, function ReferenceTable({ client }) {
  const resource = client.resource("records");
  const list = useResourceList(resource);
  return (
    <>
      <PageHeading
        title="Reference records"
        description="Structured records with authorized labels."
      />
      <Button onClick={list.reload}>Refresh records</Button>
      <ErrorMessage error={list.error} />
      {list.status === "loading" && <p role="status">Loading records…</p>}
      {list.status === "success" && (
        <TypedResourceTable
          schema={schema}
          rows={list.page.items}
          label="Reference table"
          loadReferences={resource.loadReferences}
        />
      )}
    </>
  );
});

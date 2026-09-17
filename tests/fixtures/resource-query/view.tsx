import { useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import type { Static, ResourceOrder, ResourceRanges } from "@suite/module-sdk";
import {
  useResourceList,
  TypedResourceTable,
  TypedResourceFilters,
  TypedResourceRanges,
  TypedResourceSort,
  Button,
  Input,
  Field,
  Select,
  SelectOption,
  ErrorMessage,
  PageHeading,
} from "@suite/ui-web";
import module from "./module";
const schema = module.resources.records.schema;
type Data = Static<typeof schema>;
export default defineView(module, function Explorer({ client, online }) {
  const [source, setSource] = useState<"records" | "other">("records");
  const [search, setSearch] = useState("");
  const [where, setWhere] = useState<Partial<Data>>({});
  const [ranges, setRanges] = useState<ResourceRanges<Data>>({});
  const [orderBy, setOrderBy] = useState<ResourceOrder<Data>>([]);
  const [enabled, setEnabled] = useState(true);
  const [note, setNote] = useState("");
  const records = client.resource(source);
  const list = useResourceList(
    records,
    { where, ranges, orderBy, search, limit: 2 },
    { enabled: enabled && online },
  );
  return (
    <>
      <PageHeading
        title="Resource explorer"
        description="Search and order records through the public SDK."
      />
      <div className="module-toolbar">
        <Field label="Source">
          <Select
            value={source}
            onValueChange={(value) => setSource(value as typeof source)}
          >
            <SelectOption value="records">Records</SelectOption>
            <SelectOption value="other">Other records</SelectOption>
          </Select>
        </Field>
        <Field label="Search records">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Button onClick={() => setEnabled(!enabled)}>
          {enabled ? "Pause reading" : "Resume reading"}
        </Button>
        <Button onClick={list.reload} disabled={!enabled || !online}>
          Refresh records
        </Button>
      </div>
      <div className="resource-query-controls">
        <TypedResourceFilters
          schema={schema}
          value={where}
          onChange={setWhere}
        />
        <TypedResourceRanges
          schema={schema}
          value={ranges}
          onChange={setRanges}
        />
        <TypedResourceSort
          schema={schema}
          value={orderBy}
          onChange={setOrderBy}
        />
      </div>
      <p role="status" data-testid="query-state">
        {list.status === "idle"
          ? online
            ? "Reading paused."
            : "Reconnect to read records."
          : list.status === "loading"
            ? "Loading records…"
            : list.status === "error"
              ? "Records could not be loaded."
              : `Page ${list.pageNumber}. ${list.page.items.length} records.`}
      </p>
      <ErrorMessage error={list.error} />
      {list.status === "error" && (
        <Button onClick={list.reload}>Retry records</Button>
      )}
      {list.status === "success" && (
        <TypedResourceTable
          schema={schema}
          rows={list.page.items}
          label="Query records"
          loadReferences={records.loadReferences}
        />
      )}
      <div className="module-toolbar">
        <Button onClick={list.firstPage} disabled={!enabled || !online}>
          First records
        </Button>
        <Button onClick={list.previousPage} disabled={!list.hasPreviousPage}>
          Previous records
        </Button>
        <Button onClick={list.nextPage} disabled={!list.hasNextPage}>
          Next records
        </Button>
      </div>
      <Field label="Unrelated input">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </>
  );
});

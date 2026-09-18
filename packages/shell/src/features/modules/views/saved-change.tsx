import { useMemo, useState } from "react";
import type { TObject, ResourceRecord } from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";
import { canonical } from "@suite/module-sdk/registry";
import {
  referencePointer,
  type ReferenceLoader,
} from "@suite/module-sdk/references";
import {
  Button,
  ResourceValue,
  fieldLabel,
  useResourceValueReferences,
} from "@suite/ui-web";

export function SavedChange({
  entry,
  schema,
  loadReferences,
}: {
  entry: JournalEntry;
  schema: TObject;
  loadReferences?: ReferenceLoader;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="module-saved-change"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>View saved change</summary>
      <p>
        <time dateTime={new Date(entry.createdAt).toISOString()}>
          Saved {new Date(entry.createdAt).toLocaleString()}
        </time>
      </p>
      {open && (
        <SavedValues
          input={entry.call.input as SavedInput}
          update={entry.call.action === "update"}
          schema={schema}
          loadReferences={loadReferences}
        />
      )}
    </details>
  );
}

type SavedInput = {
  data?: Record<string, unknown>;
  baseData?: Record<string, unknown>;
  baseVersion?: number;
};

export function SavedDraft({
  unsubmitted,
  data,
  target,
  original,
  schema,
}: {
  unsubmitted: boolean;
  data: Record<string, unknown>;
  target: ResourceRecord | null;
  original?: { version?: number; data?: Record<string, unknown> };
  schema: TObject;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="module-saved-change"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>View saved draft</summary>
      {open && (
        <SavedValues
          draft={unsubmitted ? "unsubmitted" : "preserved"}
          update={!!target || !!original}
          input={{
            data,
            baseData: original ? original.data : target?.data,
            baseVersion: original ? original.version : target?.version,
          }}
          schema={schema}
        />
      )}
    </details>
  );
}

function SavedValues({
  input,
  draft,
  update,
  schema,
  loadReferences,
}: {
  input: SavedInput;
  draft?: "unsubmitted" | "preserved";
  update?: boolean;
  schema: TObject;
  loadReferences?: ReferenceLoader;
}) {
  const snapshots = useMemo(
    () => [
      ...(input.baseData ? [{ id: "original", data: input.baseData }] : []),
      { id: "saved", data: input.data ?? {} },
    ],
    [input.baseData, input.data],
  );
  const fields = useMemo(
    () =>
      Object.keys({ ...input.baseData, ...input.data }).filter(
        (key) =>
          !input.baseData ||
          Object.hasOwn(input.baseData, key) !==
            Object.hasOwn(input.data ?? {}, key) ||
          canonical(input.baseData[key]) !== canonical(input.data?.[key]),
      ),
    [input.baseData, input.data],
  );
  const references = useResourceValueReferences(
    schema,
    snapshots,
    fields,
    loadReferences,
  );
  return (
    <div className="form-stack">
      <p>
        {draft === "unsubmitted"
          ? "This draft has not been submitted."
          : draft === "preserved"
            ? "This is preserved draft input. Review any prior submission before sending it."
            : "This is the input saved for this request. It is not confirmed server state."}
        {input.baseVersion !== undefined
          ? ` Based on server version ${input.baseVersion}.`
          : ""}
      </p>
      {!input.baseData && update && (
        <p>The original values were not retained.</p>
      )}
      {!fields.length && <p>No field changes from the saved original.</p>}
      {fields.map((key) => (
        <fieldset className="form-stack" key={key}>
          <legend>{schema.properties[key]?.title ?? fieldLabel(key)}</legend>
          <dl className="module-conflict-values module-saved-values">
            {snapshots.map((snapshot) => (
              <div key={snapshot.id}>
                <dt>
                  {snapshot.id === "original" ? "Original" : "Saved change"}
                </dt>
                <dd>
                  <ResourceValue
                    schema={schema.properties[key]}
                    value={snapshot.data[key]}
                    path={referencePointer("", key)}
                    renderReference={(id, path) =>
                      references.renderReference(snapshot.id, id, path)
                    }
                  />
                </dd>
              </div>
            ))}
          </dl>
        </fieldset>
      ))}
      {references.failed && (
        <div className="actions">
          <p role="status">Some reference labels could not be loaded.</p>
          <Button
            variant="ghost"
            disabled={references.loading}
            onClick={references.refresh}
          >
            Retry reference labels
          </Button>
        </div>
      )}
    </div>
  );
}

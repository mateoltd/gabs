import * as React from "react";
import * as ui from "@suite/ui-web";
import { Type, type ModuleDefinition } from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";
import {
  commandContinuation,
  type CommandContinuation,
  type CommandReview,
} from "@suite/client/command-recovery";
import { canonical } from "@suite/module-sdk/registry";

export function CommandCorrection({
  entry,
  originalModule,
  module,
  review,
  dependents,
  online,
  busy,
  save,
  replace,
  close,
}: {
  entry: JournalEntry;
  originalModule: ModuleDefinition;
  module: ModuleDefinition;
  review?: CommandReview;
  dependents: { entry: JournalEntry; module: ModuleDefinition }[];
  online: boolean;
  busy: boolean;
  save(
    input: unknown,
    revision: number,
    selected: CommandContinuation[],
  ): Promise<CommandReview>;
  replace(
    review: CommandReview,
    key: string,
    dependents: CommandContinuation[],
  ): Promise<"accepted" | "replaced">;
  close(): void;
}) {
  const [input, setInput] = React.useState<unknown>(() =>
    structuredClone(review ? review.input : entry.call.input),
  );
  const [revision, setRevision] = React.useState(review?.revision ?? 0);
  const [saved, setSaved] = React.useState<CommandReview | undefined>(review);
  const [error, setError] = React.useState<unknown>();
  const [selected, setSelected] = React.useState<CommandContinuation[]>(
    review?.continuations ?? [],
  );
  const currentSelection = selected.filter((choice) =>
    dependents.some(
      ({ entry }) =>
        entry.id === choice.id &&
        commandContinuation(entry).fingerprint === choice.fingerprint,
    ),
  );
  const [valid, setValid] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const key = React.useRef(crypto.randomUUID());
  const operation = module.operations[entry.call.operation!];
  const editable = entry.state === "rejected" || entry.state === "conflict";
  const schema = React.useMemo(
    () =>
      Type.Object(
        { input: { ...operation.input, title: "Command input" } },
        { additionalProperties: false },
      ),
    [operation],
  );
  const dirty =
    editable &&
    (!saved ||
      saved.moduleVersion !== module.version ||
      canonical(saved.input) !== canonical(input) ||
      canonical(saved.continuations ?? []) !== canonical(currentSelection));
  const persist = async () => {
    const next = await save(input, revision, currentSelection);
    setSaved(next);
    setRevision(next.revision);
    setSelected(next.continuations ?? []);
    return next;
  };
  return (
    <>
      <ui.Modal
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title="Review saved command"
        description="Save this review to keep your input after closing or restarting. Saving a review does not submit a business change."
      >
        <ui.ErrorMessage error={error} />
        {!editable && (
          <p role="status">
            The original command was accepted. Your separate review is preserved
            and has not been submitted.
          </p>
        )}
        <details>
          <summary>Original saved input</summary>
          <ui.ResourceValue
            value={entry.call.input}
            schema={originalModule.operations[entry.call.operation!].input}
          />
        </details>
        {review && (
          <details>
            <summary>Saved review input</summary>
            <p>Saved against release {review.moduleVersion}.</p>
            <ui.ResourceValue value={review.input} />
          </details>
        )}
        {review && review.moduleVersion !== module.version && (
          <p>
            The installed release changed. Review every field before saving
            against the new contract.
          </p>
        )}
        <fieldset disabled={busy || !editable}>
          <legend>{operation.title}</legend>
          <ui.SchemaForm
            schema={schema}
            value={{ input }}
            onChange={(value) => setInput(value.input)}
            validate
            onValidityChange={setValid}
          />
        </fieldset>
        {!!dependents.length && (
          <fieldset disabled={busy || !editable}>
            <legend>Dependent commands</legend>
            <p>
              Select only commands whose existing input should continue after
              this correction. Unselected work keeps waiting on the original
              request.
            </p>
            {dependents.map(({ entry: child, module: original }) => (
              <div key={child.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={currentSelection.some(
                      (choice) => choice.id === child.id,
                    )}
                    onChange={(event) =>
                      setSelected((ids) =>
                        event.target.checked
                          ? [
                              ...ids.filter((choice) => choice.id !== child.id),
                              commandContinuation(child),
                            ]
                          : ids.filter((choice) => choice.id !== child.id),
                      )
                    }
                  />{" "}
                  Continue {original.operations[child.call.operation!].title}
                </label>
                <ui.ResourceValue
                  value={child.call.input}
                  schema={original.operations[child.call.operation!].input}
                />
              </div>
            ))}
          </fieldset>
        )}
        <p role="status">
          {dirty
            ? "Review has unsaved changes."
            : "Review saved on this device."}
        </p>
        <div className="actions">
          <ui.Button
            disabled={busy || !editable || !dirty}
            onClick={() => {
              setError(undefined);
              void persist().catch(setError);
            }}
          >
            Save review
          </ui.Button>
          <ui.Button
            disabled={busy || !online || !editable || !valid}
            onClick={() => setConfirm(true)}
          >
            Prepare corrected command
          </ui.Button>
        </div>
      </ui.Modal>
      <ui.Modal
        open={confirm && editable}
        onOpenChange={setConfirm}
        title="Submit corrected command"
        description="The server will resolve the original request first. If it already committed, its result is recovered and this review stays separate. Otherwise, the original is stopped before a new pending command is saved."
      >
        <ui.ErrorMessage error={error} />
        <p>
          {currentSelection.length} dependent commands selected to continue with
          their existing input.
        </p>
        <ui.Button
          disabled={busy || !online || !valid}
          onClick={() => {
            setError(undefined);
            void (async () => {
              const current = dirty ? await persist() : saved!;
              const outcome = await replace(
                current,
                key.current,
                current.continuations ?? [],
              );
              setConfirm(false);
              if (outcome === "replaced") close();
            })().catch(setError);
          }}
        >
          Resolve original and save correction
        </ui.Button>
      </ui.Modal>
    </>
  );
}

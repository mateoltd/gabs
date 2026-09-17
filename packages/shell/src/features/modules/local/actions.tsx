import { useEffect, useRef, useState } from "react";
import { createModuleClient } from "@suite/module-sdk";
import {
  availableLocalModules,
  type LocalSession,
} from "@suite/client/local-profiles";
import {
  Button,
  ErrorMessage,
  Field,
  Modal,
  SchemaForm,
  Select,
  SelectOption,
  Table,
  type FormSchema,
} from "@suite/ui-web";
import { useShellComposition } from "../../../app/composition";

export function LocalActions({
  session,
  changed,
}: {
  session: LocalSession;
  changed: () => void;
}) {
  const { catalog } = useShellComposition();
  const [open, setOpen] = useState(false),
    [choice, setChoice] = useState(""),
    [input, setInput] = useState<Record<string, unknown>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [result, setResult] = useState("");
  const controller = useRef<AbortController>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  const operations = availableLocalModules(session.data, catalog).flatMap(
    (module) =>
      Object.entries(module.operations)
        .filter(([, op]) => op.policy === "local")
        .map(([id, op]) => ({ module, id, op, key: `${module.id}/${id}` })),
  );
  const selected = operations.find((op) => op.key === choice) ?? operations[0];
  const attempts = Object.entries(session.data.attempts ?? {}).sort(
    ([, a], [, b]) => b.createdAt - a.createdAt,
  );
  if (!operations.length && !attempts.length) return null;
  const run = async (action: (signal: AbortSignal) => Promise<unknown>) => {
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError(undefined);
    setResult("");
    try {
      await action(current.signal);
      setResult("Completed and saved locally.");
      setInput({});
    } catch (error) {
      setError(error);
    } finally {
      controller.current = undefined;
      setBusy(false);
      changed();
    }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Local actions</Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title="Local actions"
        description="Run standalone work on this device. Interrupted requests are preserved for recovery."
      >
        <div className="form-stack">
          {selected && (
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void run((signal) =>
                  createModuleClient(selected.module, (call) =>
                    session.execute(selected.module, call, { signal }),
                  ).call(selected.id, input, crypto.randomUUID()),
                );
              }}
            >
              <Field label="Action">
                <Select
                  value={selected.key}
                  disabled={busy}
                  onValueChange={(value) => {
                    setChoice(value);
                    setInput({});
                    setError(undefined);
                    setResult("");
                  }}
                >
                  {operations.map((item) => (
                    <SelectOption key={item.key} value={item.key}>
                      {item.module.name}: {item.op.title}
                    </SelectOption>
                  ))}
                </Select>
              </Field>
              <fieldset
                disabled={busy}
                className="form-stack local-action-fields"
              >
                <SchemaForm
                  schema={selected.op.input as FormSchema}
                  value={input}
                  onChange={setInput}
                />
              </fieldset>
              <div className="module-toolbar">
                <Button type="submit" variant="primary" disabled={busy}>
                  Run locally
                </Button>
                {busy && (
                  <Button
                    type="button"
                    onClick={() => controller.current?.abort()}
                  >
                    Cancel operation
                  </Button>
                )}
              </div>
            </form>
          )}
          {busy && (
            <p role="status">Running locally. Keep this profile unlocked.</p>
          )}
          {result && <p role="status">{result}</p>}
          <ErrorMessage error={error} />
          {attempts.length > 0 && (
            <div className="table-scroll">
              <Table aria-label="Local requests">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>State</th>
                    <th>Recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map(([id, attempt]) => (
                    <tr key={id}>
                      <td>
                        {attempt.title}
                        <div className="small muted">
                          {new Date(attempt.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td>
                        {attempt.state === "accepted"
                          ? "Accepted"
                          : attempt.state === "pending"
                            ? "Awaiting recovery"
                            : attempt.state === "rejected"
                              ? "Rejected"
                              : "Interrupted"}
                        {attempt.error && (
                          <p className="small">{attempt.error}</p>
                        )}
                      </td>
                      <td>
                        <div className="module-toolbar">
                          {attempt.state !== "accepted" && (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void run((signal) =>
                                  session.retry(id, { signal }),
                                )
                              }
                            >
                              Retry request
                            </Button>
                          )}
                          <Button
                            disabled={busy}
                            onClick={async () => {
                              try {
                                await session.dismiss(id);
                                changed();
                              } catch (e) {
                                setError(e);
                              }
                            }}
                          >
                            Dismiss request
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          {attempts.some(([, a]) => a.state !== "accepted") && (
            <p className="small">
              Retry uses the saved input and request identifier. Dismissing
              removes the recovery request; accepted records remain.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

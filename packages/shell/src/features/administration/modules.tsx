import { type FeatureProps } from "@suite/client";
import {
  Button,
  Empty,
  ErrorMessage,
  Field,
  Modal,
  PageHeading,
  Select,
  SelectOption,
  Status,
  Table,
  Textarea,
} from "@suite/ui-web";
import { ArrowRight } from "@suite/ui-web/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ModuleLifecycle } from "./platform-admin";
export function Modules(props: FeatureProps) {
  const { client, scope, bootstrap, onError } = props;
  const params = { workspaceId: scope.workspaceId },
    qc = useQueryClient(),
    admin = bootstrap.permissions.includes("modules.manage");
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<BootstrapModule | null>(null),
    [reason, setReason] = useState(""),
    [requesting, setRequesting] = useState<string>();
  type BootstrapModule = (typeof bootstrap.modules)[number];
  const requests = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "accessRequests"],
    queryFn: () => client.request({ operation: "accessRequests", params }),
  });
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === scope.userId && q.queryKey[1] === scope.workspaceId,
      });
      setEditing(null);
      setRequesting(undefined);
    } catch (e) {
      setError(e);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Modules"
        description="Configure modules and manage access requests."
      />
      <ModuleLifecycle
        {...props}
        renderAccess={(moduleId) => {
          const m = bootstrap.modules.find((m) => m.moduleId === moduleId);
          if (!m) return null;
          return (
            <div className="module-toolbar">
              {admin ? (
                <Button
                  onClick={() => {
                    setEditing(m);
                    setError(undefined);
                  }}
                >
                  Configure access
                  <ArrowRight size={15} />
                </Button>
              ) : m.assigned ? (
                <span className="small muted">
                  Available with your role’s permissions
                </span>
              ) : m.accessPolicy === "admin" ? (
                <span className="small muted">
                  An administrator assigns access
                </span>
              ) : (
                <Button
                  disabled={
                    m.state !== "enabled" ||
                    !m.entitled ||
                    requests.data?.some(
                      (r) => r.moduleId === m.moduleId && r.state === "pending",
                    )
                  }
                  onClick={() => {
                    setRequesting(m.moduleId);
                    setReason("");
                  }}
                >
                  {requests.data?.some(
                    (r) => r.moduleId === m.moduleId && r.state === "pending",
                  )
                    ? "Pending approval"
                    : m.accessPolicy === "self"
                      ? "Get access"
                      : "Request access"}
                </Button>
              )}
            </div>
          );
        }}
      />
      <ErrorMessage
        error={!editing && !requesting ? (error ?? requests.error) : undefined}
      />
      <h2 className="section-heading">
        {admin ? "Access requests" : "Your requests"}
      </h2>
      {requests.data?.length ? (
        <div className="table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Module</th>
                <th>Reason</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Resolve request</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.memberName}</td>
                  <td>{r.moduleId}</td>
                  <td className="muted">{r.reason || "No reason provided"}</td>
                  <td>
                    <Status status={r.state} />
                  </td>
                  <td>
                    {r.state === "pending" && (
                      <div className="actions">
                        {admin ? (
                          <>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  client.request({
                                    operation: "accessResolve",
                                    params: { ...params, id: r.id },
                                    body: { state: "approved" },
                                  }),
                                )
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  client.request({
                                    operation: "accessResolve",
                                    params: { ...params, id: r.id },
                                    body: { state: "denied" },
                                  }),
                                )
                              }
                            >
                              Deny
                            </Button>
                          </>
                        ) : (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                client.request({
                                  operation: "accessResolve",
                                  params: { ...params, id: r.id },
                                  body: { state: "cancelled" },
                                }),
                              )
                            }
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <Empty
          title="No access requests"
          description="Module requests and their decisions will appear here."
        />
      )}
      <Modal
        open={!!editing}
        onOpenChange={(o) => !busy && !o && setEditing(null)}
        title={`Configure ${editing?.moduleId ?? "module"}`}
        description="Suspension stops new operations and preserves existing business records."
      >
        {editing && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() =>
                client.request({
                  operation: "moduleEdit",
                  params: { ...params, moduleId: editing.moduleId },
                  body: {
                    state: editing.state,
                    accessPolicy: editing.accessPolicy,
                  },
                }),
              );
            }}
          >
            <Field label="Module state">
              <Select
                value={editing.state}
                onValueChange={(e) =>
                  setEditing({
                    ...editing,
                    state: e as typeof editing.state,
                  })
                }
              >
                <SelectOption value="draft">Draft</SelectOption>
                <SelectOption value="enabled">Enabled</SelectOption>
                <SelectOption value="suspended">Suspended</SelectOption>
              </Select>
            </Field>
            <Field label="Access policy">
              <Select
                value={editing.accessPolicy}
                onValueChange={(e) =>
                  setEditing({
                    ...editing,
                    accessPolicy: e as typeof editing.accessPolicy,
                  })
                }
              >
                <SelectOption value="admin">
                  Administrator assignment
                </SelectOption>
                <SelectOption value="approval">Require approval</SelectOption>
                <SelectOption value="self">Self-service access</SelectOption>
              </Select>
            </Field>
            {editing.moduleId === "inventory" && (
              <div className="notice">
                Suspending Inventory also blocks order operations. Reservations
                remain recorded until Inventory is enabled again.
              </div>
            )}
            <ErrorMessage error={error} />
            <div className="form-footer">
              <Button variant="primary" type="submit" disabled={busy}>
                Save configuration
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={!!requesting}
        onOpenChange={(o) => !busy && !o && setRequesting(undefined)}
        title="Request module access"
        description="Your role still determines which actions are available after access is granted."
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              client.request({
                operation: "accessRequest",
                params: { ...params, moduleId: requesting! },
                body: { reason },
                idempotencyKey: crypto.randomUUID(),
              }),
            );
          }}
        >
          <Field label="Reason (optional)">
            <Textarea
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <ErrorMessage error={error} />
          <div className="form-footer">
            <Button variant="primary" type="submit" disabled={busy}>
              Submit request
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

import { type FeatureProps } from "@suite/client";
import {
  Button,
  Empty,
  ErrorMessage,
  Loading,
  PageHeading,
  Status,
} from "@suite/ui-web";
import { Bell } from "@suite/ui-web/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
export function Notifications({ client, scope, onError }: FeatureProps) {
  const params = { workspaceId: scope.workspaceId };
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  async function decide(id: string, state: "approved" | "denied") {
    setBusy(id);
    setError(undefined);
    try {
      await client.request({
        operation: "accessResolve",
        params: { ...params, id },
        body: { state },
        idempotencyKey: crypto.randomUUID(),
      });
      await qc.invalidateQueries({
        queryKey: [scope.userId, scope.workspaceId],
      });
    } catch (error) {
      setError(error);
      onError(error);
    } finally {
      setBusy(undefined);
    }
  }
  const q = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "notifications"],
    queryFn: () => client.request({ operation: "notifications", params }),
    refetchInterval: 30000,
  });
  return (
    <>
      <PageHeading
        title="Notifications"
        description="Invitations, access decisions, and updates that need your attention."
      />
      <ErrorMessage error={error ?? q.error} />
      {q.isPending ? (
        <Loading label="Loading notifications" />
      ) : q.data?.length ? (
        <section className="panel">
          {q.data.map((n) => (
            <div className="list-row" key={n.id}>
              <Bell size={18} />
              <div className="grow">
                <strong>{n.title}</strong>
                <p>{n.message}</p>
                {n.action && (
                  <div>
                    <p>
                      {n.action.moduleId}:{" "}
                      {n.action.reason || "No reason provided"}
                    </p>
                    {n.action.state === "pending" ? (
                      <div className="actions">
                        <Button
                          disabled={!!busy}
                          onClick={() => void decide(n.action!.id, "approved")}
                        >
                          Approve access
                        </Button>
                        <Button
                          disabled={!!busy}
                          onClick={() => void decide(n.action!.id, "denied")}
                        >
                          Deny access
                        </Button>
                      </div>
                    ) : (
                      <Status status={n.action.state} />
                    )}
                  </div>
                )}
                <span className="small muted">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </div>
              {!n.read && (
                <Button
                  onClick={async () => {
                    try {
                      await client.request({
                        operation: "notificationRead",
                        params: { ...params, id: n.id },
                        body: {},
                        idempotencyKey: crypto.randomUUID(),
                      });
                      await q.refetch();
                    } catch (e) {
                      onError(e);
                    }
                  }}
                >
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </section>
      ) : (
        <Empty
          title="No notifications"
          description="New workspace notifications will appear here."
        />
      )}
    </>
  );
}

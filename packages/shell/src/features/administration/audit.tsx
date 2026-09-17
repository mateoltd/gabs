import { type FeatureProps } from "@suite/client";
import {
  Button,
  ContentSkeleton,
  Empty,
  ErrorMessage,
  ListPage,
  ListTable,
  ListToolbar,
  PageHeading,
  Pagination,
  RecordIdentity,
  ResultsMotion,
  Status,
} from "@suite/ui-web";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
export function Audit({ client, scope, moduleCatalog }: FeatureProps) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const q = useQuery({
    placeholderData: keepPreviousData,
    queryKey: [scope.userId, scope.workspaceId, "audit", cursors.at(-1)],
    queryFn: () =>
      client.request({
        operation: "audit",
        params: { workspaceId: scope.workspaceId },
        query: { cursor: cursors.at(-1) },
      }),
  });
  return (
    <ListPage className="audit-page">
      <PageHeading
        title="Audit history"
        description="A record of changes to your workspace, stock, and access."
      />
      <ListToolbar>
        <span className="list-toolbar-note">Workspace activity</span>
        <Button disabled={q.isFetching} onClick={() => void q.refetch()}>
          {q.isFetching ? "Refreshing…" : "Refresh activity"}
        </Button>
      </ListToolbar>
      <ErrorMessage error={q.error} />
      <ResultsMotion
        motionKey={cursors.at(-1) ?? "first"}
        pending={q.isPlaceholderData || q.isLoading}
      >
        {q.isLoading ? (
          <ContentSkeleton label="Loading audit history" />
        ) : !q.data?.items.length ? (
          <Empty
            title={cursors.length > 1 ? "No more activity" : "No activity yet"}
            description={
              cursors.length > 1
                ? "Return to the previous page to review earlier results."
                : "Changes to this workspace will appear here."
            }
            action={
              cursors.length > 1 && (
                <Button onClick={() => setCursors(cursors.slice(0, -1))}>
                  Previous
                </Button>
              )
            }
          />
        ) : (
          <>
            <ListTable className="audit-table" aria-label="Audit events">
              <thead>
                <tr>
                  <th>Actor</th>
                  <th>Activity</th>
                  <th>Target</th>
                  <th>Outcome</th>
                  <th>Date and time</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <RecordIdentity
                        symbol={(a.actorName || "System")
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase()}
                        primary={a.actorName || "System"}
                      />
                    </td>
                    <td>
                      <RecordIdentity
                        primary={a.action
                          .split(/[._-]/)
                          .map((part, index) =>
                            index === 0
                              ? part.charAt(0).toUpperCase() + part.slice(1)
                              : part,
                          )
                          .join(" ")}
                        secondary={<span className="mono">{a.action}</span>}
                      />
                    </td>
                    <td>
                      <span className="mono audit-target">
                        {moduleCatalog.definition(a.targetId)?.name ??
                          a.targetId}
                      </span>
                    </td>
                    <td>
                      <Status
                        status={a.outcome}
                        label={
                          a.outcome === "success" ? "Succeeded" : undefined
                        }
                      />
                    </td>
                    <td>
                      <time dateTime={a.createdAt}>
                        <span>
                          {new Date(a.createdAt).toLocaleDateString("en", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        <span className="record-secondary">
                          {new Date(a.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ListTable>
            <div className="list-footer">
              <span>{q.data.items.length} events on this page</span>
              <Pagination
                pending={q.isPlaceholderData || q.isFetching}
                next={q.data.nextCursor}
                hasPrevious={cursors.length > 1}
                onNext={() =>
                  setCursors([...cursors, q.data?.nextCursor ?? undefined])
                }
                onPrevious={() => setCursors(cursors.slice(0, -1))}
              />
            </div>
          </>
        )}
      </ResultsMotion>
    </ListPage>
  );
}

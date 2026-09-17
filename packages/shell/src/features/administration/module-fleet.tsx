import "./module-fleet.css";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeatureProps } from "@suite/client";
import type { ModuleFleet } from "@suite/module-sdk/platform";
import {
  Badge,
  Button,
  Empty,
  ErrorMessage,
  Loading,
  Modal,
  Table,
} from "@suite/ui-web";

function observation(item: ModuleFleet["items"][number]) {
  if (!item.phase) return "No device report";
  if (item.phase === "removed")
    return item.receiptMatches && item.state === "removed"
      ? "Removal reported"
      : "Earlier device report";
  if (item.phase === "ready")
    return item.receiptMatches && item.state === "installed"
      ? "Ready reported"
      : "Earlier device report";
  if (item.confirmedAt && item.reportedAt && item.confirmedAt > item.reportedAt)
    return "Earlier device report";
  if (item.phase === "failed")
    return item.reportAction === "uninstall"
      ? "Removal failed"
      : "Installation failed";
  if (item.phase === "planning") return "Checking compatibility";
  if (item.reportAction === "uninstall") return "Removal awaiting confirmation";
  return item.phase === "downloading" ? "Downloading" : "Awaiting confirmation";
}
const errorLabels: Record<string, string> = {
  download: "Download could not finish. Retry on this device.",
  verification: "Package verification failed. Repair on this device.",
  policy:
    "Compatibility or access checks failed. Review access and update policy.",
  storage:
    "Local storage could not finish. Check storage and retry on this device.",
  connection: "Connection was interrupted. Reconnect this device to resume.",
  unknown:
    "The attempt could not finish. Review Modules on this device and retry.",
};
export function ModuleFleetDialog(
  props: FeatureProps & { moduleId: string; name: string; close: () => void },
) {
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: [
      props.scope.userId,
      props.scope.workspaceId,
      "module-fleet",
      props.moduleId,
      offset,
    ],
    queryFn: () =>
      props.client.request({
        operation: "moduleFleet",
        params: {
          workspaceId: props.scope.workspaceId,
          moduleId: props.moduleId,
        },
        query: { offset },
      }),
    enabled:
      props.online && props.bootstrap.permissions.includes("modules.manage"),
    refetchInterval: 30000,
  });
  const fleet = query.data;
  return (
    <Modal
      wide
      className="module-fleet-dialog"
      open
      onOpenChange={(open) => {
        if (!open) props.close();
      }}
      title={`Devices using ${props.name}`}
      description="Review accepted installations and the last progress reported by each device."
    >
      <div className="form-stack module-fleet-content">
        <ErrorMessage error={query.error} />
        {!props.online && (
          <p role="status">Reconnect to refresh device reports.</p>
        )}
        <Button
          className="module-fleet-refresh"
          disabled={!props.online || query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh devices
        </Button>
        {query.isPending && <Loading />}
        {fleet && (
          <>
            <p>
              Target version {fleet.targetVersion}. Accepted releases:{" "}
              {fleet.acceptedVersions.join(", ")}.
            </p>
            <p role="status">
              {fleet.accepted} of {fleet.total} known devices have a
              server-accepted release. {fleet.failed} reported a failed module
              change.
            </p>
            <p className="small">
              Reports do not confirm current connectivity or override
              permissions and module suspension. Disconnected devices may retain
              corporate access until their existing offline lease expires.
              Installation failures do not remove business data or pending work.
            </p>
            {!fleet.items.length ? (
              <Empty
                title="No devices reported"
                description="Devices appear after an installation attempt or a server-confirmed installation."
              />
            ) : (
              <div className="table-wrap">
                <Table aria-label="Module devices">
                  <thead>
                    <tr>
                      <th>Person and device</th>
                      <th>Server installation</th>
                      <th>Last device report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fleet.items.map((item) => (
                      <tr key={`${item.userId}:${item.deviceId}`}>
                        <td>
                          <strong>{item.userName}</strong>
                          <div
                            className="small"
                            style={{ overflowWrap: "anywhere" }}
                          >
                            {item.deviceId}
                          </div>
                        </td>
                        <td>
                          <span
                            className="module-fleet-label"
                            aria-hidden="true"
                          >
                            Server installation
                          </span>
                          {item.state === "removed" ? (
                            "Removed"
                          ) : item.version ? (
                            <>
                              <div>Version {item.version}</div>
                              <Badge>
                                {fleet.acceptedVersions.includes(item.version)
                                  ? "Accepted release"
                                  : "Update required"}
                              </Badge>
                            </>
                          ) : (
                            <span>Not confirmed</span>
                          )}
                          {item.confirmedAt && (
                            <div className="small">
                              {new Date(item.confirmedAt).toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td>
                          <span
                            className="module-fleet-label"
                            aria-hidden="true"
                          >
                            Last device report
                          </span>
                          <Badge>{observation(item)}</Badge>
                          {item.reportVersion && (
                            <div className="small">
                              Version {item.reportVersion}
                            </div>
                          )}
                          {item.phase === "failed" &&
                            ["Installation failed", "Removal failed"].includes(
                              observation(item),
                            ) && (
                              <p className="small">
                                {errorLabels[item.errorCode ?? "unknown"] ??
                                  errorLabels.unknown}
                              </p>
                            )}
                          {item.reportedAt && (
                            <div className="small">
                              {new Date(item.reportedAt).toLocaleString()}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            <div className="actions">
              <Button
                disabled={offset === 0 || query.isFetching}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous devices
              </Button>
              <Button
                disabled={fleet.nextOffset === null || query.isFetching}
                onClick={() => setOffset(fleet.nextOffset!)}
              >
                Next devices
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

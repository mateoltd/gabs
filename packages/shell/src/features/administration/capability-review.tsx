import "./capability-review.css";
import type { FeatureProps } from "@suite/client";
import type { ModuleDefinition } from "@suite/module-sdk";
import type { HostCapabilityKind } from "@suite/module-sdk/host-capabilities";
import {
  Button,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  Modal,
  Select,
  SelectOption,
} from "@suite/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { PermissionDecision } from "./permission-decision";
const labels: Record<HostCapabilityKind, string> = {
  "files.export": "Save files",
  "notifications.show": "Show notifications",
  "lan.status": "Discover local peers",
  "lan.relay": "Relay to local peers",
};
export function CapabilityReviewDialog(
  props: FeatureProps & {
    module: ModuleDefinition;
    versions: string[];
    onClose(): void;
  },
) {
  const [version, setVersion] = useState(props.module.version);
  const [roleId, setRoleId] = useState("");
  const review = useQuery({
    queryKey: [
      props.scope.userId,
      props.scope.workspaceId,
      "capability-review",
      props.module.id,
      version,
      props.bootstrap.policyRevision,
    ],
    queryFn: ({ signal }) =>
      props.client.request(
        {
          operation: "moduleCapabilityReview",
          params: {
            workspaceId: props.scope.workspaceId,
            moduleId: props.module.id,
          },
          query: { version },
        },
        { signal },
      ),
    enabled: props.online,
    retry: false,
    staleTime: 0,
  });
  const data = review.data;
  const role = data?.roles.find((r) => r.id === roleId) ?? data?.roles[0];
  return (
    <Modal
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={`${props.module.name} device access`}
      description="Review a signed release and its saved permission policy."
    >
      <div className="form-stack capability-review-content">
        <Field label="Review release">
          <Select value={version} onValueChange={setVersion}>
            {[...new Set([props.module.version, ...props.versions])].map(
              (value) => (
                <SelectOption key={value} value={value}>
                  {value}
                  {value === props.module.version ? " (workspace release)" : ""}
                </SelectOption>
              ),
            )}
          </Select>
        </Field>
        {!props.online ? (
          <p role="status">Connect to review current corporate access.</p>
        ) : (
          <>
            <div className="actions">
              <Button
                disabled={review.isFetching}
                onClick={() => void review.refetch()}
              >
                Refresh review
              </Button>
              {!review.error && data?.canReviewRoles && (
                <Link
                  to={`/organization?module=${props.module.id}`}
                  onClick={props.onClose}
                >
                  Manage permissions
                </Link>
              )}
            </div>
            <ErrorMessage error={review.error} />
            {review.isFetching ? (
              <Loading />
            ) : (
              !review.error &&
              data && (
                <>
                  <p className="small">
                    Verified release {data.version}. Checked at{" "}
                    {new Date(data.reviewedAt).toLocaleTimeString()}.
                  </p>
                  {data.capabilities.length === 0 ? (
                    <Empty
                      title="No device capabilities declared"
                      description="This release does not request module-owned file, notification or local-network actions."
                    />
                  ) : (
                    <>
                      {data.canReviewRoles ? (
                        <Field label="Review role">
                          <Select
                            value={role?.id ?? ""}
                            onValueChange={setRoleId}
                          >
                            {data.roles.map((item) => (
                              <SelectOption key={item.id} value={item.id}>
                                {item.name}
                                {item.protected ? " (protected)" : ""}
                              </SelectOption>
                            ))}
                          </Select>
                        </Field>
                      ) : (
                        <p>Role details require permission to manage roles.</p>
                      )}
                      {data.capabilities.map((capability) => (
                        <section
                          className="form-stack capability-review-entry"
                          aria-label={`Capability ${capability.name}`}
                          key={capability.name}
                        >
                          <h3>{labels[capability.kind]}</h3>
                          <p>
                            {capability.name}:{" "}
                            <code>{capability.permission}</code>
                          </p>
                          {role && (
                            <PermissionDecision
                              decision={role.decisions[capability.permission]}
                            />
                          )}
                          <p className="small">
                            {!capability.offline
                              ? "Online authorization required."
                              : data.offlineHours === 0
                                ? "Offline access is disabled for this workspace."
                                : `May use a server-issued lease for up to ${data.offlineHours} hours. Disconnected revocations take effect by lease expiry.`}
                          </p>
                        </section>
                      ))}
                      <p className="small">
                        Role permissions are only one access check. Current
                        membership, module assignment, entitlement, module
                        availability and device permission still apply when an
                        action runs.
                      </p>
                    </>
                  )}
                </>
              )
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

import { useState, type RefObject } from "react";
import type { FeatureProps } from "@suite/client";
import { ApiError } from "@suite/client/api";
import type { RoleDetails, RoleRemove } from "@suite/contracts";
import { Button, ErrorMessage, Modal } from "@suite/ui-web";

/** An accepted removal and a failed refresh are distinct from an uncertain mutation. */
export function RoleRemoval({
  props,
  role: initial,
  organizationVersion,
  returnFocusRef,
  onClose,
  onRemoved,
}: {
  props: FeatureProps;
  role: RoleDetails;
  organizationVersion: number;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  onRemoved(): Promise<void>;
}) {
  const [review, setReview] = useState({ role: initial, organizationVersion });
  const [attempt, setAttempt] = useState<{ body: RoleRemove; key: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [accepted, setAccepted] = useState(false);
  const [missing, setMissing] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  async function refresh() {
    setBusy(true);
    setError(undefined);
    try {
      await onRemoved();
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    const request = attempt ?? {
      body: {
        revision: review.role.revision,
        organizationVersion: review.organizationVersion,
      },
      key: crypto.randomUUID(),
    };
    setAttempt(request);
    setBusy(true);
    setError(undefined);
    try {
      await props.client.request({
        operation: "roleRemove",
        params: { workspaceId: props.scope.workspaceId, id: review.role.id },
        body: request.body,
        idempotencyKey: request.key,
      });
      setAccepted(true);
    } catch (cause) {
      setNeedsReview(
        cause instanceof ApiError && cause.status < 500 && cause.status !== 408,
      );
      setError(
        cause instanceof ApiError
          ? cause
          : new Error(
              "The removal could not be confirmed. Retry removal to check its saved result.",
            ),
      );
      setBusy(false);
      return;
    }
    await refresh();
  }
  async function reload() {
    setBusy(true);
    setError(undefined);
    try {
      const current = await props.client.request({
        operation: "platformState",
        params: { workspaceId: props.scope.workspaceId },
      });
      const role = current.roles.find((item) => item.id === initial.id);
      if (!role) setMissing(true);
      else
        setReview({
          role,
          organizationVersion: current.organization?.version ?? 0,
        });
      setAttempt(undefined);
      setNeedsReview(false);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      returnFocusRef={returnFocusRef}
      title={`Remove role: ${review.role.name}`}
      description="Review this change before removing the role from your organization."
    >
      <div className="form-stack">
        {accepted ? (
          <p role="status">
            The role was removed. Refresh the organization to see the current
            chart.
          </p>
        ) : missing ? (
          <p role="status">
            This role is no longer available. Refresh the organization to see
            the current chart.
          </p>
        ) : (
          <>
            <p>
              This removes the role from the chart, groups and tags. Invitation
              history and audit records are preserved.
            </p>
            <p>
              First reassign its members and reporting relationships, and revoke
              pending invitations. Assigned roles cannot be removed.
            </p>
          </>
        )}
        <ErrorMessage error={error} />
        {!props.online && (
          <p role="status">Reconnect to review or remove this role.</p>
        )}
        <div className="form-footer">
          <Button disabled={busy} onClick={onClose}>
            {accepted || missing ? "Close" : "Cancel"}
          </Button>
          {accepted || missing ? (
            <Button
              disabled={busy || !props.online}
              onClick={() => void refresh()}
            >
              Refresh organization
            </Button>
          ) : needsReview ? (
            <Button
              disabled={busy || !props.online}
              onClick={() => void reload()}
            >
              Reload removal review
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={busy || !props.online || review.role.protected}
              onClick={() => void remove()}
            >
              {attempt ? "Retry removal" : "Remove role"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

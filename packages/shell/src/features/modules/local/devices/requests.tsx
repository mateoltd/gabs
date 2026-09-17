import { useEffect, useRef, useState } from "react";
import {
  availableLocalModules,
  type LocalSession,
  type LocalDeviceRequest,
} from "@suite/client/local-profiles";
import { executeLocalDevice } from "@suite/client/local-devices";
import { Button, Checkbox, Empty, ErrorMessage, Modal } from "@suite/ui-web";
import { useShellComposition } from "../../../../app/composition";

function outcome(request: LocalDeviceRequest) {
  if (request.state !== "completed")
    return {
      pending: "Ready to run",
      running: "Processing",
      rejected: "Rejected",
      uncertain: "Outcome needs review",
    }[request.state];
  const result = request.result;
  if (result && typeof result === "object") {
    if ("status" in result) {
      if (result.status === "saved") return "File saved";
      if (result.status === "offered") return "Download offered";
      if (result.status === "cancelled") return "Cancelled";
    }
    if ("requested" in result)
      return result.requested
        ? "Notification requested"
        : "Notifications unavailable";
    if ("enabled" in result)
      return result.enabled
        ? "Local network enabled"
        : "Local network disabled";
    if ("relayed" in result) return "Relayed for server validation";
  }
  return "Completed";
}
export function LocalDeviceRequests({
  session,
  changed,
}: {
  session: LocalSession;
  changed(): void;
}) {
  const { catalog } = useShellComposition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<unknown>();
  const [review, setReview] = useState<string>();
  const [checked, setChecked] = useState(false);
  const controller = useRef<AbortController>(undefined);
  const panel = useRef<HTMLDivElement>(null);
  const returnToReview = useRef<string>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (review) {
      returnToReview.current = review;
      panel.current?.querySelector<HTMLElement>('[role="checkbox"]')?.focus();
    } else if (!busy && returnToReview.current) {
      panel.current
        ?.querySelector<HTMLElement>(
          `[data-device-review="${returnToReview.current}"]`,
        )
        ?.focus();
      returnToReview.current = undefined;
    }
  }, [review, busy]);
  const data = session.data;
  const modules = availableLocalModules(data, catalog);
  const requests = Object.values(data.deviceRequests ?? {}).sort(
    (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );
  const pending = requests.filter((r) => r.state === "pending").length;
  async function run(id: string, retry = false, confirmUncertain = false) {
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError(undefined);
    setReview(undefined);
    try {
      const target = retry
        ? await session.retryDeviceRequest(id, { confirmUncertain })
        : id;
      changed();
      await session.processDeviceRequest(
        target,
        async (guard, signal) => {
          changed();
          return executeLocalDevice(guard, signal);
        },
        { signal: active.signal },
      );
    } catch (error) {
      setError(error);
    } finally {
      if (controller.current === active) controller.current = undefined;
      setBusy(false);
      changed();
    }
  }
  return (
    <>
      <Button
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        Device requests{pending ? ` (${pending})` : ""}
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!value) controller.current?.abort();
          setOpen(value);
        }}
        title="Device requests"
        description="Business changes are already saved. Device actions run separately; clearing or retrying these requests preserves your records."
      >
        <div className="form-stack" ref={panel}>
          <ErrorMessage error={error} />
          {clearing && <p role="status">Clearing the device request…</p>}
          {!busy && requests.some((request) => request.state === "running") && (
            <p role="status">
              Lock and unlock this profile to recover interrupted device
              requests. Your business records remain saved.
            </p>
          )}
          {busy && (
            <div className="form-stack">
              <p role="status">
                Processing the device request. Keep this profile unlocked.
              </p>
              <Button onClick={() => controller.current?.abort()}>
                Cancel device request
              </Button>
            </div>
          )}
          {review ? (
            <section
              className="form-stack"
              aria-label="Review uncertain device request"
            >
              <h3>Check the previous outcome</h3>
              <p>
                The device action may already have happened. Check the saved
                file, notification or destination before requesting it again.
              </p>
              <label className="local-reference-choice">
                <Checkbox checked={checked} onCheckedChange={setChecked} />
                <span>
                  I checked the outcome and want to run this device action
                  again.
                </span>
              </label>
              <Button
                variant="primary"
                disabled={!checked || busy || clearing}
                onClick={() => void run(review, true, true)}
              >
                Retry device action
              </Button>
              <Button onClick={() => setReview(undefined)}>
                Back to requests
              </Button>
            </section>
          ) : requests.length ? (
            <ul
              className="local-installations"
              aria-label="Saved device requests"
            >
              {requests.map((request) => {
                const retried = requests.some(
                  (item) => item.retryOf === request.id,
                );
                const module = modules.find(
                  (m) =>
                    m.id === request.call.moduleId &&
                    m.version === request.call.moduleVersion,
                );
                const kind =
                  module?.capabilities?.[request.call.capability]?.kind;
                const title = kind
                  ? {
                      "files.export": "Export file",
                      "notifications.show": "Show notification",
                      "lan.status": "Inspect local network",
                      "lan.relay": "Relay to local network",
                    }[kind]
                  : request.call.capability;
                return (
                  <li
                    key={request.id}
                    aria-label={`${title}: ${module?.name ?? request.call.moduleId}`}
                  >
                    <h3>{title}</h3>
                    <p className="small muted">
                      {module?.name ?? request.call.moduleId}, version{" "}
                      {request.call.moduleVersion}
                    </p>
                    <p className="small muted">
                      {new Date(request.createdAt).toLocaleString()}
                    </p>
                    {!!request.call.input &&
                      typeof request.call.input === "object" &&
                      "filename" in request.call.input &&
                      typeof request.call.input.filename === "string" && (
                        <p>{request.call.input.filename}</p>
                      )}
                    <p role="status">
                      {retried
                        ? "Retry created"
                        : request.state === "running" && !busy
                          ? "Awaiting recovery"
                          : outcome(request)}
                    </p>
                    {request.error && (
                      <p className="small">
                        {retried ? "Previous attempt: " : ""}
                        {request.error}
                      </p>
                    )}
                    <div className="module-toolbar">
                      {request.state === "pending" && (
                        <Button
                          variant="primary"
                          disabled={busy || clearing}
                          onClick={() => void run(request.id)}
                        >
                          Run device request
                        </Button>
                      )}
                      {request.state === "rejected" && !retried && (
                        <Button
                          disabled={busy || clearing}
                          onClick={() => void run(request.id, true)}
                        >
                          Retry device request
                        </Button>
                      )}
                      {request.state === "uncertain" && !retried && (
                        <Button
                          data-device-review={request.id}
                          disabled={busy || clearing}
                          onClick={() => {
                            setReview(request.id);
                            setChecked(false);
                          }}
                        >
                          Review before retry
                        </Button>
                      )}
                      <Button
                        disabled={
                          busy || clearing || request.state === "running"
                        }
                        onClick={async () => {
                          setClearing(true);
                          setError(undefined);
                          try {
                            await session.dismissDeviceRequest(request.id);
                            changed();
                          } catch (error) {
                            setError(error);
                          } finally {
                            setClearing(false);
                          }
                        }}
                      >
                        Clear request
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty
              title="No device requests"
              description="Device actions requested by local modules appear here after their business changes are saved."
            />
          )}
        </div>
      </Modal>
    </>
  );
}

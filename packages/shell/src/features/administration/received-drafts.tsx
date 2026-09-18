import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeatureProps, LanReceipt } from "@suite/client";
import { Button, Table, ErrorMessage, Modal, fieldLabel } from "@suite/ui-web";

export function ReceivedDrafts(props: FeatureProps) {
  const native = window.suiteDesktop;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const receipts = useQuery({
    queryKey: [props.scope.userId, props.scope.workspaceId, "lan-receipts"],
    enabled:
      !!native &&
      props.online &&
      props.bootstrap.permissions.includes("modules.manage"),
    queryFn: () => native!.lanReceipts(props.scope),
    refetchInterval: open ? 5000 : 15000,
  });
  const title = (row: LanReceipt) =>
    row.moduleId
      ? `${props.moduleCatalog.definition(row.moduleId)?.name ?? fieldLabel(row.moduleId)}: ${fieldLabel(row.target ?? "draft")}`
      : "Unavailable draft";
  const preview = (row: LanReceipt) => {
    const input = row.input;
    if (input && typeof input === "object") {
      const data = "data" in input ? input.data : input;
      if (data && typeof data === "object") {
        const text = Object.entries(data).find(
          ([key, value]) => key !== "id" && typeof value === "string",
        )?.[1];
        if (typeof text === "string")
          return text.length > 80 ? `${text.slice(0, 80)}…` : text;
      }
    }
    return typeof input === "string"
      ? input.slice(0, 80)
      : `Draft ${row.id.slice(0, 8)}`;
  };
  const receipt = receipts.data?.find((row) => row.id === selected);
  async function act(row: LanReceipt, action: "submit" | "dismiss") {
    setBusy(true);
    setError(undefined);
    try {
      if (action === "submit")
        await native!.submitLanReceipt(props.scope, row.id, row.digest);
      else await native!.dismissLanReceipt(props.scope, row.id, row.digest);
      await receipts.refetch();
      if (action === "dismiss") setSelected(undefined);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  if (!native) return null;
  const input =
    receipt?.input && typeof receipt.input === "object"
      ? (receipt.input as Record<string, unknown>)
      : undefined;
  const data =
    input?.data && typeof input.data === "object"
      ? (input.data as Record<string, unknown>)
      : (input ??
        (receipt?.input !== undefined ? { value: receipt.input } : undefined));
  return (
    <>
      <Button
        disabled={!props.online}
        onClick={() => {
          setOpen(true);
          setError(undefined);
        }}
      >
        Received drafts
        {receipts.data?.length ? ` (${receipts.data.length})` : ""}
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title="Received drafts"
        description="Review drafts received from managed devices. Only the server can accept business changes."
      >
        <div className="form-stack">
          <ErrorMessage error={error ?? receipts.error} />
          {!receipt &&
            (receipts.isPending ? (
              <p>Loading received drafts…</p>
            ) : receipts.data?.length ? (
              <div className="table-scroll">
                <Table className="module-table">
                  <caption className="sr-only">Draft receipts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Draft</th>
                      <th scope="col">State</th>
                      <th scope="col">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.data.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <span>{preview(row)}</span>
                          <p className="small">{title(row)}</p>
                        </td>
                        <td>{fieldLabel(row.state)}</td>
                        <td>
                          <Button
                            disabled={busy}
                            aria-label={`Review ${title(row)}: ${preview(row)}`}
                            onClick={() => {
                              setSelected(row.id);
                              setError(undefined);
                            }}
                          >
                            Review
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <p>No drafts have been received.</p>
            ))}
          {receipt && (
            <section className="form-stack" aria-label="Received draft review">
              <Button
                disabled={busy}
                onClick={() => {
                  setSelected(undefined);
                  setError(undefined);
                }}
              >
                Back to received drafts
              </Button>
              <h3>{preview(receipt)}</h3>
              <p className="small">{title(receipt)}</p>
              <p role="status">{receipt.message}</p>
              {receipt.action && (
                <p>
                  {fieldLabel(receipt.action)} change.{" "}
                  {receipt.dependencies
                    ? `${receipt.dependencies} prerequisite changes must be accepted first.`
                    : "No prerequisite changes."}
                </p>
              )}
              {data && (
                <dl className="form-stack">
                  {Object.entries(data).map(([key, value]) => (
                    <div key={key}>
                      <dt>{fieldLabel(key)}</dt>
                      <dd
                        style={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {typeof value === "string"
                          ? value
                          : JSON.stringify(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {input?.baseVersion !== undefined && (
                <p>Based on record version {String(input.baseVersion)}.</p>
              )}
              {receipt.state === "accepted" ? (
                <Button
                  disabled={busy || !props.online}
                  onClick={() => void act(receipt, "dismiss")}
                >
                  Dismiss accepted receipt
                </Button>
              ) : (
                receipt.state !== "invalid" && (
                  <Button
                    disabled={busy || !props.online}
                    onClick={() => void act(receipt, "submit")}
                  >
                    {busy
                      ? "Submitting…"
                      : receipt.state === "received"
                        ? "Submit to server"
                        : "Retry submission"}
                  </Button>
                )
              )}
            </section>
          )}
        </div>
      </Modal>
    </>
  );
}

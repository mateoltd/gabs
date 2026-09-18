import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeatureProps, LanReceipt } from "@suite/client";
import { Button, Table, ErrorMessage, Modal, fieldLabel } from "@suite/ui-web";

export function ReceivedDrafts(props: FeatureProps) {
  const native = window.suiteDesktop;
  const queries = useQueryClient();
  const authority = JSON.stringify([
    props.bootstrap.policyRevision,
    props.bootstrap.permissions,
    props.bootstrap.modules,
    props.offlineEnabled,
  ]);
  const receiptKey = [
    props.scope.userId,
    props.scope.workspaceId,
    "lan-receipts",
    authority,
  ];
  const archiveKey = [
    props.scope.userId,
    props.scope.workspaceId,
    "lan-archive",
    authority,
  ];
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [location, setLocation] = useState<"inbox" | "archive">("inbox");
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    setOpen(false);
    setSelected(undefined);
    setDeleting(false);
    setNotice(undefined);
  }, [props.scope.userId, props.scope.workspaceId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const receipts = useQuery({
    queryKey: receiptKey,
    enabled: !!native,
    queryFn: async ({ signal }) => {
      const value = await native!.lanReceipts(props.scope);
      signal.throwIfAborted();
      return value;
    },
    networkMode: "always",
    retry: false,
    gcTime: 0,
    refetchInterval: open ? 5000 : 15000,
  });
  const archive = useQuery({
    queryKey: archiveKey,
    enabled: !!native,
    queryFn: async ({ signal }) => {
      const value = await native!.lanArchive(props.scope);
      signal.throwIfAborted();
      return value;
    },
    networkMode: "always",
    retry: false,
    gcTime: 0,
    refetchInterval: open ? 5000 : 15000,
  });
  const inboxData = receipts.isError ? undefined : receipts.data;
  const archiveData = archive.isError ? undefined : archive.data;
  const rows = location === "inbox" ? inboxData : archiveData?.receipts;
  const loading = location === "inbox" ? receipts.isPending : archive.isPending;
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
  const identity = (row: LanReceipt) => JSON.stringify([row.id, row.digest]);
  const receipt = rows?.find((row) => identity(row) === selected);
  async function failedAction(error: unknown) {
    setError(error);
    setNotice(undefined);
    setSelected(undefined);
    setDeleting(false);
    await Promise.all([
      queries.resetQueries({ queryKey: receiptKey, exact: true }),
      queries.resetQueries({ queryKey: archiveKey, exact: true }),
    ]);
  }
  async function act(
    row: LanReceipt,
    action: "submit" | "dismiss" | "archive" | "restore" | "delete" | "export",
  ) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const selection = { id: row.id, digest: row.digest, location };
    try {
      if (action === "submit")
        await native!.submitLanReceipt(props.scope, row.id, row.digest);
      else if (action === "dismiss")
        await native!.dismissLanReceipt(props.scope, row.id, row.digest);
      else if (action === "archive") {
        await native!.archiveLanReceipt(props.scope, selection);
        setNotice(
          "Draft archived. Its original contents and retry identity are retained.",
        );
      } else if (action === "restore") {
        await native!.restoreLanReceipt(props.scope, selection);
        setNotice(
          "Draft restored to the inbox. It has not been submitted again.",
        );
      } else if (action === "delete") {
        await native!.deleteLanReceipt(props.scope, selection, true);
        setNotice(
          "Archived copy deleted. Server effects and saved retry outcomes are unchanged.",
        );
      } else {
        const result = await native!.exportLanReceipt(props.scope, selection);
        setNotice(
          result.status === "saved"
            ? "Recovery file saved. It contains draft data; store it securely."
            : "Export cancelled. The draft is unchanged.",
        );
      }
      await Promise.all([receipts.refetch(), archive.refetch()]);
      if (!["submit", "export"].includes(action)) {
        setSelected(undefined);
        setDeleting(false);
      }
    } catch (error) {
      await failedAction(error);
    } finally {
      setBusy(false);
    }
  }
  async function importFile() {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await native!.importLanReceipt(props.scope);
      setNotice(
        result.status === "restored"
          ? "Draft restored to the inbox. Review it before submitting; the file does not confirm server acceptance."
          : "Import cancelled.",
      );
      await Promise.all([receipts.refetch(), archive.refetch()]);
      if (result.status === "restored") {
        setLocation("inbox");
        setSelected(undefined);
        setDeleting(false);
      }
    } catch (error) {
      await failedAction(error);
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
        onClick={() => {
          setOpen(true);
          setError(undefined);
        }}
      >
        Received drafts
        {inboxData?.length ? ` (${inboxData.length})` : ""}
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title="Received drafts"
        description="Review drafts received from managed devices. Only the server can accept business changes."
      >
        <div className="form-stack" aria-busy={busy}>
          <ErrorMessage error={error ?? receipts.error ?? archive.error} />
          {notice && <p role="status">{notice}</p>}
          {!receipt && (
            <>
              <div className="module-toolbar" aria-label="Draft storage">
                <Button
                  disabled={busy}
                  aria-pressed={location === "inbox"}
                  onClick={() => {
                    setLocation("inbox");
                    setDeleting(false);
                    setError(undefined);
                  }}
                >
                  Inbox ({archiveData?.inboxCount ?? inboxData?.length ?? 0}
                  {archiveData ? ` / ${archiveData.inboxLimit}` : ""})
                </Button>
                <Button
                  disabled={busy}
                  aria-pressed={location === "archive"}
                  onClick={() => {
                    setLocation("archive");
                    setDeleting(false);
                    setError(undefined);
                  }}
                >
                  Archived drafts ({archiveData?.receipts.length ?? 0})
                </Button>
                <Button disabled={busy} onClick={() => void importFile()}>
                  Import recovery file
                </Button>
              </div>
              {archiveData && (
                <p className="small">
                  {location === "inbox"
                    ? "Counts show drafts available with your current access. The inbox limit is shared. Archive reviewed drafts to make room; pending work is never automatically removed."
                    : `${archiveData.receipts.length} visible archived copies using ${(archiveData.usedBytes / 1048576).toFixed(1)} MiB. The shared device limit is ${archiveData.countLimit} copies and ${archiveData.byteLimit / 1048576} MiB. Copies remain until you restore or explicitly delete them.`}
                </p>
              )}
            </>
          )}
          {!receipt &&
            (loading ? (
              <p>Loading received drafts…</p>
            ) : rows?.length ? (
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
                    {rows.map((row) => (
                      <tr key={identity(row)}>
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
                              setSelected(identity(row));
                              setDeleting(false);
                              setNotice(undefined);
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
              <p>
                {location === "inbox"
                  ? "No received drafts are available with your current access."
                  : "No archived drafts are available with your current access."}
              </p>
            ))}
          {receipt && (
            <section className="form-stack" aria-label="Received draft review">
              <Button
                disabled={busy}
                onClick={() => {
                  setSelected(undefined);
                  setDeleting(false);
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
              {deleting ? (
                <section
                  className="form-stack"
                  aria-label="Delete archived draft"
                >
                  <h4>Delete this archived copy?</h4>
                  <p>
                    Export it first if you may need its contents. Deleting this
                    copy does not undo server changes or erase saved retry
                    outcomes.
                  </p>
                  {receipt.state === "pending" && (
                    <p>
                      The server may already have accepted this draft. Its
                      outcome remains uncertain.
                    </p>
                  )}
                  <div className="module-toolbar">
                    <Button disabled={busy} onClick={() => setDeleting(false)}>
                      Keep archived copy
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => void act(receipt, "delete")}
                    >
                      Delete archived copy
                    </Button>
                  </div>
                </section>
              ) : (
                <>
                  <div className="module-toolbar">
                    {location === "archive" ? (
                      <Button
                        disabled={busy}
                        onClick={() => void act(receipt, "restore")}
                      >
                        Restore to inbox
                      </Button>
                    ) : receipt.state === "accepted" ? (
                      <Button
                        disabled={busy}
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
                    {receipt.canExport && (
                      <Button
                        disabled={busy}
                        onClick={() => void act(receipt, "export")}
                      >
                        Export recovery file
                      </Button>
                    )}
                    {location === "inbox" && receipt.state !== "accepted" && (
                      <Button
                        disabled={busy}
                        onClick={() => void act(receipt, "archive")}
                      >
                        Archive draft
                      </Button>
                    )}
                    {location === "archive" && (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setDeleting(true);
                          setNotice(undefined);
                        }}
                      >
                        Delete archived copy…
                      </Button>
                    )}
                  </div>
                  {!receipt.canExport && (
                    <p className="small">
                      This receipt cannot be exported because its account
                      ownership could not be verified. Its contents remain
                      protected in the archive.
                    </p>
                  )}
                  {location === "archive" && receipt.state === "pending" && (
                    <p className="small">
                      Archiving does not cancel a server submission. Restore and
                      retry the original request to resolve its outcome.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </Modal>
    </>
  );
}

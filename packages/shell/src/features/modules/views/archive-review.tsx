import { useEffect, useRef, useState } from "react";
import type {
  ModuleCall,
  ModuleDefinition,
  ResourceRecord,
} from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";
import { canonical } from "@suite/module-sdk/registry";
import { CreateRecoveryNotice } from "./create-recovery-notice";
import {
  Button,
  ErrorMessage,
  Loading,
  Modal,
  ResourceValue,
} from "@suite/ui-web";

/** A fresh server snapshot informs this explicit decision; opening it never archives. */
export function ArchiveReview({
  entry,
  module,
  allowed,
  busy,
  load,
  submit,
  resolve,
  close,
}: {
  entry: JournalEntry;
  module: ModuleDefinition;
  allowed: boolean;
  busy: boolean;
  load(call: ModuleCall): Promise<ResourceRecord>;
  submit(
    call: ModuleCall,
    context?: JournalEntry["createRecovery"],
  ): Promise<void>;
  resolve(): Promise<void>;
  close(): void;
}) {
  const [record, setRecord] = useState<ResourceRecord>();
  const [reviewContext, setReviewContext] = useState<string>();
  const recoveryContext = canonical(entry.createRecovery ?? []);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const latest = useRef({ allowed, load, submit, resolve });
  latest.current = { allowed, load, submit, resolve };
  const generation = useRef(0);
  const input = entry.call.input as { id: string; baseVersion: number };
  const target = entry.recordRecovery?.targetId ?? input.id;
  const refresh = async () => {
    if (!latest.current.allowed) return;
    const version = ++generation.current;
    setLoading(true);
    setError(undefined);
    setRecord(undefined);
    try {
      const row = await latest.current.load({
        moduleId: module.id,
        moduleVersion: module.version,
        resource: entry.call.resource,
        action: "get",
        input: { id: target },
      });
      if (version === generation.current && latest.current.allowed) {
        setRecord(row);
        setReviewContext(recoveryContext);
      }
    } catch (error) {
      if (version === generation.current && latest.current.allowed)
        setError(error);
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    setRecord(undefined);
    if (allowed) void refresh();
    return () => {
      generation.current++;
    };
  }, [allowed, module.version, target, recoveryContext]);
  const confirm = async () => {
    if (
      !record ||
      record.archived ||
      !latest.current.allowed ||
      busy ||
      reviewContext !== recoveryContext
    )
      return;
    setError(undefined);
    try {
      await latest.current.submit(
        {
          moduleId: module.id,
          moduleVersion: module.version,
          resource: entry.call.resource,
          action: "archive",
          key: crypto.randomUUID(),
          input: { id: record.id, baseVersion: record.version },
        },
        entry.createRecovery,
      );
    } catch (error) {
      if (latest.current.allowed) setError(error);
    }
  };
  return (
    <Modal
      open
      title="Review archive"
      description="Review the current server record before confirming a new archive attempt. Your original request stays preserved."
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <p>
        Original target: {input.id}. Captured server version:{" "}
        {input.baseVersion}.
      </p>
      {target !== input.id && <p>Selected recovery target: {target}.</p>}
      <CreateRecoveryNotice context={entry.createRecovery} />
      <ErrorMessage error={error} />
      {!allowed ? (
        <p role="status">
          Reconnect with current read and write access to review this archive.
        </p>
      ) : (
        <>
          {loading && <Loading />}
          {record && (
            <>
              <p>Current server version: {record.version}.</p>
              <ResourceValue
                expanded
                value={record.data}
                schema={module.resources[entry.call.resource!].schema}
              />
              {record.archived ? (
                <p role="status">
                  This record is already archived. Resolve the original request
                  without archiving again.
                </p>
              ) : (
                <p>
                  The server will resolve the original request first. If it
                  already committed, its result will be recovered. Otherwise, a
                  new pending archive will use this server version and must be
                  accepted by the server.
                </p>
              )}
            </>
          )}
          <div className="actions">
            {record?.archived && (
              <Button
                disabled={busy || loading}
                onClick={() => {
                  if (!latest.current.allowed) return;
                  setError(undefined);
                  void latest.current.resolve().catch((error) => {
                    if (latest.current.allowed) setError(error);
                  });
                }}
              >
                Resolve original outcome
              </Button>
            )}
            <Button disabled={busy || loading} onClick={() => void refresh()}>
              Refresh current record
            </Button>
            <Button
              disabled={
                busy ||
                loading ||
                !record ||
                record.archived ||
                reviewContext !== recoveryContext
              }
              onClick={() => void confirm()}
            >
              Confirm reviewed archive
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

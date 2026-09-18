import { SavedWorkExport } from "./export";
import { useEffect, useRef, useState } from "react";
import { canUse, type FeatureProps } from "@suite/client";
import { readModuleStorage } from "@suite/client/module-storage";
import { settleJournalEntry } from "@suite/client/module-settlement";
import type { ModuleDefinition, TObject } from "@suite/module-sdk";
import { Button, ErrorMessage, Modal, ResourceValue } from "@suite/ui-web";
import { SavedChange, SavedDraft } from "../views/saved-change";
import { canReadSavedWork } from "./access";
import {
  canInspectResource,
  resourceRecoveryInputs,
  type ResourceInput,
} from "./resource-input";

export function ResourceRecovery(
  props: FeatureProps & { module: ModuleDefinition },
) {
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(false),
    refreshing = useRef(false);
  const [saved, setSaved] = useState<
    Awaited<ReturnType<typeof resourceRecoveryInputs>>
  >({ changes: [], drafts: [], failures: [] });
  const [open, setOpen] = useState(false),
    [resolving, setResolving] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const access = (input?: ResourceInput, connected = false) => {
    const p = latest.current;
    return (
      mounted.current &&
      p.scope.userId === props.scope.userId &&
      p.scope.workspaceId === props.scope.workspaceId &&
      p.module.id === props.module.id &&
      p.module.version === props.module.version &&
      canReadSavedWork(p, connected) &&
      (!input ||
        canInspectResource(input.call, p.module, input.module, (permission) =>
          canUse(p.bootstrap, p.module.id, permission, p.moduleCatalog),
        ))
    );
  };
  const refresh = async () => {
    if (refreshing.current || !access()) return;
    refreshing.current = true;
    try {
      const p = latest.current;
      const inputs = await resourceRecoveryInputs(
        await readModuleStorage(p.platform, p.scope),
        p.scope,
        p.module.id,
      );
      if (access()) setSaved(inputs);
    } catch (error) {
      if (access()) setError(error);
    } finally {
      refreshing.current = false;
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [props.module, props.bootstrap, props.online, props.offlineEnabled]);
  const changes = saved.changes.filter((entry) => access(entry));
  const drafts = saved.drafts.filter(
    (draft) => access(draft) && (!draft.source || access(draft.source)),
  );
  const selected = changes.find(({ entry }) => entry.id === resolving);
  const resolve = async () => {
    if (!selected || busy || !access(selected, true)) return;
    const p = latest.current;
    setBusy(true);
    try {
      await settleJournalEntry(
        p.platform,
        p.scope,
        selected.entry.id,
        (request) =>
          p.client.request({
            operation: "moduleAttemptSettle",
            params: {
              workspaceId: p.scope.workspaceId,
              moduleId: request.moduleId,
            },
            moduleVersion: request.moduleVersion,
            body: request.body,
          }),
        () => access(selected, true),
        "saved-resource",
      );
      if (access()) {
        setError(undefined);
        setResolving(undefined);
      }
    } catch (error) {
      if (access()) setError(error);
    } finally {
      if (mounted.current) {
        setBusy(false);
        await refresh();
      }
    }
  };
  if (
    !access() ||
    (!changes.length && !drafts.length && !error && !saved.failures.length)
  )
    return null;
  return (
    <>
      <ErrorMessage error={error ?? saved.failures[0]} />
      <Button onClick={() => setOpen(true)}>
        Saved records and drafts ({changes.length + drafts.length})
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Records and drafts"
        description="Inspect original changes and drafts. Recovery does not submit new work or change saved input."
      >
        <ErrorMessage error={error ?? saved.failures[0]} />
        <ul>
          {changes.map(({ entry, module }) => (
            <li key={entry.id}>
              <h3>
                {module.resources[entry.call.resource!].title}:{" "}
                {entry.call.action}
              </h3>
              <p>
                {entry.settlement === "cancelled"
                  ? "Original request stopped"
                  : entry.state === "pending"
                    ? entry.delivery === "unsubmitted"
                      ? "Pending submission"
                      : "Outcome unknown"
                    : entry.state === "accepted"
                      ? "Accepted"
                      : entry.state === "conflict"
                        ? "Conflict"
                        : "Rejected"}
              </p>
              <p>
                Release {entry.call.moduleVersion}. Retry identity:{" "}
                <code>{entry.id}</code>
              </p>
              {!!entry.dependencies.length && (
                <p>Prerequisites: {entry.dependencies.join(", ")}</p>
              )}
              {entry.call.action !== "archive" && (
                <SavedChange
                  entry={entry}
                  schema={
                    module.resources[entry.call.resource!].schema as TObject
                  }
                />
              )}
              {entry.call.action === "archive" && (
                <details>
                  <summary>View archive target</summary>
                  <ResourceValue value={entry.call.input} />
                </details>
              )}
              {entry.state === "accepted" && (
                <details>
                  <summary>View accepted result</summary>
                  <ResourceValue value={entry.result} />
                </details>
              )}
              <SavedWorkExport
                {...props}
                active={open}
                selection={{ requestId: entry.id }}
              />
              {entry.state !== "accepted" &&
                entry.settlement !== "cancelled" && (
                  <Button
                    disabled={
                      busy || !access({ call: entry.call, module }, true)
                    }
                    onClick={() => setResolving(entry.id)}
                  >
                    Resolve record outcome
                  </Button>
                )}
            </li>
          ))}
        </ul>
        <ul>
          {drafts.map((draft) => (
            <li key={draft.key}>
              <h3>
                {draft.module.resources[draft.call.resource!].title}:{" "}
                {draft.review ? "saved review" : "draft"}
              </h3>
              <p>
                Release {draft.call.moduleVersion}.{" "}
                {draft.review?.entryId
                  ? `Review of request ${draft.review.entryId}.`
                  : "Saved separately from submitted changes."}
              </p>
              {(draft.original?.recordId ?? draft.target?.id) && (
                <p>
                  Record:{" "}
                  <code>{draft.original?.recordId ?? draft.target?.id}</code>
                </p>
              )}
              {draft.review?.collision && (
                <div>
                  {draft.review.collision.targetId && (
                    <p>
                      Selected record:{" "}
                      <code>{draft.review.collision.targetId}</code>
                    </p>
                  )}
                  <p>
                    Prerequisite request:{" "}
                    <code>{draft.review.collision.parentId}</code>
                  </p>
                  <p>
                    {draft.review.collision.ready
                      ? "Review the saved values before submitting this draft."
                      : draft.review.collision.targetId
                        ? "Review the selected target before submitting this draft."
                        : "Review this reassigned draft before submitting it."}
                  </p>
                </div>
              )}
              <SavedDraft
                original={draft.original}
                unsubmitted={
                  !draft.review &&
                  draft.module.resources[draft.call.resource!].policy ===
                    "queued"
                }
                data={draft.data}
                target={draft.target}
                schema={
                  draft.module.resources[draft.call.resource!].schema as TObject
                }
              />
              {draft.review?.comparison && (
                <details>
                  <summary>View saved comparison</summary>
                  <ResourceValue value={draft.review.comparison} />
                </details>
              )}
              <SavedWorkExport
                {...props}
                active={open}
                selection={{ draftKey: draft.key }}
              />
              {draft.source && (
                <details>
                  <summary>
                    View original draft before record reassignment
                  </summary>
                  {draft.source.target && (
                    <p>
                      Original record: <code>{draft.source.target.id}</code>
                    </p>
                  )}
                  <SavedDraft
                    unsubmitted={false}
                    data={draft.source.data}
                    target={draft.source.target}
                    schema={
                      draft.source.module.resources[draft.source.call.resource!]
                        .schema as TObject
                    }
                  />
                </details>
              )}
            </li>
          ))}
        </ul>
      </Modal>
      <Modal
        open={!!selected}
        onOpenChange={(value) => {
          if (!value) setResolving(undefined);
        }}
        title="Resolve record outcome"
        description="Recover the accepted result or ask the server to stop the exact original request. Drafts and reviews remain saved."
      >
        <ErrorMessage error={error} />
        <Button
          disabled={busy || !selected || !access(selected, true)}
          onClick={() => void resolve()}
        >
          Recover record result or stop retries
        </Button>
      </Modal>
    </>
  );
}

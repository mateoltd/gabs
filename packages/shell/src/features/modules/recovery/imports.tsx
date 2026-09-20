import { useLayoutEffect, useRef, useState } from "react";
import type { FeatureProps } from "@suite/client";
import { readModuleStorage } from "@suite/client/module-storage";
import {
  stageSavedWorkImport,
  inspectSavedWorkImport,
  promoteSavedWorkImport,
  discardSavedWorkImport,
  savedWorkImportLimit,
  type SavedWorkImportOptions,
  type ImportAccess,
  type ImportedDraftSource,
} from "@suite/client/work-import";
import {
  Button,
  ErrorMessage,
  Field,
  Input,
  Modal,
  ResourceValue,
  Select,
  SelectOption,
} from "@suite/ui-web";
import { canReadSavedWork } from "./access";
type Imported = Awaited<ReturnType<typeof inspectSavedWorkImport>>;

/** File copies remain explicitly reviewed, with no automatic submission or restoration. */
export function SavedWorkImports(props: FeatureProps) {
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [copies, setCopies] = useState<Imported[]>([]);
  const [revision, setRevision] = useState<number | string>();
  const [confirm, setConfirm] = useState<{
    digest: string;
    action: "restore" | "remove";
    draftSource?: ImportedDraftSource;
  }>();
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useLayoutEffect(() => {
    controller.current?.abort();
    setCopies([]);
    setConfirm(undefined);
    setError(undefined);
    setNotice("");
  }, [
    props.scope.userId,
    props.scope.workspaceId,
    props.online,
    props.offlineEnabled,
  ]);
  useLayoutEffect(() => {
    setConfirm(undefined);
  }, [props.bootstrap.policyRevision]);
  const currentAccess = (p: FeatureProps, access: ImportAccess) =>
    access.permissions.every((permission) =>
      p.bootstrap.permissions.includes(permission),
    ) &&
    access.modules.every((id) =>
      p.bootstrap.modules.some(
        (module) =>
          module.moduleId === id &&
          module.state === "enabled" &&
          module.assigned &&
          module.entitled,
      ),
    );
  const allowed = canReadSavedWork(props, true);
  // A policy delivered by this refresh may render before the provider returns.
  // Hide stale results by revision without aborting the refresh that delivered it.
  const visible =
    allowed && revision === props.bootstrap.policyRevision
      ? copies.filter((copy) => currentAccess(props, copy.access))
      : [];
  const run = async (
    action: (options: SavedWorkImportOptions) => Promise<void>,
  ) => {
    if (busy || !allowed) return;
    const captured = latest.current;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(true);
    setError(undefined);
    setNotice("");
    const options: SavedWorkImportOptions = {
      platform: captured.platform,
      client: captured.client,
      scope: captured.scope,
      signal: abort.signal,
      check: (access) => {
        const p = latest.current;
        if (
          !mounted.current ||
          p.scope.userId !== captured.scope.userId ||
          p.scope.workspaceId !== captured.scope.workspaceId ||
          !canReadSavedWork(p, true) ||
          (access && !currentAccess(p, access))
        )
          throw Error(
            "Connect and unlock this workspace to recover saved work.",
          );
      },
      receivePolicy: (policy, signal) =>
        latest.current.receivePolicy(policy, signal),
    };
    try {
      await action(options);
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted) {
        setError(failure);
        latest.current.onError(failure);
      }
    } finally {
      if (mounted.current && controller.current === abort) setBusy(false);
    }
  };
  const refresh = async (options: SavedWorkImportOptions) => {
    const stored = await readModuleStorage(options.platform, options.scope);
    const next: Imported[] = [];
    let inaccessible = 0;
    for (const digest of Object.keys(stored.recoveryImports ?? {})) {
      options.signal.throwIfAborted();
      options.check();
      try {
        next.push(await inspectSavedWorkImport(options, digest));
      } catch (failure) {
        options.signal.throwIfAborted();
        options.check();
        inaccessible++;
        latest.current.onError(failure);
      }
    }
    options.signal.throwIfAborted();
    options.check();
    setCopies(next);
    setRevision(latest.current.bootstrap.policyRevision);
    if (inaccessible)
      setError(
        Error(
          "Some imported copies could not be opened. Sign in again and check your current workspace access. The copies remain saved.",
        ),
      );
  };
  const selected = visible.find((copy) => copy.digest === confirm?.digest);
  const collision =
    selected?.input.selection === "draft" && !selected.input.entry
      ? selected.input.review?.collision
      : undefined;
  if (!props.offlineEnabled) return null;
  return (
    <>
      <Button
        disabled={!allowed || busy}
        onClick={() => {
          setOpen(true);
          void run(refresh);
        }}
      >
        Import saved work
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            if (!value) {
              controller.current?.abort();
              setCopies([]);
              setConfirm(undefined);
            }
          }
        }}
        title="Imported saved work"
        description="Recover saved requests and drafts for this workspace. A recent sign-in with multi-factor authentication is required."
      >
        <div className="form-stack" aria-busy={busy}>
          <ErrorMessage error={error} />
          {notice && <p role="status">{notice}</p>}
          {!allowed && <p>Connect and unlock this workspace to continue.</p>}
          {allowed && !selected && (
            <>
              <Field
                label="Saved-work recovery file"
                hint="Choose an exported JSON copy, up to 1 MiB."
              >
                <Input
                  type="file"
                  accept="application/json,.json"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    void run(async (options) => {
                      if (file.size > savedWorkImportLimit)
                        throw Error("Choose a recovery file up to 1 MiB.");
                      const result = await stageSavedWorkImport(
                        options,
                        await file.text(),
                      );
                      await refresh(options);
                      setNotice(
                        result.alreadyImported
                          ? "This copy is already saved. Existing work was preserved."
                          : "Copy imported. Inspect its saved input before restoring it.",
                      );
                    });
                  }}
                />
              </Field>
              <Button disabled={busy} onClick={() => void run(refresh)}>
                Refresh imported copies
              </Button>
              {busy && <p role="status">Checking saved-work access…</p>}
              <div className="form-stack">
                {visible.map((copy) => (
                  <section key={copy.digest}>
                    <h3>
                      {copy.moduleName}:{" "}
                      {copy.input.selection === "request"
                        ? "saved request"
                        : "saved draft"}
                    </h3>
                    <p>
                      {copy.promotion
                        ? "Restored. The imported copy is retained separately."
                        : "Imported copy. No business change has been submitted."}
                    </p>
                    {copy.promotion?.outcome && (
                      <p>
                        {copy.promotion.outcome === "accepted"
                          ? "Original request accepted by the server."
                          : "Original request stopped by the server. Review saved input before submitting a correction."}
                      </p>
                    )}
                    {copy.input.selection === "draft" &&
                      copy.input.entry &&
                      copy.promotion?.outcome === "accepted" && (
                        <p>
                          Saved edits are restored for review against the
                          accepted record. They do not create another record.
                        </p>
                      )}
                    <details>
                      <summary>Inspect saved input</summary>
                      <ResourceValue
                        expanded
                        value={
                          copy.input.selection === "request"
                            ? copy.input.entry.call.input
                            : copy.input.data
                        }
                      />
                      {copy.input.entry && (
                        <p>
                          Original retry identity:{" "}
                          <code>{copy.input.entry.id}</code>
                        </p>
                      )}
                      {copy.input.selection === "draft" &&
                        copy.input.target && (
                          <>
                            <p>Saved record snapshot</p>
                            <ResourceValue value={copy.input.target} />
                          </>
                        )}
                      {copy.input.review && (
                        <>
                          <p>Saved review choices</p>
                          <ResourceValue value={copy.input.review} />
                        </>
                      )}
                      <p>
                        {copy.input.entry
                          ? "Outcome and approval claims in this file are unverified. Restoration checks the original request with the server."
                          : "Saved record and review choices are unverified. Restoration uses current workspace access."}
                      </p>
                    </details>
                    <div className="actions">
                      {!copy.promotion && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              digest: copy.digest,
                              action: "restore",
                            })
                          }
                        >
                          Restore for review
                        </Button>
                      )}
                      <Button
                        disabled={busy}
                        onClick={() =>
                          setConfirm({ digest: copy.digest, action: "remove" })
                        }
                      >
                        Remove imported copy
                      </Button>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
          {selected && (
            <>
              <h3>
                {confirm?.action === "restore"
                  ? "Restore this saved work?"
                  : "Remove this imported copy?"}
              </h3>
              <p>
                {confirm?.action === "restore"
                  ? selected.input.entry
                    ? "The server will recover the original accepted result or permanently stop the original request. Uncommitted input is restored for correction; this action does not submit a new business change."
                    : "This creates a separate saved draft for review. Existing drafts stay in place."
                  : "This removes only the imported copy. Restored requests, drafts and the original file stay in place. Keep the source file if you may need this copy again."}
              </p>
              {confirm?.action === "restore" && !collision && (
                <p>
                  Saved continuation and collision choices remain in the
                  imported copy. Choose them again when reviewing the restored
                  work.
                </p>
              )}
              {confirm?.action === "restore" &&
                selected.input.selection === "draft" &&
                selected.input.entry && (
                  <p>
                    If the original was accepted, this draft becomes a review of
                    that record. Otherwise it stays linked to the stopped
                    request. Current server values are checked again, and
                    conflicting fields need fresh choices.
                  </p>
                )}
              {confirm?.action === "restore" && collision && (
                <>
                  <Field
                    label="Draft to restore"
                    hint="Choose again for this import. Current record values will be fetched, and conflicting fields need fresh choices."
                  >
                    <Select
                      value={confirm.draftSource ?? ""}
                      disabled={busy}
                      onValueChange={(value) => {
                        setConfirm({
                          ...confirm,
                          draftSource:
                            value === "original" || value === "reassigned"
                              ? value
                              : undefined,
                        });
                      }}
                    >
                      <SelectOption value="">Choose a draft</SelectOption>
                      <SelectOption value="original">
                        Original draft before reassignment
                      </SelectOption>
                      <SelectOption value="reassigned">
                        Reassigned draft
                      </SelectOption>
                    </Select>
                  </Field>
                  <details>
                    <summary>Compare original and reassigned input</summary>
                    <p>Original draft</p>
                    <ResourceValue value={collision.sourceData} />
                    <p>
                      Original record:{" "}
                      {collision.sourceTarget?.id ?? "New record"}
                    </p>
                    <p>Reassigned draft</p>
                    <ResourceValue
                      value={
                        selected.input.selection === "draft"
                          ? selected.input.data
                          : {}
                      }
                    />
                    <p>
                      Reassigned record: {collision.targetId ?? "New record"}
                    </p>
                  </details>
                  <p>
                    This restores an independent draft. It does not confirm or
                    recreate the prerequisite request named in the file.
                  </p>
                </>
              )}
              <div className="actions">
                <Button
                  disabled={
                    busy ||
                    (confirm?.action === "restore" &&
                      !!collision &&
                      !confirm.draftSource)
                  }
                  onClick={() =>
                    void run(async (options) => {
                      if (confirm!.action === "restore") {
                        const result = await promoteSavedWorkImport(
                          options,
                          selected.digest,
                          confirm!.draftSource
                            ? { draftSource: confirm!.draftSource }
                            : undefined,
                        );
                        setNotice(
                          result.alreadyRestored
                            ? "This copy was already restored."
                            : "Saved work restored for review. Open the module to review corrections and drafts.",
                        );
                      } else {
                        await discardSavedWorkImport(options, selected.digest);
                        setNotice(
                          "Imported copy removed. Other saved work was preserved.",
                        );
                      }
                      setConfirm(undefined);
                      await refresh(options);
                    })
                  }
                >
                  {confirm?.action === "restore"
                    ? "Confirm restoration"
                    : "Confirm removal"}
                </Button>
                <Button disabled={busy} onClick={() => setConfirm(undefined)}>
                  Back to imported copies
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

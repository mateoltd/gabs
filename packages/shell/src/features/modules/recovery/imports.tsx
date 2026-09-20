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
  importedDraftChoices,
  importedDraftInput,
  importedRequestTargets,
  importedReferenceHints,
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
import { CreateRecoveryNotice } from "../views/create-recovery-notice";
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
    replaceReview?: string;
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
    controller.current = undefined;
    setBusy(false);
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
  const collision = selected
    ? (importedDraftChoices(selected.input) ??
      importedRequestTargets(selected.input))
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
                  <section key={copy.digest} data-recovery-copy={copy.digest}>
                    <h3>
                      {copy.moduleName}:{" "}
                      {copy.input.selection === "request"
                        ? "saved request"
                        : "saved draft"}
                    </h3>
                    <p>
                      {copy.promotion?.replacedAt
                        ? "Retained after switching reviews. Available to restore again."
                        : copy.promotion
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
                      {(!copy.promotion || copy.promotion.replacedAt) && (
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
              {confirm?.action === "restore" && selected.localReview && (
                <>
                  <h4>Current review on this device</h4>
                  <p>
                    Switching retains this review as a separate imported copy
                    before restoring the selected input. The original request
                    and its current prerequisites stay unchanged.
                  </p>
                  <details>
                    <summary>Compare saved input</summary>
                    <p>Selected imported copy</p>
                    <ResourceValue
                      expanded
                      value={
                        selected.input.selection === "draft"
                          ? importedDraftInput(selected.input)
                          : (selected.input.review?.input ??
                            selected.input.entry.call.input)
                      }
                    />
                    <p>Current local review</p>
                    {selected.localReview.copies.map((copy, index) => (
                      <ResourceValue
                        key={index}
                        expanded
                        value={
                          copy.selection === "draft"
                            ? importedDraftInput(copy)
                            : (copy.review?.input ?? copy.entry.call.input)
                        }
                      />
                    ))}
                  </details>
                  <Field
                    label="Existing review"
                    hint="Choose explicitly after comparing the copies. No business change is submitted by switching."
                  >
                    <Select
                      value={confirm.replaceReview ?? ""}
                      disabled={busy}
                      onValueChange={(value) =>
                        setConfirm({
                          ...confirm,
                          replaceReview: value || undefined,
                        })
                      }
                    >
                      <SelectOption value="">Keep current review</SelectOption>
                      <SelectOption value={selected.localReview.fingerprint}>
                        Use imported copy
                      </SelectOption>
                    </Select>
                  </Field>
                </>
              )}
              {confirm?.action === "restore" && !collision && (
                <p>
                  Saved continuation and collision choices remain in the
                  imported copy. Choose them again when reviewing the restored
                  work.
                </p>
              )}
              {confirm?.action === "restore" &&
                selected.input.selection === "draft" &&
                selected.input.entry &&
                !collision?.linked && (
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
                    label={
                      collision.linked ? "Record to review" : "Draft to restore"
                    }
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
                      <SelectOption value="">
                        {collision.linked
                          ? "Choose a record"
                          : "Choose a draft"}
                      </SelectOption>
                      <SelectOption value="original">
                        {collision.linked
                          ? "Original record"
                          : "Original draft before reassignment"}
                      </SelectOption>
                      <SelectOption value="reassigned">
                        {collision.linked
                          ? "Reassigned record"
                          : "Reassigned draft"}
                      </SelectOption>
                    </Select>
                  </Field>
                  <details>
                    <summary>
                      {collision.linked
                        ? "Compare record targets"
                        : "Compare original and reassigned input"}
                    </summary>
                    <p>
                      {collision.linked
                        ? selected.input.selection === "request"
                          ? "Saved request input"
                          : "Saved draft input"
                        : "Original draft"}
                    </p>
                    <ResourceValue value={collision.originalData} />
                    <p>
                      Original record: {collision.originalId ?? "New record"}
                    </p>
                    {!collision.linked && (
                      <>
                        <p>Reassigned draft</p>
                        <ResourceValue value={collision.reassignedData} />
                      </>
                    )}
                    <p>
                      Reassigned record:{" "}
                      {collision.reassignedId ?? "New record"}
                    </p>
                  </details>
                  <p>
                    {collision.linked
                      ? "A stopped request keeps its identity and prerequisites. Restore prerequisite receipts before submitting a correction. An accepted request can only restore a review of its actual record."
                      : "This restores an independent draft. It does not confirm or recreate the prerequisite request named in the file."}
                  </p>
                </>
              )}
              {confirm?.action === "restore" && (
                <CreateRecoveryNotice
                  context={importedReferenceHints(selected.input)}
                />
              )}
              <div className="actions">
                <Button
                  disabled={
                    busy ||
                    (confirm?.action === "restore" &&
                      !!selected.localReview &&
                      confirm.replaceReview !==
                        selected.localReview.fingerprint) ||
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
                          {
                            ...(confirm!.draftSource
                              ? selected.input.selection === "request"
                                ? { recordTarget: confirm!.draftSource }
                                : { draftSource: confirm!.draftSource }
                              : {}),
                            ...(confirm!.replaceReview
                              ? { replaceReview: confirm!.replaceReview }
                              : {}),
                          },
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

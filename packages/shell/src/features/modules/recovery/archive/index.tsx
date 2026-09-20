import type { FeatureProps } from "@suite/client";
import {
  Button,
  Checkbox,
  ErrorMessage,
  Field,
  Input,
  Modal,
  ResourceValue,
} from "@suite/ui-web";
import { canReadSavedWork } from "../access";
import { useArchive } from "./state";

export function SavedWorkArchives(props: FeatureProps) {
  const {
    open,
    mode,
    busy,
    error,
    notice,
    unavailable,
    visible,
    selected,
    setSelected,
    passphrase,
    setPassphrase,
    confirmation,
    setConfirmation,
    file,
    chosen,
    allowed,
    openArchive,
    onOpenChange,
    selectMode,
    chooseFile,
    load,
    unlock,
    save,
    admit,
  } = useArchive(props);
  if (!props.offlineEnabled) return null;
  return (
    <>
      <Button disabled={!canReadSavedWork(props)} onClick={openArchive}>
        Saved-work archives
      </Button>
      <Modal
        open={open}
        title="Saved-work archives"
        description="Keep an encrypted copy of saved requests and drafts. Restoring a file never submits business changes."
        onOpenChange={onOpenChange}
      >
        <div className="form-stack" aria-busy={busy}>
          <div className="actions">
            <Button
              disabled={busy}
              aria-pressed={mode === "export"}
              onClick={() => selectMode("export")}
            >
              Create archive
            </Button>
            <Button
              disabled={busy}
              aria-pressed={mode === "import"}
              onClick={() => selectMode("import")}
            >
              Open archive
            </Button>
          </div>
          <ErrorMessage error={error} />
          {notice && <p role="status">{notice}</p>}
          {!allowed && (
            <p>
              {mode === "import"
                ? "Connect and sign in again to inspect and import an archive."
                : "Unlock this workspace with current recovery access to continue."}
            </p>
          )}
          {allowed && mode === "export" && (
            <Button disabled={busy} onClick={load}>
              Load saved work
            </Button>
          )}
          {allowed && mode === "import" && (
            <Field
              label="Encrypted saved-work archive"
              hint="Choose the original encrypted JSON file. A recent sign-in with multi-factor authentication is required."
            >
              <Input
                type="file"
                accept="application/json,.json"
                disabled={busy}
                onChange={(event) => {
                  const chosen = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  chooseFile(chosen);
                }}
              />
            </Field>
          )}
          {allowed && mode === "import" && file && <p>{file.name}</p>}
          {allowed && (
            <>
              <Field
                label="Archive passphrase"
                hint={
                  mode === "export"
                    ? "Use 12–1,024 characters. Keep this passphrase separately; it cannot be recovered from the file."
                    : "The passphrase unlocks the file. Current workspace access is checked separately."
                }
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  maxLength={1024}
                  value={passphrase}
                  disabled={busy}
                  onChange={(event) => setPassphrase(event.target.value)}
                />
              </Field>
              {mode === "export" && (
                <Field label="Confirm archive passphrase">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    maxLength={1024}
                    disabled={busy}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </Field>
              )}
              {mode === "import" && (
                <Button
                  disabled={busy || !file || passphrase.length < 12}
                  onClick={() => unlock()}
                >
                  Unlock archive
                </Button>
              )}
            </>
          )}
          {busy && <p role="status">Checking saved-work access…</p>}
          {allowed && unavailable > 0 && (
            <p>
              {unavailable} saved items are unavailable under current access or
              source contracts. They have not been discarded. Keep the source
              files and reconnect or refresh access.
            </p>
          )}
          {visible.length > 0 && (
            <>
              <p>
                Select{" "}
                {mode === "export" ? "up to 256 snapshots" : "up to 32 copies"}.{" "}
                {mode === "export"
                  ? "The archive can contain up to 16 MiB. Original work stays on this device."
                  : "Import storage is limited to 1 MiB. Import smaller selections as needed and keep the original archive."}
              </p>
              <div className="form-stack">
                {visible.map((copy, index) => (
                  <section key={copy.digest}>
                    <label className="check-row">
                      <Checkbox
                        checked={selected.includes(copy.digest)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setSelected((current) =>
                            checked
                              ? [...current, copy.digest]
                              : current.filter(
                                  (digest) => digest !== copy.digest,
                                ),
                          )
                        }
                      />
                      {copy.moduleName}:{" "}
                      {copy.input.selection === "request"
                        ? "saved request"
                        : "saved draft"}{" "}
                      {index + 1}
                    </label>
                    <details>
                      <summary>Inspect saved snapshot</summary>
                      <ResourceValue
                        expanded
                        value={
                          copy.input.selection === "draft"
                            ? copy.input.data
                            : (copy.input.review?.input ??
                              copy.input.entry.call.input)
                        }
                      />
                    </details>
                  </section>
                ))}
              </div>
              {mode === "export" ? (
                <Button
                  disabled={
                    busy ||
                    !chosen.length ||
                    chosen.length > 256 ||
                    passphrase.length < 12 ||
                    passphrase !== confirmation
                  }
                  onClick={() => save()}
                >
                  Save encrypted archive
                </Button>
              ) : (
                <Button
                  disabled={busy || !chosen.length || chosen.length > 32}
                  onClick={() => admit()}
                >
                  Import selected copies
                </Button>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

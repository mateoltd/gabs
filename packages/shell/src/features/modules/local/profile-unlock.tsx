import { localVaultProvider } from "@suite/client/local-profiles";
import { useEffect, useRef, useState } from "react";
import { type LocalUnlockStatus } from "@suite/client/local-unlock";
import {
  Button,
  Checkbox,
  ErrorMessage,
  Field,
  Input,
  Modal,
} from "@suite/ui-web";
import { useShellComposition } from "../../../app/composition";

export function LocalProfileUnlock({
  id,
  onSaved,
}: {
  id: string;
  onSaved(): void;
}) {
  const { localProfiles } = useShellComposition();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [biometric, setBiometric] = useState(false);
  const [status, setStatus] = useState<LocalUnlockStatus>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setStatus(undefined);
    void localVaultProvider(localProfiles)
      .status(id)
      .then((value) => {
        if (active) {
          setStatus(value);
          setBiometric(value.biometric);
        }
      })
      .catch((error) => {
        if (active) setError(error);
      });
    return () => {
      active = false;
      pending.current?.abort();
    };
  }, [open, id, localProfiles]);
  async function save(remove = false) {
    if (pending.current) return;
    setError(undefined);
    if (!remove && pin !== confirmation) {
      setError(Error("The PINs do not match."));
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      await localVaultProvider(localProfiles).configure(
        id,
        password,
        remove ? undefined : pin,
        !remove && biometric,
        controller.signal,
      );
      onSaved();
    } catch (error) {
      if (!controller.signal.aborted) setError(error);
    } finally {
      if (pending.current === controller) pending.current = undefined;
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        onClick={() => {
          setError(undefined);
          setPassword("");
          setPin("");
          setConfirmation("");
          setOpen(true);
        }}
      >
        Profile unlock
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            pending.current?.abort();
            setPassword("");
            setPin("");
            setConfirmation("");
          }
          setOpen(value);
        }}
        title="Profile unlock"
        description="Set an optional PIN for this local profile. Keep your passphrase for recovery. Saving locks every open copy of this profile."
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ErrorMessage error={error} />
          <p>
            {localVaultProvider(localProfiles).kind === "desktop"
              ? "Your PIN key is protected by this device’s operating system. Touch ID is available on supported devices."
              : "A PIN is easier to guess than a strong passphrase if someone copies your browser data. It only unlocks this local profile in this browser."}
          </p>
          {status && !status.available && (
            <p role="status">
              Protected storage is unavailable. You can still unlock with your
              passphrase or remove quick unlock.
            </p>
          )}
          <Field label="Current passphrase">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="New PIN" hint="8 to 12 digits">
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{8,12}"
              minLength={8}
              maxLength={12}
              autoComplete="off"
              required
              value={pin}
              disabled={busy}
              onChange={(event) => setPin(event.target.value)}
            />
          </Field>
          <Field label="Confirm PIN">
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{8,12}"
              minLength={8}
              maxLength={12}
              autoComplete="off"
              required
              value={confirmation}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
          {status?.biometricAvailable && (
            <label>
              <Checkbox
                checked={biometric}
                onCheckedChange={(value) => setBiometric(value === true)}
                disabled={busy}
              />{" "}
              Allow Touch ID
            </label>
          )}
          <div className="actions">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || status?.available === false}
            >
              Save and lock
            </Button>
            {(status?.enabled || (!status && !!error)) && (
              <Button
                type="button"
                disabled={busy || !password}
                onClick={() => void save(true)}
              >
                Remove quick unlock and lock
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProfileLockStatus } from "@suite/client/profile-lock";
import {
  Button,
  ErrorMessage,
  Field,
  FeedbackProvider,
  Input,
  Loading,
  PreservedSurface,
  Checkbox,
} from "@suite/ui-web";
import { Login } from "./login";
import { beginBrowserProfileRecovery } from "@suite/client/browser-profile-lock";
import {
  profileLock,
  profileLockReady,
  finishBrowserProfileRecovery,
} from "../../app/runtime";
import { LocalWorkspace } from "../modules/local/workspace";
import { BrandIcon } from "../../app/brand";

const LockContext = createContext<ProfileLockStatus | undefined>(undefined);
export const useProfileLock = () => useContext(LockContext);
export function ProfileGate({ children }: { children: ReactNode }) {
  const capability = profileLock;
  const [status, setStatus] = useState<ProfileLockStatus>();
  const [error, setError] = useState<unknown>();
  const [recover, setRecover] = useState(false);
  const [personal, setPersonal] = useState(false);
  const [opened, setOpened] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const lastLocked = useRef(false);
  const unlockAttempt = useRef(0);
  const received = useRef<ProfileLockStatus | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const apply = (next: ProfileLockStatus) => {
      if (!active) return;
      const previous = received.current;
      if (previous && next.revision < previous.revision) return;
      if (
        window.suiteDesktop &&
        previous?.userId &&
        previous.userId !== next.userId
      )
        qc.clear();
      received.current = next;
      setStatus(next);
    };
    const stop = capability.onProfileLock(apply);
    void profileLockReady
      .then(async (recoveryError) => {
        apply(await capability.profileLockStatus());
        if (recoveryError) setError(recoveryError);
      })
      .catch(setError);
    return () => {
      active = false;
      stop();
    };
  }, [capability, qc]);
  useEffect(() => {
    if (!status) return;
    unlockAttempt.current++;
    setBusy(false);
    setPin("");
    if (!status.locked) {
      setError(undefined);
      setOpened(true);
      setRecover(false);
      setPersonal(false);
      if (lastLocked.current) void qc.invalidateQueries();
    }
    lastLocked.current = status.locked;
  }, [status?.locked, status?.userId, qc]);
  useEffect(() => {
    const enter = () => {
      if (status?.locked) setPersonal(true);
    };
    window.addEventListener("suite-local-mode", enter);
    return () => window.removeEventListener("suite-local-mode", enter);
  }, [status?.locked]);
  async function unlock(method: "pin" | "biometric") {
    if (busy) return;
    const attempt = ++unlockAttempt.current;
    setBusy(true);
    setError(undefined);
    try {
      await capability.unlockProfile(
        method,
        method === "pin" ? pin : undefined,
      );
    } catch (error) {
      if (attempt === unlockAttempt.current) setError(error);
    } finally {
      if (attempt === unlockAttempt.current) {
        setPin("");
        setBusy(false);
      }
    }
  }
  return (
    <LockContext.Provider value={status}>
      {opened && (
        <PreservedSurface
          key={
            window.suiteDesktop
              ? (status?.userId ?? "signed-out")
              : "browser-session"
          }
          visible={!!status && !status.locked}
        >
          {children}
        </PreservedSurface>
      )}
      {!status ? (
        <main className="offline-start">
          <Loading label="Checking device unlock" />
          <ErrorMessage error={error} />
          {error ? (
            <Button onClick={() => window.location.reload()}>Try again</Button>
          ) : null}
        </main>
      ) : status.locked ? (
        personal ? (
          <FeedbackProvider>
            <LocalWorkspace onExit={() => setPersonal(false)} />
          </FeedbackProvider>
        ) : recover ? (
          <FeedbackProvider>
            <Login
              beforeSignIn={
                window.suiteDesktop ? undefined : beginBrowserProfileRecovery
              }
              onSignedIn={
                window.suiteDesktop ? undefined : finishBrowserProfileRecovery
              }
            />
          </FeedbackProvider>
        ) : (
          <main className="local-workspace">
            <section
              className="form-stack local-profile-form"
              aria-labelledby="profile-lock-heading"
            >
              <BrandIcon size={32} />
              <h1 id="profile-lock-heading">Unlock your profile</h1>
              <p>
                Your saved work stays on this device. Server permissions and
                offline access limits still apply.
              </p>
              <ErrorMessage
                error={
                  error ?? (status.error ? Error(status.error) : undefined)
                }
              />
              <form
                className="form-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void unlock("pin");
                }}
              >
                <Field label="Device PIN" hint="8 to 12 digits">
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="[0-9]{8,12}"
                    minLength={8}
                    maxLength={12}
                    required
                    value={pin}
                    disabled={busy || !status.available}
                    onChange={(event) => setPin(event.target.value)}
                  />
                </Field>
                {status.retryAt > Date.now() && (
                  <p role="status">
                    PIN attempts are temporarily limited. Try again after{" "}
                    {new Date(status.retryAt).toLocaleTimeString()}.
                  </p>
                )}
                <div className="actions">
                  <Button type="submit" disabled={busy || !status.available}>
                    Unlock with PIN
                  </Button>
                  {status.biometric && status.biometricAvailable && (
                    <Button
                      type="button"
                      disabled={busy || !status.available}
                      onClick={() => void unlock("biometric")}
                    >
                      Use Touch ID
                    </Button>
                  )}
                </div>
              </form>
              {!status.available && (
                <p>
                  {window.suiteDesktop
                    ? "Protected storage is unavailable. Unlock the operating system’s protected storage or sign in online."
                    : "Browser storage is unavailable. Restore access to this browser’s storage before continuing."}
                </p>
              )}
              <div className="actions">
                <Button disabled={busy} onClick={() => setRecover(true)}>
                  Sign in online
                </Button>
                <Button disabled={busy} onClick={() => setPersonal(true)}>
                  Open local profiles
                </Button>
              </div>
            </section>
          </main>
        )
      ) : !opened ? (
        <Loading />
      ) : null}
    </LockContext.Provider>
  );
}

export function ProfileLockSettings() {
  const status = useContext(LockContext);
  const capability = profileLock;
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [previous, setPrevious] = useState("");
  const [biometric, setBiometric] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [recoveryNow, setRecoveryNow] = useState(() => Date.now());
  useEffect(() => {
    setBiometric(status?.biometric ?? false);
  }, [status?.biometric, status?.userId]);
  useEffect(() => {
    const expiresAt = status?.recoveryExpiresAt ?? 0;
    setRecoveryNow(Date.now());
    const delay = expiresAt - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(
      () => setRecoveryNow(Date.now()),
      Math.min(delay + 1, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [status?.recoveryExpiresAt, status?.userId]);
  if (!status?.userId) return null;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setPin("");
      setConfirmation("");
      setPrevious("");
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Device unlock</h2>
      <p>
        Protect this saved online profile on this device. A device PIN does not
        replace online authentication or extend offline access.
      </p>
      {!status.available && (
        <p role="status">
          {window.suiteDesktop
            ? "Protected storage is unavailable. Unlock it before changing device unlock settings."
            : "Browser storage is unavailable. Restore it before changing device unlock settings."}
        </p>
      )}
      <ErrorMessage error={error} />
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (pin !== confirmation) {
            setError(Error("The new device PINs do not match."));
            return;
          }
          void run(() =>
            capability.configureProfileLock(pin, biometric, previous),
          );
        }}
      >
        {status.enabled && (
          <Field label="Current device PIN">
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={previous}
              maxLength={12}
              disabled={busy || !status.available}
              onChange={(event) => setPrevious(event.target.value)}
            />
          </Field>
        )}
        <Field
          label={status.enabled ? "New device PIN" : "Device PIN"}
          hint="8 to 12 digits"
        >
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            pattern="[0-9]{8,12}"
            minLength={8}
            maxLength={12}
            required
            value={pin}
            disabled={busy || !status.available}
            onChange={(event) => setPin(event.target.value)}
          />
        </Field>
        <Field label="Confirm device PIN">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            pattern="[0-9]{8,12}"
            minLength={8}
            maxLength={12}
            required
            value={confirmation}
            disabled={busy || !status.available}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        {status.biometricAvailable ? (
          <label>
            <Checkbox
              checked={biometric}
              disabled={busy || !status.available}
              onCheckedChange={(value) => setBiometric(value === true)}
            />{" "}
            Use Touch ID to unlock this profile
          </label>
        ) : window.suiteDesktop ? (
          <p>Touch ID is unavailable on this device. Use a device PIN.</p>
        ) : null}
        <div className="actions">
          <Button type="submit" disabled={busy || !status.available}>
            {status.enabled ? "Update device unlock" : "Enable device unlock"}
          </Button>
          {status.enabled && (
            <>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void run(() => capability.lockProfile())}
              >
                Lock profile
              </Button>
              <Button
                type="button"
                disabled={busy || !status.available}
                onClick={() =>
                  void run(() => capability.removeProfileLock(previous))
                }
              >
                Remove device PIN
              </Button>
            </>
          )}
        </div>
      </form>
      {status.enabled &&
        status.canRecover &&
        status.recoveryExpiresAt > recoveryNow && (
          <div className="form-stack">
            <p>
              You recently signed in online. You can reset a forgotten device
              PIN without deleting saved work.
            </p>
            <Button
              disabled={busy || !status.available}
              onClick={() =>
                void run(() => capability.removeProfileLock(undefined, true))
              }
            >
              Reset forgotten device PIN
            </Button>
          </div>
        )}
    </section>
  );
}

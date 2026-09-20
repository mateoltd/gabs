import { useEffect, useRef, useState } from "react";
import {
  listRemovedLocalProfiles,
  restoreLocalProfile,
  subscribeLocalProfiles,
  type LocalSession,
} from "@suite/client/local-profiles";
import {
  Button,
  Empty,
  Loading,
  ErrorMessage,
  Field,
  Input,
  Modal,
  Select,
  SelectOption,
} from "@suite/ui-web";
import { useShellComposition } from "../../../app/composition";

export function ProfileRecovery({
  onRestore,
}: {
  onRestore: (session: LocalSession) => void;
}) {
  const { localProfiles } = useShellComposition();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<
    Awaited<ReturnType<typeof listRemovedLocalProfiles>>
  >([]);
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    let active = true,
      sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      void listRemovedLocalProfiles(localProfiles)
        .then((profiles) => {
          if (!active || request !== sequence) return;
          setProfiles(profiles);
          setId((current) => current || profiles[0]?.id || "");
          setLoaded(true);
        })
        .catch((error) => {
          if (active && request === sequence) {
            setError(error);
            setLoaded(true);
          }
        });
    };
    refresh();
    const stop = subscribeLocalProfiles(refresh, localProfiles);
    const hide = () => {
      if (document.visibilityState === "hidden") {
        pending.current?.abort();
        setPassword("");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      active = false;
      stop();
      pending.current?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [open]);
  const selected = profiles.find((profile) => profile.id === id);
  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setError(undefined);
          setLoaded(false);
          setId("");
          setOpen(true);
        }}
      >
        Removed profiles
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            pending.current?.abort();
            setPassword("");
          }
          setOpen(value);
        }}
        title="Removed profiles"
        description="Encrypted records and unfinished work are retained on this device. Restore a profile with its original passphrase."
      >
        <ErrorMessage error={error} />
        {!loaded ? (
          <Loading label="Loading removed profiles" />
        ) : !profiles.length ? (
          <Empty
            title="No removed profiles"
            description="Profiles you remove from this device’s list will appear here."
          />
        ) : (
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (pending.current || !selected) return;
              const controller = new AbortController();
              pending.current = controller;
              setBusy(true);
              setError(undefined);
              let restored: LocalSession | undefined;
              try {
                restored = await restoreLocalProfile(
                  selected.id,
                  password,
                  localProfiles,
                  controller.signal,
                );
                controller.signal.throwIfAborted();
                onRestore(restored);
                setOpen(false);
                setPassword("");
              } catch (error) {
                restored?.lock();
                if (!controller.signal.aborted) setError(error);
              } finally {
                if (pending.current === controller) pending.current = undefined;
                setBusy(false);
              }
            }}
          >
            <Field label="Removed profile">
              <Select
                value={selected?.id ?? ""}
                disabled={busy}
                onValueChange={(value) => {
                  setId(value);
                  setPassword("");
                  setError(undefined);
                }}
              >
                {profiles.map((profile) => (
                  <SelectOption key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectOption>
                ))}
              </Select>
            </Field>
            <Field label="Original passphrase">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !selected}
            >
              Restore and unlock profile
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}

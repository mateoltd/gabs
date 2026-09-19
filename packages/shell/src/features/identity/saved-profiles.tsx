import { takeProfileChooser } from "./profile-signin";
import { useEffect, useState } from "react";
import {
  Button,
  ErrorMessage,
  Field,
  Loading,
  Modal,
  Select,
  SelectOption,
} from "@suite/ui-web";
import {
  listOnlineProfiles,
  forgetOnlineProfile,
} from "@suite/client/online-profile-store";
import type { OnlineProfile } from "@suite/client/online-profiles";
export function SavedProfiles({
  busy,
  onSignIn,
}: {
  busy: boolean;
  onSignIn(profile: OnlineProfile): Promise<void>;
}) {
  const [open, setOpen] = useState(takeProfileChooser),
    [profiles, setProfiles] = useState<OnlineProfile[]>(),
    [selected, setSelected] = useState("");
  const [removing, setRemoving] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!open) return;
    let active = true;
    setProfiles(undefined);
    setConfirm(false);
    setError(undefined);
    void listOnlineProfiles()
      .then((value) => {
        if (!active) return;
        setProfiles(value);
        setSelected(value[0]?.id ?? "");
      })
      .catch((value) => {
        if (active) {
          setError(value);
          setProfiles([]);
        }
      });
    return () => {
      active = false;
    };
  }, [open]);
  const profile = profiles?.find((p) => p.id === selected);
  return (
    <>
      <button
        type="button"
        className="text-link"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        Saved online profiles
      </button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!removing && !busy) setOpen(value);
        }}
        title="Saved online profiles"
        description="Choose an account to sign in and verify its current access."
      >
        <ErrorMessage error={error} />
        {!profiles ? (
          <Loading />
        ) : !profiles.length ? (
          <p>
            No online profiles are saved on this device yet. Sign in to save
            one.
          </p>
        ) : (
          <>
            <Field label="Saved account">
              <Select
                value={selected}
                disabled={busy || removing}
                onValueChange={(value) => {
                  setSelected(value);
                  setConfirm(false);
                  setError(undefined);
                }}
              >
                {profiles.map((profile) => (
                  <SelectOption key={profile.id} value={profile.id}>
                    {profile.name}
                    {profile.email ? ` (${profile.email})` : ""}
                  </SelectOption>
                ))}
              </Select>
            </Field>
            {confirm ? (
              <>
                <p>
                  Remove this saved sign-in? Its downloaded records and
                  unfinished work stay on this device. Signing in again can
                  recover them under current permissions.
                </p>
                <div className="actions">
                  <Button disabled={removing} onClick={() => setConfirm(false)}>
                    Keep profile
                  </Button>
                  <Button
                    disabled={removing || !profile}
                    onClick={async () => {
                      if (!profile) return;
                      setRemoving(true);
                      setError(undefined);
                      try {
                        await forgetOnlineProfile(profile.id);
                        const next = await listOnlineProfiles();
                        setProfiles(next);
                        setSelected(next[0]?.id ?? "");
                        setConfirm(false);
                      } catch (error) {
                        setError(error);
                      } finally {
                        setRemoving(false);
                      }
                    }}
                  >
                    Remove saved sign-in
                  </Button>
                </div>
              </>
            ) : (
              <div className="actions">
                <Button
                  disabled={busy || !profile}
                  onClick={async () => {
                    if (!profile) return;
                    setOpen(false);
                    await onSignIn(profile);
                  }}
                >
                  Continue with this account
                </Button>
                <Button
                  disabled={busy || !profile}
                  onClick={() => setConfirm(true)}
                >
                  Forget this profile
                </Button>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

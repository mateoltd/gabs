import { type FeatureProps } from "@suite/client";
import {
  Button,
  ErrorMessage,
  Field,
  Input,
  PageHeading,
  Select,
  SelectOption,
  useToast,
} from "@suite/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
export function Settings(
  props: FeatureProps & {
    toggleOffline: () => Promise<void>;
    theme: string;
    setTheme: (theme: string) => void;
    children?: ReactNode;
  },
) {
  const toast = useToast();
  const {
    client,
    scope,
    bootstrap,
    theme,
    setTheme,
    toggleOffline,
    offlineEnabled,
  } = props;
  const [name, setName] = useState(bootstrap.workspace.name),
    [hours, setHours] = useState(String(bootstrap.offlineHours)),
    [accent, setAccent] = useState(bootstrap.workspace.accent ?? "forest"),
    [logoDataUrl, setLogo] = useState(bootstrap.workspace.logoDataUrl ?? ""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  return (
    <>
      <PageHeading
        title="Settings"
        description="Appearance, offline access, and workspace preferences."
      />
      {!props.online && (
        <p className="small">
          Device preferences and authorized local networking remain available.
          Connect to manage workspace policy and billing.
        </p>
      )}
      <div className="settings-grid">
        <section className="panel">
          <h2>Appearance</h2>
          <p>Your preferences stay with this browser or desktop application.</p>
          <Field label="Theme">
            <Select value={theme} onValueChange={(e) => setTheme(e)}>
              <SelectOption value="high-contrast">High contrast</SelectOption>
              <SelectOption value="system">Use system appearance</SelectOption>
              <SelectOption value="light">Light</SelectOption>
              <SelectOption value="dark">Dark</SelectOption>
            </Select>
          </Field>
        </section>
        <section className="panel">
          <h2>Offline work on this device</h2>
          <p>
            {bootstrap.offlineHours
              ? "Keep a limited cache and order drafts available for up to 24 hours after authorization."
              : "The workspace administrator has disabled offline storage."}
          </p>
          <Button
            disabled={
              !bootstrap.offlineHours ||
              busy ||
              (!props.online && !offlineEnabled)
            }
            onClick={async () => {
              try {
                await toggleOffline();
              } catch (e) {
                setError(e);
              }
            }}
          >
            {offlineEnabled
              ? "Disable offline storage"
              : "Enable on this device"}
          </Button>
          <p className="small settings-note">
            Local drafts are not a backup. Signing out removes local workspace
            data.
          </p>
        </section>
        {props.online && bootstrap.permissions.includes("workspace.manage") && (
          <section className="panel">
            <h2>Workspace policy</h2>
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(undefined);
                try {
                  await client.request({
                    operation: "workspaceEdit",
                    params: { workspaceId: scope.workspaceId },
                    body: { name, offlineHours: hours, accent, logoDataUrl },
                  });
                  await qc.invalidateQueries({
                    queryKey: [scope.userId, scope.workspaceId, "bootstrap"],
                  });
                  toast.add({
                    title: "Workspace policy saved.",
                    type: "success",
                  });
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Workspace name">
                <Input
                  required
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Workspace accent">
                <Select
                  value={accent}
                  onValueChange={(e) => setAccent(e as typeof accent)}
                >
                  <SelectOption value="forest">Forest</SelectOption>
                  <SelectOption value="blue">Blue</SelectOption>
                  <SelectOption value="plum">Plum</SelectOption>
                </Select>
              </Field>
              <Field label="Company logo" hint="PNG, up to 36 KB.">
                <Input
                  type="file"
                  accept="image/png"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 36000 || file.type !== "image/png") {
                      setError(new Error("Choose a PNG logo up to 36 KB."));
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => setLogo(String(reader.result));
                    reader.onerror = () =>
                      setError(new Error("The logo could not be read."));
                    reader.readAsDataURL(file);
                  }}
                />
              </Field>
              {!!logoDataUrl && (
                <Button type="button" onClick={() => setLogo("")}>
                  Remove logo
                </Button>
              )}
              <Field label="Company offline access">
                <Select value={hours} onValueChange={(e) => setHours(e)}>
                  <SelectOption value="0">Disabled</SelectOption>
                  <SelectOption value="24">
                    Allow a 24-hour offline window
                  </SelectOption>
                </Select>
              </Field>
              <Button type="submit" variant="primary" disabled={busy}>
                Save workspace policy
              </Button>
            </form>
          </section>
        )}
        {props.children}
      </div>
      <ErrorMessage error={error} />
    </>
  );
}

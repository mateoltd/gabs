import type { FeatureProps } from "@suite/client";
import type {
  ModuleReleaseIssue,
  ModuleRollout,
  PlatformState,
} from "@suite/module-sdk/platform";
import { compareVersions } from "@suite/module-sdk/registry";
import {
  Badge,
  Button,
  Checkbox,
  ErrorMessage,
  Field,
  Modal,
  Select,
  SelectOption,
} from "@suite/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import "./module-release-recovery.css";

/** Recovery controls never render historical declarations as a current executable module. */
export function ModuleReleaseRecovery(
  props: FeatureProps & {
    state: PlatformState;
    renderAccess?: (moduleId: string) => ReactNode;
  },
) {
  const qc = useQueryClient();
  const admin = props.bootstrap.permissions.includes("modules.manage");
  const [selected, setSelected] = useState<ModuleReleaseIssue>();
  const [pin, setPin] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const releases = props.state.releases
    .filter((r) => r.module_id === selected?.moduleId)
    .map((r) => r.version)
    .sort((a, b) => compareVersions(b, a));
  const open = (issue: ModuleReleaseIssue) => {
    const saved = props.state.settings.find(
      (s) => s.key === `pin:${issue.moduleId}`,
    );
    setPin(String(saved?.value.version ?? ""));
    setMandatory(saved?.value.mandatory !== false);
    setAccepted(
      Array.isArray(saved?.value.acceptedVersions)
        ? saved.value.acceptedVersions.filter(
            (v): v is string => typeof v === "string",
          )
        : [],
    );
    setVersion(saved?.version ?? 0);
    setAttempt(undefined);
    setError(undefined);
    setSelected(issue);
  };
  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    const key = attempt ?? crypto.randomUUID();
    setAttempt(key);
    const value: ModuleRollout = {
      moduleId: selected.moduleId,
      version: pin,
      mandatory,
      acceptedVersions: mandatory ? [] : accepted.filter((v) => v !== pin),
    };
    try {
      await props.client.request({
        operation: "platformCommand",
        params: { workspaceId: props.scope.workspaceId },
        body: { action: "rollout", value, version },
        idempotencyKey: key,
      });
      await qc.invalidateQueries({
        queryKey: [props.scope.userId, props.scope.workspaceId],
      });
      setSelected(undefined);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!!props.state.unavailableModules?.length && (
        <section
          className="module-release-recovery"
          aria-label="Modules needing attention"
        >
          <h2 className="section-heading">Modules needing attention</h2>
          <div className="module-grid">
            {props.state.unavailableModules.map((issue) => (
              <section
                key={issue.moduleId}
                className="panel module-install-card"
              >
                <h3>{issue.name}</h3>
                <div>
                  <Badge>Release unavailable</Badge>
                </div>
                <p className="module-card-description">{issue.message}</p>
                <p className="small">
                  Saved work is preserved. Server operations require a
                  compatible release.
                </p>
                <div className="actions">
                  {admin && (
                    <Button
                      disabled={!props.online}
                      onClick={() => open(issue)}
                    >
                      Review update policy
                    </Button>
                  )}
                  {props.bootstrap.permissions.includes("roles.manage") && (
                    <Link to={`/organization?module=${issue.moduleId}`}>
                      Permissions
                    </Link>
                  )}
                </div>
                {props.renderAccess && (
                  <div className="module-card-footer">
                    {props.renderAccess(issue.moduleId)}
                  </div>
                )}
              </section>
            ))}
          </div>
        </section>
      )}
      <Modal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(undefined);
        }}
        title={`Review ${selected?.name ?? "module"} release`}
        description="Choose a published version or follow the current release. The server verifies compatibility before saving."
      >
        <div className="form-stack">
          <ErrorMessage error={error} />
          <Field label="Pinned release">
            <Select
              value={pin}
              disabled={busy}
              onValueChange={(value) => {
                setPin(value ?? "");
                setAttempt(undefined);
              }}
            >
              <SelectOption value="">Follow current release</SelectOption>
              {pin && !releases.includes(pin) && (
                <SelectOption value={pin} disabled>
                  {pin} (unavailable)
                </SelectOption>
              )}
              {releases.map((value) => (
                <SelectOption key={value} value={value}>
                  {value}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <Field label="Require selected release">
            <Checkbox
              disabled={busy}
              checked={mandatory}
              onCheckedChange={(value) => {
                setMandatory(!!value);
                setAttempt(undefined);
              }}
            />
          </Field>
          {!mandatory && (
            <section
              aria-label="Other accepted releases"
              className="form-stack"
            >
              <h3>Other accepted releases</h3>
              {[...new Set([...releases, ...accepted])]
                .filter((v) => v !== pin)
                .map((value) => (
                  <Field
                    key={value}
                    label={`Accept ${value}${releases.includes(value) ? "" : " (unavailable)"}`}
                  >
                    <Checkbox
                      disabled={busy}
                      checked={accepted.includes(value)}
                      onCheckedChange={(checked) => {
                        setAccepted((old) =>
                          checked
                            ? [...old, value]
                            : old.filter((v) => v !== value),
                        );
                        setAttempt(undefined);
                      }}
                    />
                  </Field>
                ))}
            </section>
          )}
          <p>
            Existing offline leases expire normally. Pending work remains
            available for review after recovery.
          </p>
          <Button disabled={busy || !props.online} onClick={() => void save()}>
            {busy ? "Saving…" : "Save update policy"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

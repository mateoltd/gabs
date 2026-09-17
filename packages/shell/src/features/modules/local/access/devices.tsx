import { useEffect, useId, useState } from "react";
import {
  localCapabilityAccess,
  type LocalSession,
} from "@suite/client/local-profiles";
import type { HostCapabilityKind } from "@suite/module-sdk/host-capabilities";
import { Button, Checkbox, Empty, ErrorMessage } from "@suite/ui-web";
import { useShellComposition } from "../../../../app/composition";

const actions = {
  "files.export": "export files",
  "notifications.show": "show notifications",
  "lan.status": "read local network status",
  "lan.relay": "relay data to local network peers",
} satisfies Record<HostCapabilityKind, string>;

export function LocalDeviceAccess({
  session,
  changed,
  back,
}: {
  session: LocalSession;
  changed: () => void;
  back: () => void;
}) {
  const { catalog } = useShellComposition();
  const descriptionId = useId();
  const [choices, setChoices] =
    useState<Awaited<ReturnType<typeof localCapabilityAccess>>>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true);
    setVerificationError(undefined);
    void localCapabilityAccess(session.data, catalog).then(
      (value) => {
        if (current) {
          setChoices(value);
          setLoading(false);
        }
      },
      (error: unknown) => {
        if (current) {
          setChoices(undefined);
          setVerificationError(error);
          setLoading(false);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [session, catalog, revision]);
  // Saved consent must remain revocable even when its package cannot be verified.
  const retained = (session.data.capabilityGrants ?? []).filter(
    (grant) => !choices?.some((choice) => choice.grant?.id === grant.id),
  );
  async function save(moduleId: string, alias: string, allowed: boolean) {
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await session.setCapabilityAccess(moduleId, alias, allowed);
      setLoading(true);
      setRevision((value) => value + 1);
      setNotice(allowed ? "Device access saved." : "Device access revoked.");
      changed();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-stack">
      <h3>Device access</h3>
      <p>
        Choose which device actions installed modules may request in this
        profile. Access applies to the listed release; review it again after an
        update. Device and operating system permissions still apply.
      </p>
      <ErrorMessage error={error ?? verificationError} />
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Verifying installed device declarations…</p>}
      {choices?.length ? (
        <ul className="local-installations" aria-label="Local device grants">
          {choices.map(({ module, capability, declaration, granted }) => (
            <li key={`${module.id}/${capability}`}>
              <label className="local-reference-choice">
                <Checkbox
                  aria-describedby={`${descriptionId}-${module.id}-${capability}`}
                  checked={granted}
                  disabled={busy || loading}
                  onCheckedChange={(allowed) =>
                    void save(module.id, capability, allowed)
                  }
                />
                <span>
                  Allow {module.name} to {actions[declaration.kind]}
                </span>
              </label>
              <p
                id={`${descriptionId}-${module.id}-${capability}`}
                className="small muted"
              >
                Version {module.version}. Capability: {capability}. Permission:{" "}
                {declaration.permission}.
              </p>
            </li>
          ))}
        </ul>
      ) : !loading && !verificationError ? (
        <Empty
          title="No device access needed"
          description="No installed standalone module declares a device capability."
        />
      ) : verificationError ? (
        <p>
          Device declarations could not be verified. Repair the installation
          before granting access. You can still revoke saved access below.
        </p>
      ) : null}
      {!loading && retained.length > 0 && (
        <section className="form-stack" aria-label="Saved device access">
          <h4>Saved access requiring review</h4>
          <ul className="local-installations">
            {retained.map((grant) => (
              <li key={grant.id}>
                <p>
                  {grant.moduleId} {grant.moduleVersion}: {grant.capability}
                </p>
                <Button
                  disabled={busy || loading}
                  onClick={() =>
                    void save(grant.moduleId, grant.capability, false)
                  }
                >
                  Revoke {grant.moduleId}: {grant.capability}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Button disabled={busy} onClick={back}>
        Back to modules
      </Button>
    </div>
  );
}

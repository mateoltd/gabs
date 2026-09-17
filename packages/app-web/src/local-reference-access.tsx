import { useState } from "react";
import {
  localReferenceAccess,
  type LocalSession,
} from "@suite/platform/local-profiles";
import { Button, Checkbox, Empty, ErrorMessage } from "@suite/ui-web";

export function LocalReferenceAccess({
  session,
  changed,
  back,
}: {
  session: LocalSession;
  changed: () => void;
  back: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const choices = localReferenceAccess(session.data);
  return (
    <div className="form-stack">
      <h3>Reference access</h3>
      <p>
        Choose which records a module may use as references in this profile.
        Access applies to the listed releases; review it again after either
        module updates.
      </p>
      <ErrorMessage error={error} />
      {choices.length ? (
        <ul className="local-installations" aria-label="Local reference grants">
          {choices.map(({ consumer, provider, resource, granted }) => {
            const label = `Allow ${consumer.name} to read ${provider.name}: ${provider.resources[resource].title}`;
            return (
              <li key={`${consumer.id}/${provider.id}/${resource}`}>
                <label className="local-reference-choice">
                  <Checkbox
                    checked={granted}
                    disabled={busy}
                    onCheckedChange={(allowed) => {
                      setBusy(true);
                      setError(undefined);
                      void session
                        .setReferenceAccess(
                          consumer.id,
                          provider.id,
                          resource,
                          allowed,
                        )
                        .then(changed)
                        .catch(setError)
                        .finally(() => setBusy(false));
                    }}
                  />
                  <span>{label}</span>
                </label>
                <p className="small muted">
                  {consumer.name} {consumer.version} reads {provider.name}{" "}
                  {provider.version}.
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          title="No reference access needed"
          description="No installed module declares a reference to another standalone resource."
        />
      )}
      <Button disabled={busy} onClick={back}>
        Back to modules
      </Button>
    </div>
  );
}

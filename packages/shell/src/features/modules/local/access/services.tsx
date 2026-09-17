import { useState } from "react";
import {
  localServiceAccess,
  type LocalSession,
} from "@suite/client/local-profiles";
import { Button, Checkbox, Empty, ErrorMessage } from "@suite/ui-web";
import { useShellComposition } from "../../../../app/composition";

export function LocalServiceAccess({
  session,
  changed,
  back,
}: {
  session: LocalSession;
  changed: () => void;
  back: () => void;
}) {
  const { catalog } = useShellComposition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const choices = localServiceAccess(session.data, catalog);
  return (
    <div className="form-stack">
      <h3>Service access</h3>
      <p>
        Choose which actions a module may run in another module in this profile.
        Access applies to the listed releases; review it again after either
        module updates.
      </p>
      <ErrorMessage error={error} />
      {choices.length ? (
        <ul className="local-installations" aria-label="Local service grants">
          {choices.map(
            ({ consumer, provider, service, operation, granted }) => {
              const label = `Allow ${consumer.name} to run ${provider.name}: ${provider.operations[operation].title}`;
              return (
                <li key={`${consumer.id}/${provider.id}/${service}`}>
                  <label className="local-reference-choice">
                    <Checkbox
                      checked={granted}
                      disabled={busy}
                      onCheckedChange={(allowed) => {
                        setBusy(true);
                        setError(undefined);
                        void session
                          .setServiceAccess(consumer.id, service, allowed)
                          .then(changed)
                          .catch(setError)
                          .finally(() => setBusy(false));
                      }}
                    />
                    <span>{label}</span>
                  </label>
                  <p className="small muted">
                    {consumer.name} {consumer.version} calls {provider.name}{" "}
                    {provider.version}.
                  </p>
                </li>
              );
            },
          )}
        </ul>
      ) : (
        <Empty
          title="No service access needed"
          description="No installed module declares a compatible public standalone service."
        />
      )}
      <Button disabled={busy} onClick={back}>
        Back to modules
      </Button>
    </div>
  );
}

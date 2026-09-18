import { useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import { Button, ErrorMessage } from "@suite/ui-web";
import module from "./module";
export default defineView(module, ({ host, scope }) => {
  const [status, setStatus] = useState("Ready"),
    [error, setError] = useState<unknown>(),
    [peer, setPeer] = useState<string>(),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(undefined);
    try {
      setStatus(await action());
    } catch (error) {
      setStatus("Action needs attention");
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function relay(moduleId: string) {
    if (!peer) throw Error("Inspect the local network first.");
    const id = crypto.randomUUID();
    const result = await host.call("relay", {
      peerId: peer,
      kind: "pending",
      id,
      payload: JSON.stringify({
        ...scope,
        id,
        state: "pending",
        dependencies: [],
        call: {
          moduleId,
          moduleVersion: module.version,
          resource: "notes",
          action: "create",
          input: { data: { text: "Transferred draft" } },
        },
      }),
    });
    return result.relayed && !result.authoritative
      ? "Draft transferred; server acceptance required"
      : "Transfer not accepted";
  }
  return (
    <section aria-label="Module local network">
      <h2>Local network</h2>
      <p role="status">{status}</p>
      <ErrorMessage error={error} />
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await host.call("peers", {});
              setPeer(result.peers[0]?.id);
              return result.enabled
                ? `${result.peers.length} authorized peers`
                : "Local network disabled";
            })
          }
        >
          Inspect local network
        </Button>
        <Button
          disabled={busy || !peer}
          onClick={() => void run(() => relay(module.id))}
        >
          Transfer draft
        </Button>
        <Button
          disabled={busy || !peer}
          onClick={() => void run(() => relay("foreign-module"))}
        >
          Try foreign module
        </Button>
      </div>
    </section>
  );
});

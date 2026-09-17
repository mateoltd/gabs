import { useState } from "react";
import { defineView } from "@suite/module-sdk/ui";
import { Button, ErrorMessage } from "@suite/ui-web";
import module from "./module";
export default defineView(module, ({ host }) => {
  const [status, setStatus] = useState("Ready"),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(undefined);
    setStatus("Working");
    try {
      setStatus(await action());
    } catch (error) {
      setStatus("Action needs attention");
      setError(error);
    } finally {
      setBusy(false);
      document.dispatchEvent(new Event("host-fixture-complete"));
    }
  }
  return (
    <section aria-label="Module host actions">
      <h2>Host actions</h2>
      <p role="status">{status}</p>
      <ErrorMessage error={error} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await host.call("export", {
                filename: "module-notes.txt",
                content: "Exported through the typed module host\n",
              });
              return result.status === "saved"
                ? "Export saved"
                : result.status === "offered"
                  ? "Download offered"
                  : "Export cancelled";
            })
          }
        >
          Export notes
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await host.call("notify", {
                title: "Module notice",
                message: "Authorized host action",
              });
              return result.requested
                ? "Notification requested"
                : "Notifications unavailable";
            })
          }
        >
          Show notification
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await host.call("peers", {});
              return result.enabled
                ? `${result.peers.length} network peers`
                : "Local network disabled";
            })
          }
        >
          Inspect local network
        </Button>
      </div>
    </section>
  );
});

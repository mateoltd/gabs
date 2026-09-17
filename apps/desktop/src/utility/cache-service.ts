import { utilityProcess, type UtilityProcess } from "electron";
import { resolve } from "node:path";
let worker: UtilityProcess | undefined,
  ready: Promise<void> | undefined,
  sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function send(action: string, args: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    if (!worker) return reject(Error("Protected storage is unavailable."));
    const id = ++sequence,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Protected storage timed out."));
      }, 15000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, action, ...args });
  });
}
export function openCache(path: string, secret: string) {
  return (ready ??= (async () => {
    worker = utilityProcess.fork(resolve(__dirname, "cache-worker.cjs"), [], {
      serviceName: "Common protected storage",
      stdio: "pipe",
    });
    worker.on(
      "message",
      (message: { id: number; value?: unknown; error?: string }) => {
        const entry = pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(message.id);
        if (message.error) entry.reject(Error(message.error));
        else entry.resolve(message.value);
      },
    );
    worker.on("exit", () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(
          Error("Protected storage stopped. Reopen the application."),
        );
      }
      pending.clear();
      worker = undefined;
      ready = undefined;
    });
    await send("open", { path, secret });
  })());
}
export const cacheRead = (key: string) => send("read", { key });
export const cacheWrite = (key: string, value: unknown) =>
  send("write", { key, value });
export const cachePurge = (key: string) => send("purge", { key });

export const cachePruneArtifacts = (key: string, keep: string[]) =>
  send("prune-artifacts", { key, keep });

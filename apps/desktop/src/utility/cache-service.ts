import type { LocalUnlockProtection } from "@suite/client/vault-engine";
import type {
  LocalVaultRequest,
  NativeVaultChange,
} from "@suite/client/vault-protocol";
import { utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
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
let vaultProtection: LocalUnlockProtection | undefined;
let vaultChanged: ((change: NativeVaultChange) => void) | undefined;
export function setVaultHost(
  protection: LocalUnlockProtection,
  changed: (change: NativeVaultChange) => void,
) {
  vaultProtection = protection;
  vaultChanged = changed;
}
export function openCache(path: string, secret: string) {
  return (ready ??= (async () => {
    const session = randomUUID();
    const target = utilityProcess.fork(
      resolve(__dirname, "cache-worker.cjs"),
      [],
      {
        serviceName: "Common protected storage",
        stdio: "pipe",
      },
    );
    worker = target;
    target.on(
      "message",
      async (message: {
        id: number;
        value?: unknown;
        error?: string;
        code?: string;
        vaultChanged?: NativeVaultChange;
        protectionId?: number;
        method?: string;
        args?: unknown[];
      }) => {
        if (message.vaultChanged) {
          vaultChanged?.(message.vaultChanged);
          return;
        }
        if (message.protectionId !== undefined) {
          if (worker !== target) return;
          try {
            if (!vaultProtection)
              throw Error("Protected unlock is unavailable.");
            const args = message.args ?? [];
            let value: unknown;
            if (message.method === "status")
              value = await vaultProtection.status();
            else if (message.method === "seal")
              value = await vaultProtection.seal(
                args[0] as Parameters<LocalUnlockProtection["seal"]>[0],
                args[1] as number[],
              );
            else if (message.method === "open")
              value = await vaultProtection.open(
                args[0] as Parameters<LocalUnlockProtection["open"]>[0],
                args[1] as string,
              );
            else throw Error("Invalid protected unlock method.");
            if (worker === target)
              target.postMessage({
                protectionResult: message.protectionId,
                value,
              });
          } catch (error) {
            if (worker === target)
              target.postMessage({
                protectionResult: message.protectionId,
                error:
                  error instanceof Error
                    ? error.message
                    : "Protected unlock failed.",
              });
          }
          return;
        }
        if (worker !== target) return;
        const entry = pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(message.id);
        if (message.error)
          entry.reject(
            Object.assign(Error(message.error), { code: message.code }),
          );
        else entry.resolve(message.value);
      },
    );
    target.on("exit", () => {
      vaultChanged?.({ closed: true, session });
      if (worker !== target) return;
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
    try {
      await send("open", { path, secret, session });
    } catch (error) {
      if (worker === target) target.kill();
      throw error;
    }
  })());
}
export const cacheRead = (key: string) => send("read", { key });
export const cacheWrite = (key: string, value: unknown) =>
  send("write", { key, value });
export const cachePurge = (key: string) => send("purge", { key });
export const cachePurgeWorkspace = (key: string) =>
  send("purge-workspace", { key });

export const cachePruneArtifacts = (key: string, keep: string[]) =>
  send("prune-artifacts", { key, keep });

export const cacheVerifyLanPackage = (
  key: string,
  transfer: import("@suite/module-sdk/relay-artifacts").ArtifactTransfer,
  metadata: import("@suite/module-sdk/platform").ArtifactMetadata,
  publicKey: string,
) =>
  send("verify-lan-package", { key, transfer, metadata, publicKey }) as Promise<
    import("@suite/module-sdk/platform").SignedArtifact
  >;

export const cacheVaultRequest = (
  requestId: string,
  request: LocalVaultRequest,
) => send("vault", { requestId, request });
export const cacheVaultCancel = (requestId: string) =>
  worker?.postMessage({ action: "vault-cancel", requestId });
export const cacheVaultCloseAll = () =>
  worker?.postMessage({ action: "vault-close-all" });

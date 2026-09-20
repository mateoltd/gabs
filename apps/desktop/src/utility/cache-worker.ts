import { stageLocalBackup, type LocalBackupSource } from "./storage/backup";
import { AsyncLocalStorage } from "node:async_hooks";
import { NativeVaultSessions } from "./storage/vault-sessions";
import { localVaultStore, importLocalVaults } from "./storage/local-vaults";
import {
  assertLocalVaultRequest,
  type LocalVaultRequest,
} from "@suite/client/vault-protocol";
import type { LocalUnlockProtection } from "@suite/client/vault-engine";
import { openProtectedDatabase } from "./storage/database";
import { openCacheValue, sealCacheValue } from "./storage/cipher";
import {
  stageDatabaseRotation,
  verifyProtectedDatabase,
} from "./storage/rotation";
import type { StorageRotationSource } from "./storage/rotation";
import { verifyLanPackage } from "./lan-package";
import type { ArtifactTransfer } from "@suite/module-sdk/relay-artifacts";
import type { ArtifactMetadata } from "@suite/module-sdk/platform";
import {
  assertWorkspacePurgeable,
  assertWorkspaceCacheWrite,
  disabledWorkspaceAuthority,
  StorageRetentionError,
} from "@suite/client/storage-retention";
let db: ReturnType<typeof openProtectedDatabase> | undefined,
  key: Buffer | undefined;
function write(cacheKey: string, value: unknown) {
  db!
    .prepare(
      "INSERT INTO cache(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
    )
    .run(
      cacheKey,
      sealCacheValue(key!, cacheKey, Buffer.from(JSON.stringify(value))),
    );
}
function purge(prefix: string) {
  db!
    .prepare("DELETE FROM cache WHERE key LIKE ? ESCAPE '\\'")
    .run(prefix.replace(/[\\%_]/g, "\\$&") + "/%");
}
function read(cacheKey: string): unknown {
  const row = db!
    .prepare("SELECT payload FROM cache WHERE key=?")
    .get(cacheKey) as { payload: Uint8Array } | undefined;
  if (!row) return;
  return decrypt(cacheKey, row.payload);
}
function decrypt(cacheKey: string, payload: Uint8Array): unknown {
  const plaintext = openCacheValue(key!, cacheKey, payload);
  try {
    return JSON.parse(plaintext.toString("utf8"));
  } finally {
    plaintext.fill(0);
  }
}
let vaults: NativeVaultSessions | undefined;
const vaultRequests = new Map<string, AbortController>();
const vaultContext = new AsyncLocalStorage<AbortSignal>();
let protectionSequence = 0;
const protectionPending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
function protect(method: keyof LocalUnlockProtection, args: unknown[]) {
  return new Promise<unknown>((resolve, reject) => {
    const protectionId = ++protectionSequence;
    const signal = vaultContext.getStore();
    const finish = () => {
      protectionPending.delete(protectionId);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(Error("Local unlock was cancelled."));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    protectionPending.set(protectionId, {
      resolve: (value) => {
        finish();
        resolve(value);
      },
      reject: (error) => {
        finish();
        reject(error);
      },
    });
    process.parentPort.postMessage({ protectionId, method, args });
  });
}
const protection: LocalUnlockProtection = {
  status: () =>
    protect("status", []) as ReturnType<LocalUnlockProtection["status"]>,
  seal: (...args) => protect("seal", args) as Promise<string>,
  open: (...args) => protect("open", args) as Promise<number[]>,
  renew: (...args) => protect("renew", args) as Promise<string>,
};
process.parentPort.on("message", async (event) => {
  if (event.data?.protectionResult !== undefined) {
    const pending = protectionPending.get(event.data.protectionResult);
    protectionPending.delete(event.data.protectionResult);
    if (event.data.error) pending?.reject(Error(event.data.error));
    else pending?.resolve(event.data.value);
    return;
  }
  if (event.data?.action === "vault-cancel") {
    vaultRequests.get(event.data.requestId)?.abort();
    vaults?.cancel(event.data.requestId);
    return;
  }
  if (event.data?.action === "vault-close-all") {
    for (const request of vaultRequests.values()) request.abort();
    vaults?.close();
    return;
  }
  const message = event.data as {
    id: number;
    action:
      | "vault"
      | "open"
      | "read"
      | "write"
      | "purge"
      | "purge-workspace"
      | "prune-artifacts"
      | "verify-lan-package";
    requestId?: string;
    request?: LocalVaultRequest;
    path?: string;
    secret?: string;
    rotation?: StorageRotationSource;
    backup?: LocalBackupSource;
    verify?: boolean;
    key?: string;
    value?: unknown;
    keep?: string[];
    transfer?: ArtifactTransfer;
    metadata?: ArtifactMetadata;
    publicKey?: string;
    session?: string;
  };
  try {
    if (message.action === "open") {
      if (db) throw Error("Storage is already open.");
      if (
        typeof message.session !== "string" ||
        !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
          message.session,
        )
      )
        throw Error("Invalid storage session.");
      key = Buffer.from(message.secret!, "base64");
      if (key.length !== 32) throw Error("Invalid storage key.");
      if (message.backup) {
        if (message.rotation) throw Error("Choose one storage copy operation.");
        const sourceKey = Buffer.from(message.backup.sourceSecret, "base64");
        try {
          stageLocalBackup(
            message.backup.sourcePath,
            sourceKey,
            message.path!,
            key,
          );
        } finally {
          sourceKey.fill(0);
        }
        // Snapshot maintenance leaves the file closed. Do not reopen it in WAL mode or
        // initialize ordinary vault sessions before main streams the completed snapshot.
        process.parentPort.postMessage({ id: message.id, value: true });
        return;
      }
      if (message.rotation) {
        const sourceKey = Buffer.from(message.rotation.sourceSecret, "base64");
        try {
          stageDatabaseRotation(
            message.rotation.sourcePath,
            sourceKey,
            message.path!,
            key,
          );
        } finally {
          sourceKey.fill(0);
        }
      }
      db = openProtectedDatabase(message.path!, key, (row) => {
        decrypt(row.key, row.payload);
      });
      if (message.verify) verifyProtectedDatabase(db, key);
      vaults = new NativeVaultSessions(
        localVaultStore(db, (id) =>
          process.parentPort.postMessage({
            vaultChanged: {
              session: vaults!.session,
              id,
              generation: vaults!.generation,
            },
          }),
        ),
        protection,
        async (vaults) => importLocalVaults(db!, vaults),
        message.session,
      );
      process.parentPort.postMessage({ id: message.id, value: true });
      return;
    }
    if (!db || !key) throw Error("Storage is unavailable.");
    if (message.action === "vault") {
      if (!message.requestId || vaultRequests.has(message.requestId))
        throw Error("Invalid local vault request identifier.");
      assertLocalVaultRequest(message.request);
      const controller = new AbortController();
      vaultRequests.set(message.requestId, controller);
      try {
        const value = await vaultContext.run(controller.signal, () =>
          vaults!.run(message.request!, controller.signal, message.requestId),
        );
        process.parentPort.postMessage({ id: message.id, value });
      } finally {
        vaultRequests.delete(message.requestId);
      }
      return;
    }
    if (!message.key || message.key.includes(".."))
      throw Error("Invalid cache key.");
    let value: unknown;
    if (message.action === "write") {
      const [userId, workspaceId, kind, rest] = message.key.split("/");
      if (workspaceId && kind && !rest)
        assertWorkspaceCacheWrite(
          read(`${userId}/${workspaceId}/workspace-authority`),
          kind,
          message.value,
        );
      write(message.key, message.value);
      value = true;
    } else if (message.action === "purge-workspace") {
      if (message.key.split("/").length !== 2)
        throw Error("A workspace scope is required.");
      db.exec("BEGIN IMMEDIATE");
      try {
        assertWorkspacePurgeable({
          drafts: read(`${message.key}/drafts`),
          pending: read(`${message.key}/pending`),
          modules: read(`${message.key}/module-state`),
          inbox: read(`${message.key}/relay-inbox`),
        });
        purge(message.key);
        write(
          `${message.key}/workspace-authority`,
          disabledWorkspaceAuthority(),
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      value = true;
    } else if (message.action === "read") {
      value = read(message.key);
    } else if (message.action === "verify-lan-package") {
      value = await verifyLanPackage(
        (index) => read(`${message.key}/${index}`),
        message.transfer!,
        message.metadata!,
        message.publicKey!,
      );
    } else if (message.action === "prune-artifacts") {
      const retained = new Set(message.keep);
      const rows = db
        .prepare("SELECT key FROM cache WHERE substr(key,1,?)=?")
        .all(message.key.length, message.key) as { key: string }[];
      db.exec("BEGIN IMMEDIATE");
      try {
        const remove = db.prepare("DELETE FROM cache WHERE key=?");
        for (const row of rows) if (!retained.has(row.key)) remove.run(row.key);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      value = true;
    } else if (message.action === "purge") {
      purge(message.key);
      value = true;
    } else throw Error("Unknown storage operation.");
    process.parentPort.postMessage({ id: message.id, value });
  } catch (error) {
    process.parentPort.postMessage({
      id: message.id,
      code: error instanceof Error && "code" in error ? error.code : undefined,
      error:
        message.action === "vault" && error instanceof Error
          ? error.message
          : error instanceof StorageRetentionError
            ? error.message
            : "Protected storage operation failed.",
    });
  }
});

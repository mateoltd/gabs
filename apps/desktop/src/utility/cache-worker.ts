import { openProtectedDatabase } from "./storage/database";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key!, iv);
  cipher.setAAD(Buffer.from(cacheKey));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  db!
    .prepare(
      "INSERT INTO cache(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
    )
    .run(cacheKey, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
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
  const bytes = Buffer.from(payload),
    cipher = createDecipheriv("aes-256-gcm", key!, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(cacheKey));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  );
}
process.parentPort.on("message", async (event) => {
  const message = event.data as {
    id: number;
    action:
      | "open"
      | "read"
      | "write"
      | "purge"
      | "purge-workspace"
      | "prune-artifacts"
      | "verify-lan-package";
    path?: string;
    secret?: string;
    key?: string;
    value?: unknown;
    keep?: string[];
    transfer?: ArtifactTransfer;
    metadata?: ArtifactMetadata;
    publicKey?: string;
  };
  try {
    if (message.action === "open") {
      if (db) throw Error("Storage is already open.");
      key = Buffer.from(message.secret!, "base64");
      if (key.length !== 32) throw Error("Invalid storage key.");
      db = openProtectedDatabase(message.path!, key, (row) => {
        decrypt(row.key, row.payload);
      });
      process.parentPort.postMessage({ id: message.id, value: true });
      return;
    }
    if (!db || !key) throw Error("Storage is unavailable.");
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
      error:
        error instanceof StorageRetentionError
          ? error.message
          : "Protected storage operation failed.",
    });
  }
});

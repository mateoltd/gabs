import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
let db: DatabaseSync | undefined, key: Buffer | undefined;
process.parentPort.on("message", (event) => {
  const message = event.data as {
    id: number;
    action: "open" | "read" | "write" | "purge" | "prune-artifacts";
    path?: string;
    secret?: string;
    key?: string;
    value?: unknown;
    keep?: string[];
  };
  try {
    if (message.action === "open") {
      if (db) throw Error("Storage is already open.");
      key = Buffer.from(message.secret!, "base64");
      if (key.length !== 32) throw Error("Invalid storage key.");
      db = new DatabaseSync(message.path!);
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, payload BLOB NOT NULL)",
      );
      process.parentPort.postMessage({ id: message.id, value: true });
      return;
    }
    if (!db || !key) throw Error("Storage is unavailable.");
    if (!message.key || message.key.includes(".."))
      throw Error("Invalid cache key.");
    let value: unknown;
    if (message.action === "write") {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(message.key));
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(message.value), "utf8"),
        cipher.final(),
      ]);
      db.prepare(
        "INSERT INTO cache(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
      ).run(message.key, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
      value = true;
    } else if (message.action === "read") {
      const row = db
        .prepare("SELECT payload FROM cache WHERE key=?")
        .get(message.key) as { payload: Uint8Array } | undefined;
      if (row) {
        const bytes = Buffer.from(row.payload),
          cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        cipher.setAAD(Buffer.from(message.key));
        cipher.setAuthTag(bytes.subarray(12, 28));
        value = JSON.parse(
          Buffer.concat([
            cipher.update(bytes.subarray(28)),
            cipher.final(),
          ]).toString("utf8"),
        );
      }
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
    } else {
      db.prepare("DELETE FROM cache WHERE key LIKE ? ESCAPE '\\'").run(
        message.key.replace(/[\\%_]/g, "\\$&") + "/%",
      );
      value = true;
    }
    process.parentPort.postMessage({ id: message.id, value });
  } catch {
    process.parentPort.postMessage({
      id: message.id,
      error: "Protected storage operation failed.",
    });
  }
});

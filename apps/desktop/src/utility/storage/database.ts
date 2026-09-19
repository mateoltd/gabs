import Database from "better-sqlite3-multiple-ciphers";
import { hkdfSync } from "node:crypto";
import {
  chmodSync,
  existsSync,
  rmSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { dirname } from "node:path";

type LegacyRow = { key: string; payload: Buffer };
const legacyFiles = (path: string) => [
  path,
  `${path}-wal`,
  `${path}-shm`,
  `${path}-journal`,
];

/** One utility process owns this connection. Keys and SQL never cross renderer IPC. */
export function openProtectedDatabase(
  legacyPath: string,
  masterKey: Buffer,
  validateLegacy: (row: LegacyRow) => void,
) {
  if (masterKey.length !== 32) throw Error("Invalid storage key.");
  const path = `${legacyPath}.protected`;
  const created = !existsSync(path);
  const db = new Database(path);
  const pageKey = Buffer.from(
    hkdfSync(
      "sha256",
      masterKey,
      "suite-desktop-storage-v1",
      "sqlite-pages",
      32,
    ),
  );
  try {
    // Explicit format, authenticated pages and no plaintext header. Never interpolate a key into SQL.
    db.pragma("cipher='chacha20'");
    const raw = Buffer.from(`raw:${pageKey.toString("hex")}`);
    try {
      db.key(raw);
    } finally {
      raw.fill(0);
    }
    db.pragma("temp_store=MEMORY");
    db.pragma("journal_mode=WAL");
    db.pragma("synchronous=FULL");
    db.exec(
      "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS storage_format (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, legacy TEXT NOT NULL)",
    );
    chmodSync(path, 0o600);
    let state = db
      .prepare<[], { version: number; legacy: string }>(
        "SELECT version, legacy FROM storage_format WHERE id=1",
      )
      .get();
    if (!state) {
      if (db.prepare("SELECT 1 FROM cache LIMIT 1").get())
        throw Error("Storage migration state is missing.");
      if (existsSync(legacyPath)) {
        const source = new Database(legacyPath, { fileMustExist: true });
        try {
          // Prevent an older process from writing while copying its latest WAL-backed snapshot.
          source.exec("BEGIN IMMEDIATE");
          db.transaction(() => {
            const insert = db.prepare(
              "INSERT INTO cache(key,payload) VALUES(?,?)",
            );
            for (const row of source
              .prepare<[], LegacyRow>("SELECT key,payload FROM cache")
              .iterate()) {
              validateLegacy(row);
              insert.run(row.key, row.payload);
            }
            db.prepare(
              "INSERT INTO storage_format VALUES(1,1,'imported')",
            ).run();
          })();
          source.exec("ROLLBACK");
        } finally {
          source.close();
        }
        state = { version: 1, legacy: "imported" };
      } else {
        if (legacyFiles(legacyPath).slice(1).some(existsSync))
          throw Error("Legacy storage requires recovery.");
        db.prepare("INSERT INTO storage_format VALUES(1,1,'retired')").run();
        state = { version: 1, legacy: "retired" };
      }
    }
    if (state.version !== 1 || !["imported", "retired"].includes(state.legacy))
      throw Error("Unsupported protected storage format.");
    if (state.legacy === "imported") {
      // Commit and checkpoint the complete encrypted copy before retiring any old file.
      const checkpoint = db.pragma("wal_checkpoint(TRUNCATE)") as {
        busy: number;
      }[];
      if (checkpoint.some((row) => row.busy))
        throw Error("Storage migration is busy.");
      if (db.pragma("quick_check", { simple: true }) !== "ok")
        throw Error("Protected storage verification failed.");
      syncDirectory(dirname(path));
      for (const file of legacyFiles(legacyPath)) rmSync(file, { force: true });
      syncDirectory(dirname(path));
      db.prepare("UPDATE storage_format SET legacy='retired' WHERE id=1").run();
    } else if (legacyFiles(legacyPath).some(existsSync)) {
      // An old executable has recreated the source. Never silently overwrite or discard it.
      throw Error("Legacy storage reappeared and requires recovery.");
    }
    return db;
  } catch (error) {
    let uncommitted = false;
    if (created && existsSync(legacyPath)) {
      try {
        uncommitted = !db
          .prepare("SELECT 1 FROM storage_format WHERE id=1")
          .get();
      } catch {
        /* Uncertain state is retained for recovery. */
      }
    }
    db.close();
    // A rejected initial import must not strand an empty destination under a wrong key.
    if (uncommitted)
      for (const file of legacyFiles(path)) rmSync(file, { force: true });
    throw error;
  } finally {
    pageKey.fill(0);
  }
}

function syncDirectory(path: string) {
  // Windows does not support opening directories through this API.
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

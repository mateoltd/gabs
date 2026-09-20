import Database from "better-sqlite3-multiple-ciphers";
import { createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { vaultEnvelope, type LocalVault } from "@suite/client/vault-engine";
import { applyDatabaseKey, openProtectedDatabase } from "./database";
import { assertLocalVault } from "./local-vaults";

export interface RestoreSource {
  path: string;
  secret: string;
}
export interface RestoreResult {
  count: number;
  alreadyRestored: boolean;
}
const receiptSchema =
  "CREATE TABLE local_backup_restores(digest TEXT PRIMARY KEY,count INTEGER NOT NULL,restored_at INTEGER NOT NULL)";
const schemas = {
  cache: "CREATE TABLE cache(key TEXT PRIMARY KEY,payload BLOB NOT NULL)",
  storage_format:
    "CREATE TABLE storage_format(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,legacy TEXT NOT NULL)",
  local_vaults:
    "CREATE TABLE local_vaults(id TEXT PRIMARY KEY,envelope BLOB NOT NULL)",
  local_vault_imports:
    "CREATE TABLE local_vault_imports(id TEXT PRIMARY KEY,digest TEXT NOT NULL)",
};
const normalized = (sql: string) => sql.replace(/\s/g, "").toLowerCase();
interface BackupSnapshot {
  vaults: LocalVault[];
  imports: { id: string; digest: string }[];
  digest: string;
  count: number;
}
function portable(vault: LocalVault): LocalVault {
  return {
    id: vault.id,
    name: vault.name,
    salt: vault.salt,
    iv: vault.iv,
    ciphertext: vault.ciphertext,
    updatedAt: vault.updatedAt,
    revision: vault.revision ?? 0,
    removedAt: vault.removedAt,
  };
}

function assertClosedSnapshot(path: string) {
  if (["-wal", "-shm", "-journal"].some((suffix) => existsSync(path + suffix)))
    throw Error("The recovery database is not a closed snapshot.");
}

/** Untrusted archive SQL is read from a private copy and must match the export schema exactly. */
function readBackup(
  path: string,
  key: Buffer,
  prepared: boolean,
): BackupSnapshot {
  assertClosedSnapshot(path);
  const temporary = mkdtempSync(join(tmpdir(), "suite-local-restore-read-"));
  const snapshot = join(temporary, "snapshot.sqlite");
  let db: Database.Database | undefined;
  try {
    // A read-only WAL connection may create shared-memory state. Keep that state beside a
    // private copy so inspecting an archive never changes the authenticated source file.
    copyFileSync(path, snapshot, constants.COPYFILE_EXCL);
    assertClosedSnapshot(path);
    db = new Database(snapshot, { readonly: true, fileMustExist: true });
    applyDatabaseKey(db, key);
    db.pragma("trusted_schema=OFF");
    db.pragma("query_only=ON");
    const expected = new Map(
      Object.entries(
        prepared
          ? { ...schemas, local_backup_restores: receiptSchema }
          : schemas,
      ),
    );
    const indexes = new Set(
      [
        "cache",
        "local_vaults",
        "local_vault_imports",
        ...(prepared ? ["local_backup_restores"] : []),
      ].map((name) => `sqlite_autoindex_${name}_1`),
    );
    for (const row of db
      .prepare<[], { type: string; name: string; sql: string | null }>(
        "SELECT type,name,sql FROM sqlite_master",
      )
      .all()) {
      if (row.type === "index" && row.sql === null && indexes.delete(row.name))
        continue;
      const sql = expected.get(row.name);
      if (
        row.type !== "table" ||
        !sql ||
        !row.sql ||
        normalized(row.sql) !== normalized(sql)
      )
        throw Error("Unsupported recovery database schema.");
      expected.delete(row.name);
    }
    if (
      expected.size ||
      indexes.size ||
      db.pragma("quick_check", { simple: true }) !== "ok"
    )
      throw Error("Invalid recovery database.");
    const format = db
      .prepare<[], { id: number; version: number; legacy: string }>(
        "SELECT * FROM storage_format",
      )
      .all();
    if (
      format.length !== 1 ||
      format[0].id !== 1 ||
      format[0].version !== 1 ||
      format[0].legacy !== "retired" ||
      db.prepare("SELECT 1 FROM cache LIMIT 1").get()
    )
      throw Error("The archive contains unsupported or corporate storage.");
    const vaults = db
      .prepare<[], { id: string; envelope: Buffer }>(
        "SELECT id,envelope FROM local_vaults ORDER BY id",
      )
      .all()
      .map((row) => {
        if (typeof row.id !== "string" || !Buffer.isBuffer(row.envelope))
          throw Error("Invalid recovery profile storage.");
        const value: unknown = deserialize(row.envelope);
        assertLocalVault(value);
        if (value.id !== row.id)
          throw Error("Invalid recovery profile identity.");
        return portable(value);
      });
    const digest = createHash("sha256").update("suite-local-restore-v1\0");
    for (const vault of vaults)
      digest.update(vaultEnvelope(vault)).update("\0");
    if (!vaults.length) throw Error("The archive contains no local profiles.");
    const imports = db
      .prepare<[], { id: string; digest: string }>(
        "SELECT id,digest FROM local_vault_imports ORDER BY id",
      )
      .all();
    for (const row of imports) {
      if (
        typeof row.id !== "string" ||
        typeof row.digest !== "string" ||
        !/^[\da-f]{64}$/.test(row.digest) ||
        !db.prepare("SELECT 1 FROM local_vaults WHERE id=?").get(row.id)
      )
        throw Error("Invalid recovery migration receipt.");
      digest.update(JSON.stringify(row)).update("\0");
    }
    const identity = digest.digest("hex");
    if (prepared) {
      const receipts = db
        .prepare<[], { digest: string; count: number; restored_at: number }>(
          "SELECT * FROM local_backup_restores",
        )
        .all();
      if (
        receipts.length !== 1 ||
        receipts[0].digest !== identity ||
        receipts[0].count !== vaults.length ||
        !Number.isSafeInteger(receipts[0].restored_at) ||
        receipts[0].restored_at < 0
      )
        throw Error("Invalid prepared restoration receipt.");
    }
    return {
      vaults,
      imports,
      digest: identity,
      count: vaults.length,
    };
  } finally {
    try {
      db?.close();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

function copyProfiles(
  source: ReturnType<typeof readBackup>,
  target: Database.Database,
) {
  const insert = target.prepare(
    "INSERT INTO local_vaults(id,envelope) VALUES(?,?)",
  );
  for (const vault of source.vaults) {
    if (target.prepare("SELECT 1 FROM local_vaults WHERE id=?").get(vault.id))
      throw Error(
        "A restored profile already exists. Existing work was preserved; use a separate recovery store.",
      );
    insert.run(vault.id, serialize({ ...vault, recoveryRequired: true }));
  }
  const receipt = target.prepare(
    "INSERT INTO local_vault_imports(id,digest) VALUES(?,?)",
  );
  for (const row of source.imports) {
    if (
      target.prepare("SELECT 1 FROM local_vault_imports WHERE id=?").get(row.id)
    )
      throw Error(
        "A migration receipt already exists. Existing work was preserved.",
      );
    receipt.run(row.id, row.digest);
  }
  target
    .prepare("INSERT INTO local_backup_restores VALUES(?,?,?)")
    .run(source.digest, source.count, Date.now());
}

/** A fresh device key prevents the backup passphrase from unlocking future live corporate caches. */
export function prepareLocalRestore(
  sourcePath: string,
  sourceKey: Buffer,
  targetPath: string,
  targetKey: Buffer,
) {
  if (
    sourceKey.equals(targetKey) ||
    [targetPath, `${targetPath}.protected`].some(existsSync)
  )
    throw Error("Restoration requires new storage and an independent key.");
  const source = readBackup(sourcePath, sourceKey, false);
  let target: ReturnType<typeof openProtectedDatabase> | undefined;
  try {
    target = openProtectedDatabase(targetPath, targetKey, () => {
      throw Error("Unexpected legacy recovery storage.");
    });
    target.exec(
      `${schemas.local_vaults};${schemas.local_vault_imports};${receiptSchema}`,
    );
    target.transaction(() => copyProfiles(source, target!))();
    const checkpoint = target.pragma("wal_checkpoint(TRUNCATE)") as {
      busy: number;
    }[];
    if (
      checkpoint.some((row) => row.busy) ||
      target.pragma("quick_check", { simple: true }) !== "ok"
    )
      throw Error("Restoration verification failed.");
  } finally {
    target?.close();
  }
  for (const path of [
    `${targetPath}.protected`,
    ...(process.platform === "win32" ? [] : [dirname(targetPath)]),
  ]) {
    const fd = openSync(path, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}

/** One transaction adds profiles and the import receipt; retries never replace later edits. */
export function mergeLocalRestore(
  target: Database.Database,
  sourcePath: string,
  sourceKey: Buffer,
): RestoreResult {
  const source = readBackup(sourcePath, sourceKey, true);
  return target.transaction(() => {
    target.exec(
      `${schemas.local_vault_imports.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")};${receiptSchema.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")}`,
    );
    if (
      target
        .prepare("SELECT 1 FROM local_backup_restores WHERE digest=?")
        .get(source.digest)
    )
      return { count: source.count, alreadyRestored: true };
    copyProfiles(source, target);
    return { count: source.count, alreadyRestored: false };
  })();
}

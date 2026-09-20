import { createHash } from "node:crypto";
import { vaultEnvelope } from "@suite/client/vault-engine";
import { serialize, deserialize } from "node:v8";
import type { LocalVault, LocalVaultStore } from "@suite/client/vault-engine";
import type { openProtectedDatabase } from "./database";

/** Profile metadata and encrypted vault envelopes share the page-encrypted utility database. */
export function localVaultStore(
  db: ReturnType<typeof openProtectedDatabase>,
  changed: (id: string) => void,
): LocalVaultStore {
  db.exec(
    "CREATE TABLE IF NOT EXISTS local_vaults (id TEXT PRIMARY KEY, envelope BLOB NOT NULL)",
  );
  const locks = new Map<string, Promise<unknown>>();
  const decode = (bytes: Buffer): LocalVault => {
    const vault = deserialize(bytes) as LocalVault;
    assertLocalVault(vault);
    return vault;
  };
  const get = (id: string) => {
    const row = db
      .prepare<[string], { envelope: Buffer }>(
        "SELECT envelope FROM local_vaults WHERE id=?",
      )
      .get(id);
    return row ? decode(row.envelope) : undefined;
  };
  return {
    async get(id) {
      return get(id);
    },
    async list() {
      return db
        .prepare<[], { envelope: Buffer }>(
          "SELECT envelope FROM local_vaults ORDER BY rowid",
        )
        .all()
        .map((row) => decode(row.envelope));
    },
    async add(vault) {
      assertLocalVault(vault);
      db.prepare("INSERT INTO local_vaults VALUES(?,?)").run(
        vault.id,
        serialize(vault),
      );
    },
    async update(id, change) {
      return db.transaction(() => {
        const next = change(get(id));
        assertLocalVault(next);
        if (next.id !== id)
          throw Error("A vault update cannot change its profile.");
        db.prepare(
          "INSERT INTO local_vaults VALUES(?,?) ON CONFLICT(id) DO UPDATE SET envelope=excluded.envelope",
        ).run(id, serialize(next));
        return next;
      })();
    },
    async exclusive(id, run) {
      const task = (locks.get(id) ?? Promise.resolve())
        .catch(() => {})
        .then(run);
      locks.set(id, task);
      try {
        return await task;
      } finally {
        if (locks.get(id) === task) locks.delete(id);
      }
    },
    changed,
  };
}
export function assertLocalVault(value: unknown): asserts value is LocalVault {
  const vault = value as LocalVault | undefined;
  if (
    !vault ||
    typeof vault.id !== "string" ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      vault.id,
    ) ||
    typeof vault.name !== "string" ||
    !vault.name.trim() ||
    vault.name.length > 100 ||
    !(vault.salt instanceof Uint8Array) ||
    vault.salt.length !== 16 ||
    !(vault.iv instanceof Uint8Array) ||
    vault.iv.length !== 12 ||
    !(vault.ciphertext instanceof ArrayBuffer) ||
    vault.ciphertext.byteLength < 16 ||
    !Number.isSafeInteger(vault.updatedAt) ||
    vault.updatedAt < 0 ||
    (vault.revision !== undefined &&
      (!Number.isSafeInteger(vault.revision) || vault.revision < 0)) ||
    (vault.removedAt !== undefined &&
      (!Number.isSafeInteger(vault.removedAt) || vault.removedAt < 0))
  )
    throw Error("Invalid encrypted local profile.");
}

/** Commit envelopes and receipts together; a lost reply cannot replace newer native work. */
export function importLocalVaults(
  db: ReturnType<typeof openProtectedDatabase>,
  vaults: LocalVault[],
): string[] {
  if (!Array.isArray(vaults) || vaults.length > 1000)
    throw Error("Invalid local profile migration.");
  for (const vault of vaults) assertLocalVault(vault);
  if (new Set(vaults.map((v) => v.id)).size !== vaults.length)
    throw Error("Duplicate local profile migration.");
  db.exec(
    "CREATE TABLE IF NOT EXISTS local_vault_imports (id TEXT PRIMARY KEY, digest TEXT NOT NULL)",
  );
  return db.transaction(() => {
    for (const vault of vaults) {
      const digest = createHash("sha256")
        .update(vaultEnvelope(vault))
        .digest("hex");
      const imported = db
        .prepare<[string], { digest: string }>(
          "SELECT digest FROM local_vault_imports WHERE id=?",
        )
        .get(vault.id);
      const stored = db
        .prepare("SELECT 1 FROM local_vaults WHERE id=?")
        .get(vault.id);
      if (imported && imported.digest === digest && stored) continue;
      if (imported || stored)
        throw Error(
          "A local profile changed during migration. Its original encrypted data is retained for recovery.",
        );
      db.prepare("INSERT INTO local_vaults VALUES(?,?)").run(
        vault.id,
        serialize(vault),
      );
      db.prepare("INSERT INTO local_vault_imports VALUES(?,?)").run(
        vault.id,
        digest,
      );
    }
    return vaults.map((v) => v.id);
  })();
}

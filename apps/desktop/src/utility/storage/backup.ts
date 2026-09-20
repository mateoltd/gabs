import { closeSync, fsyncSync, openSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { deserialize, serialize } from "node:v8";
import { openProtectedDatabase } from "./database";
import { assertLocalVault } from "./local-vaults";
import { openCacheValue } from "./cipher";

export interface LocalBackupSource {
  sourcePath: string;
  sourceSecret: string;
}

/** Copy only encrypted standalone envelopes. Corporate caches and device unlock wrappers are excluded. */
export function stageLocalBackup(
  sourcePath: string,
  sourceKey: Buffer,
  targetPath: string,
  targetKey: Buffer,
) {
  if (!existsSync(`${sourcePath}.protected`))
    throw Error("The source database is missing.");
  if ([targetPath, `${targetPath}.protected`].some(existsSync))
    throw Error("Backup staging already exists.");
  if (sourceKey.equals(targetKey))
    throw Error("Local backup requires an independent database key.");
  const source = openProtectedDatabase(sourcePath, sourceKey, (row) => {
    JSON.parse(openCacheValue(sourceKey, row.key, row.payload).toString());
  });
  let target: ReturnType<typeof openProtectedDatabase> | undefined;
  try {
    if (
      !source
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_vaults'",
        )
        .get() ||
      !source.prepare("SELECT 1 FROM local_vaults LIMIT 1").get()
    )
      throw Error("There are no local profiles to back up.");
    target = openProtectedDatabase(targetPath, targetKey, () => {
      throw Error("Unexpected backup staging data.");
    });
    target.exec(
      "CREATE TABLE local_vaults(id TEXT PRIMARY KEY,envelope BLOB NOT NULL); CREATE TABLE local_vault_imports(id TEXT PRIMARY KEY,digest TEXT NOT NULL)",
    );
    const receipts = !!source
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_vault_imports'",
      )
      .get();
    target.transaction(() => {
      const insert = target!.prepare("INSERT INTO local_vaults VALUES(?,?)");
      const receipt = target!.prepare(
        "INSERT INTO local_vault_imports VALUES(?,?)",
      );
      for (const row of source
        .prepare<[], { id: string; envelope: Buffer }>(
          "SELECT id,envelope FROM local_vaults",
        )
        .iterate()) {
        const vault: unknown = deserialize(row.envelope);
        assertLocalVault(vault);
        if (vault.id !== row.id)
          throw Error("Invalid local profile storage identity.");
        insert.run(vault.id, serialize({ ...vault, unlock: undefined }));
        if (receipts) {
          const imported = source
            .prepare<[string], { digest: string }>(
              "SELECT digest FROM local_vault_imports WHERE id=?",
            )
            .get(vault.id);
          if (imported) {
            if (
              typeof imported.digest !== "string" ||
              !/^[\da-f]{64}$/.test(imported.digest)
            )
              throw Error("Invalid local migration receipt.");
            receipt.run(vault.id, imported.digest);
          }
        }
      }
    })();
    const checkpoint = target.pragma("wal_checkpoint(TRUNCATE)") as {
      busy: number;
    }[];
    if (
      checkpoint.some((row) => row.busy) ||
      target.pragma("quick_check", { simple: true }) !== "ok"
    )
      throw Error("Local backup verification failed.");
  } finally {
    target?.close();
    source.close();
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

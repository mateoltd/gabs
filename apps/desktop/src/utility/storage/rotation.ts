import Database from "better-sqlite3-multiple-ciphers";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { applyDatabaseKey, openProtectedDatabase } from "./database";
import { openCacheValue, sealCacheValue } from "./cipher";

function flush(path: string) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export interface StorageRotationSource {
  sourcePath: string;
  sourceSecret: string;
}

export function verifyProtectedDatabase(db: Database.Database, key: Buffer) {
  if (db.pragma("quick_check", { simple: true }) !== "ok")
    throw Error("Protected storage verification failed.");
  for (const row of db
    .prepare<[], { key: string; payload: Buffer }>(
      "SELECT key,payload FROM cache",
    )
    .iterate()) {
    const plaintext = openCacheValue(key, row.key, row.payload);
    try {
      JSON.parse(plaintext.toString("utf8"));
    } finally {
      plaintext.fill(0);
    }
  }
}

/** Bootstrap only, before admitting requests. The protected manifest owns activation. */
export function stageDatabaseRotation(
  sourcePath: string,
  sourceKey: Buffer,
  targetPath: string,
  targetKey: Buffer,
) {
  if (
    resolve(sourcePath) === resolve(targetPath) ||
    sourceKey.equals(targetKey)
  )
    throw Error("Storage rotation requires a new generation and key.");
  if (!existsSync(`${sourcePath}.protected`) && !existsSync(sourcePath))
    throw Error("The source database is missing. Restore a valid backup.");
  const source = openProtectedDatabase(sourcePath, sourceKey, (row) => {
    JSON.parse(
      openCacheValue(sourceKey, row.key, row.payload).toString("utf8"),
    );
  });
  try {
    const checkpoint = source.pragma("wal_checkpoint(TRUNCATE)") as {
      busy: number;
    }[];
    if (checkpoint.some((row) => row.busy))
      throw Error("Storage rotation is busy.");
    if (source.pragma("quick_check", { simple: true }) !== "ok")
      throw Error("Storage verification failed.");
  } finally {
    source.close();
  }

  // Only the manifest's uncommitted destination may be discarded on retry.
  if (existsSync(targetPath))
    throw Error("Unexpected legacy rotation destination.");
  const path = `${targetPath}.protected`;
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    rmSync(`${path}${suffix}`, { force: true });
  copyFileSync(`${sourcePath}.protected`, path, constants.COPYFILE_EXCL);
  const target = new Database(path, { fileMustExist: true });
  try {
    applyDatabaseKey(target, sourceKey);
    target.pragma("temp_store=MEMORY");
    target.pragma("journal_mode=DELETE");
    target.pragma("synchronous=FULL");
    target.transaction(() => {
      const update = target.prepare("UPDATE cache SET payload=? WHERE key=?");
      const batch = target.prepare<[string], { key: string; payload: Buffer }>(
        "SELECT key,payload FROM cache WHERE key > ? ORDER BY key LIMIT 128",
      );
      let cursor: string | null = null;
      for (;;) {
        const rows: { key: string; payload: Buffer }[] =
          cursor === null
            ? target
                .prepare<[], { key: string; payload: Buffer }>(
                  "SELECT key,payload FROM cache ORDER BY key LIMIT 128",
                )
                .all()
            : batch.all(cursor);
        if (!rows.length) break;
        for (const row of rows) {
          const plaintext = openCacheValue(sourceKey, row.key, row.payload);
          try {
            JSON.parse(plaintext.toString("utf8"));
            update.run(sealCacheValue(targetKey, row.key, plaintext), row.key);
          } finally {
            plaintext.fill(0);
          }
        }
        cursor = rows[rows.length - 1].key;
      }
    })();
    applyDatabaseKey(target, targetKey, true);
    verifyProtectedDatabase(target, targetKey);
  } finally {
    target.close();
  }
  flush(path);
  if (process.platform !== "win32") flush(dirname(path));
}

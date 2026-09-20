import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { openManagedStorage } from "../identity/storage-key";
import type { ProtectedFiles } from "../identity/protected-files";
import type { LocalBackupSource } from "../../utility/storage/backup";
import type { StorageRotationSource } from "../../utility/storage/rotation";
import { writeStorageArchive } from "./archive";

/** Startup maintenance only: no renderer or corporate operation may be admitted during the snapshot. */
export async function createLocalBackup(options: {
  root: string;
  files: Pick<ProtectedFiles, "read" | "write">;
  open(
    path: string,
    secret: string,
    rotation?: StorageRotationSource,
    verify?: boolean,
  ): Promise<void>;
  close(): Promise<void>;
  snapshot(
    path: string,
    secret: string,
    source: LocalBackupSource,
  ): Promise<void>;
  destination: string;
  passphrase: string;
  signal?: AbortSignal;
}) {
  const destination = resolve(options.destination);
  const relativePath = relative(resolve(options.root), destination);
  if (
    !relativePath ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  )
    throw Error(
      "Save the backup outside the application's protected storage directory.",
    );
  options.signal?.throwIfAborted();
  let temporary: string | undefined;
  const secret = randomBytes(32);
  try {
    const active = await openManagedStorage({ ...options, rotate: false });
    await options.close();
    options.signal?.throwIfAborted();
    temporary = await mkdtemp(resolve(options.root, "backup-"));
    const snapshot = resolve(temporary, "snapshot.sqlite");
    await options.snapshot(snapshot, secret.toString("base64"), {
      sourcePath: active.path,
      sourceSecret: active.secret,
    });
    await options.close();
    await writeStorageArchive({
      database: `${snapshot}.protected`,
      secret,
      destination,
      passphrase: options.passphrase,
      signal: options.signal,
    });
  } finally {
    secret.fill(0);
    // Close before removing staging files, including a partially opened SQLite connection.
    await options.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

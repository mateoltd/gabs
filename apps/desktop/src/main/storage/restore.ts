import { createImportStaging, cleanImportStaging } from "./import-staging";
import { rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { openManagedStorage } from "../identity/storage-key";
import type { ProtectedFiles } from "../identity/protected-files";
import type { StorageRotationSource } from "../../utility/storage/rotation";
import type {
  RestoreSource,
  RestoreResult,
} from "../../utility/storage/restore";
import { readStorageArchive } from "./archive";

/** Startup-only additive import. Authenticate and validate before opening any live storage. */
export async function restoreLocalProfiles(options: {
  root: string;
  files: Pick<ProtectedFiles, "read" | "write">;
  open(
    path: string,
    secret: string,
    rotation?: StorageRotationSource,
    verify?: boolean,
  ): Promise<void>;
  close(): Promise<void>;
  prepare(path: string, secret: string, source: RestoreSource): Promise<void>;
  merge(source: RestoreSource): Promise<RestoreResult>;
  archive: string;
  passphrase: string;
  signal?: AbortSignal;
}): Promise<RestoreResult> {
  options.signal?.throwIfAborted();
  // Staging is outside the managed database root and contains encrypted pages only.
  const staging = await createImportStaging(options.root);
  const temporary = staging.path;
  const secret = randomBytes(32);
  let archiveKey: Buffer | undefined;
  try {
    const extracted = resolve(temporary, "archive.sqlite.protected");
    archiveKey = await readStorageArchive({
      archive: options.archive,
      destination: extracted,
      passphrase: options.passphrase,
      signal: options.signal,
    });
    const prepared = resolve(temporary, "prepared.sqlite");
    options.signal?.throwIfAborted();
    await options.prepare(prepared, secret.toString("base64"), {
      path: extracted,
      secret: archiveKey.toString("base64"),
    });
    await options.close();
    archiveKey.fill(0);
    await rm(extracted);
    options.signal?.throwIfAborted();
    await openManagedStorage({ ...options, rotate: false });
    options.signal?.throwIfAborted();
    // The transaction includes its archive receipt. A lost reply can safely retry this archive.
    return await options.merge({
      path: `${prepared}.protected`,
      secret: secret.toString("base64"),
    });
  } finally {
    archiveKey?.fill(0);
    secret.fill(0);
    await options.close();
    await cleanImportStaging(options.root, staging.id);
  }
}

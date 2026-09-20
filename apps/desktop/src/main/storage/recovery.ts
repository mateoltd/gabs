import { randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ProtectedFiles } from "../identity/protected-files";
import {
  openManagedStorage,
  type StorageKeyRecord,
} from "../identity/storage-key";
import type { RestoreSource } from "../../utility/storage/restore";
import type { StorageRotationSource } from "../../utility/storage/rotation";
import { readStorageArchiveDetails } from "./archive";
import { readJournal, publishJournal, syncDirectory } from "./journal";

interface RecoveryIntent {
  phase: "ready";
  version: 1;
  id: string;
  archive: string;
  original: { device: string; inode: string };
}
type PreparationIntent = Omit<RecoveryIntent, "phase" | "archive"> & {
  phase: "preparing";
};
type RecoveryRecord = RecoveryIntent | PreparationIntent;
export interface RecoveryHost {
  root: string;
  filesFor(root: string): Pick<ProtectedFiles, "read" | "write">;
  open(
    path: string,
    secret: string,
    source?: StorageRotationSource,
    verify?: boolean,
  ): Promise<void>;
  close(): Promise<void>;
}
export interface RecoveryResult {
  retained: string;
  alreadyRecovered: boolean;
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const marker = "local-recovery.json";
const paths = (root: string, id: string) => ({
  staged: `${resolve(root)}.recovery-${id}`,
  retained: `${resolve(root)}.retained-${id}`,
  journal: `${resolve(root)}.recovery.json`,
});
async function directory(path: string) {
  try {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Recovery requires ordinary directories.");
    return { device: stat.dev.toString(), inode: stat.ino.toString() };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
function sameDirectory(
  a: RecoveryIntent["original"] | undefined,
  b: RecoveryIntent["original"],
) {
  return a?.device === b.device && a.inode === b.inode;
}
function parse(value: unknown): RecoveryRecord {
  const v = value as RecoveryRecord | undefined;
  if (
    !v ||
    v.version !== 1 ||
    typeof v.id !== "string" ||
    !uuid.test(v.id) ||
    (v.phase !== "preparing" && v.phase !== "ready") ||
    (v.phase === "ready" &&
      (typeof v.archive !== "string" || !/^[\da-f]{64}$/.test(v.archive))) ||
    !v.original ||
    typeof v.original.device !== "string" ||
    !/^\d{1,30}$/.test(v.original.device) ||
    typeof v.original.inode !== "string" ||
    !/^\d{1,30}$/.test(v.original.inode)
  )
    throw Error(
      "Invalid local recovery record. Existing storage was retained.",
    );
  const base = { version: 1 as const, id: v.id, original: { ...v.original } };
  return v.phase === "ready"
    ? { ...base, phase: "ready", archive: v.archive }
    : { ...base, phase: "preparing" };
}
async function readIntent(path: string): Promise<RecoveryRecord | undefined> {
  const value = await readJournal(path);
  return value === undefined ? undefined : parse(value);
}
function matches(a: RecoveryRecord | undefined, b: RecoveryIntent) {
  return (
    a?.phase === "ready" &&
    a.id === b.id &&
    a.archive === b.archive &&
    sameDirectory(a.original, b.original)
  );
}
async function verify(host: RecoveryHost, root: string) {
  try {
    await openManagedStorage({
      root,
      files: host.filesFor(root),
      rotate: false,
      open: (path, secret, source) => host.open(path, secret, source, true),
    });
  } finally {
    await host.close();
  }
}

/** A preparing record proves this candidate was never admitted as the active store. */
async function abandonPreparation(
  host: RecoveryHost,
  intent: PreparationIntent,
) {
  const root = resolve(host.root);
  const { staged, retained, journal } = paths(root, intent.id);
  if (
    !sameDirectory(await directory(root), intent.original) ||
    (await directory(retained))
  )
    throw Error("Recovery preparation paths changed. All files were retained.");
  await directory(staged); // Refuse links and non-directories, including partial staging.
  await rm(staged, { recursive: true, force: true });
  await syncDirectory(dirname(root));
  await rm(journal);
  await syncDirectory(dirname(root));
}

/** Finish the durable intent before admitting credentials, UI or business work. Never roll back a new root. */
export async function resumeLocalRecovery(
  host: RecoveryHost,
): Promise<RecoveryResult | undefined> {
  const root = resolve(host.root);
  const intent = await readIntent(`${root}.recovery.json`);
  if (!intent) return;
  // Finish any uncertain intent publication before moving its original directory.
  await syncDirectory(dirname(root));
  if (intent.phase === "preparing") {
    await abandonPreparation(host, intent);
    return;
  }
  const { staged, retained, journal } = paths(root, intent.id);
  const active = await directory(root);
  const activeMarker = active
    ? await readIntent(resolve(root, marker))
    : undefined;
  if (!matches(activeMarker, intent)) {
    if (!(await directory(staged)))
      throw Error("The staged recovery is missing.");
    if (!matches(await readIntent(resolve(staged, marker)), intent))
      throw Error(
        "The staged recovery is missing or changed. Existing storage was retained.",
      );
    await verify(host, staged);
    const original = await directory(retained);
    if (original) {
      if (active || !sameDirectory(original, intent.original))
        throw Error("Recovery paths changed. Existing storage was retained.");
    } else {
      if (!sameDirectory(active, intent.original))
        throw Error("Original recovery storage changed.");
      await rename(root, retained);
      await syncDirectory(dirname(root));
    }
    await rename(staged, root);
    await syncDirectory(dirname(root));
  } else if (await directory(staged)) {
    throw Error("Ambiguous recovery directories. Both copies were retained.");
  }
  if (
    !sameDirectory(await directory(retained), intent.original) ||
    !matches(await readIntent(resolve(root, marker)), intent)
  )
    throw Error("Recovery storage verification failed.");
  await verify(host, root);
  // A retry after unlink but before its directory flush must never reinstall the old snapshot.
  await rm(journal);
  await syncDirectory(dirname(root));
  return { retained, alreadyRecovered: false };
}

/** Explicit replacement recovery; the complete original directory is retained, never decrypted or deleted. */
export async function recoverLocalProfiles(
  options: RecoveryHost & {
    archive: string;
    passphrase: string;
    prepare(path: string, secret: string, source: RestoreSource): Promise<void>;
    forceNewRecovery?: boolean;
  },
): Promise<RecoveryResult> {
  const root = resolve(options.root);
  if (await readIntent(`${root}.recovery.json`))
    throw Error("Resume the pending recovery before starting another.");
  const original = await directory(root);
  if (!original)
    throw Error("Use additive restoration for a new device store.");
  const id = randomUUID();
  const { staged, journal } = paths(root, id);
  await publishJournal(journal, {
    version: 1,
    id,
    phase: "preparing",
    original,
  });
  const secret = randomBytes(32);
  let archiveKey: Buffer | undefined,
    publishing = false;
  try {
    await mkdir(staged, { mode: 0o700 });
    const extracted = resolve(staged, "archive.sqlite.protected");
    const archive = await readStorageArchiveDetails({
      archive: options.archive,
      destination: extracted,
      passphrase: options.passphrase,
    });
    archiveKey = archive.secret;
    const previous = await readIntent(resolve(root, marker));
    if (
      previous?.phase === "ready" &&
      previous.archive === archive.digest &&
      !options.forceNewRecovery
    ) {
      await verify(options, root);
      return {
        retained: paths(root, previous.id).retained,
        alreadyRecovered: true,
      };
    }
    await options.prepare(
      resolve(staged, `workspace-${id}.sqlite`),
      secret.toString("base64"),
      { path: extracted, secret: archiveKey.toString("base64") },
    );
    await options.close();
    archiveKey.fill(0);
    await rm(extracted);
    await options.filesFor(staged).write("cache-secret", {
      version: 2,
      initialized: true,
      active: {
        generation: id,
        secret: secret.toString("base64"),
        createdAt: Date.now(),
      },
    } satisfies StorageKeyRecord);
    await verify(options, staged);
    if (!sameDirectory(await directory(root), original))
      throw Error("Original recovery storage changed.");
    const intent: RecoveryIntent = {
      phase: "ready",
      version: 1,
      id,
      archive: archive.digest,
      original,
    };
    await publishJournal(resolve(staged, marker), intent);
    publishing = true; // Retain staging if publication or its directory flush has an uncertain outcome.
    await publishJournal(journal, intent, true);
    const recovered = await resumeLocalRecovery(options);
    if (!recovered) throw Error("The recovery record disappeared.");
    return recovered;
  } finally {
    archiveKey?.fill(0);
    secret.fill(0);
    await options.close();
    if (!publishing) {
      const saved = await readIntent(journal);
      if (saved?.phase === "preparing" && saved.id === id)
        await abandonPreparation(options, saved);
    }
  }
}

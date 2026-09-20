import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, open, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { StorageRotationSource } from "../../utility/storage/rotation";
import type { ProtectedFiles } from "./protected-files";

interface KeySlot {
  generation: string;
  secret: string;
  createdAt: number;
}
export interface StorageKeyRecord {
  version: 2;
  active: KeySlot;
  initialized: boolean;
  rotation?:
    | { phase: "prepared"; next: KeySlot }
    | { phase: "activated"; previous: KeySlot };
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const databaseFiles =
  /^workspace(?:-[\da-f-]+)?\.sqlite(?:\.protected)?(?:-wal|-shm|-journal)?$/;
const sidecars = ["", "-wal", "-shm", "-journal"];
function validSecret(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Buffer.from(value, "base64").length === 32 &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}
function validSlot(value: unknown): value is KeySlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as KeySlot;
  return (
    (slot.generation === "legacy" ||
      (typeof slot.generation === "string" && uuid.test(slot.generation))) &&
    validSecret(slot.secret) &&
    Number.isSafeInteger(slot.createdAt) &&
    slot.createdAt >= 0
  );
}
function parseRecord(value: unknown): StorageKeyRecord {
  if (!value || typeof value !== "object")
    throw Error("Invalid storage key record.");
  const record = value as StorageKeyRecord;
  if (
    record.version !== 2 ||
    !validSlot(record.active) ||
    typeof record.initialized !== "boolean"
  )
    throw Error("Invalid storage key record.");
  if (record.rotation !== undefined) {
    const rotation = record.rotation;
    if (!rotation || typeof rotation !== "object" || !record.initialized)
      throw Error("Invalid storage rotation record.");
    const other =
      rotation.phase === "prepared"
        ? rotation.next
        : rotation.phase === "activated"
          ? rotation.previous
          : undefined;
    if (
      !validSlot(other) ||
      other.generation === record.active.generation ||
      other.secret === record.active.secret ||
      (rotation.phase === "prepared"
        ? other.generation
        : record.active.generation) === "legacy"
    )
      throw Error("Invalid storage rotation record.");
  }
  return record;
}
const pathFor = (root: string, slot: KeySlot) =>
  resolve(
    root,
    slot.generation === "legacy"
      ? "workspace.sqlite"
      : `workspace-${slot.generation}.sqlite`,
  );
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function present(path: string) {
  return (await exists(`${path}.protected`)) || (await exists(path));
}
async function retire(path: string) {
  for (const suffix of sidecars)
    if (await exists(`${path}${suffix}`))
      throw Error("Legacy storage reappeared and requires recovery.");
  for (const suffix of sidecars)
    await rm(`${path}.protected${suffix}`, { force: true });
}

/** Main owns the protected pointer; the utility exclusively owns database contents. */
export async function openManagedStorage(options: {
  root: string;
  files: Pick<ProtectedFiles, "read" | "write">;
  rotate: boolean;
  open(
    path: string,
    secret: string,
    source?: StorageRotationSource,
    verify?: boolean,
  ): Promise<void>;
}) {
  const { root, files } = options;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const saved = await files.read<unknown>("cache-secret");
  let record: StorageKeyRecord;
  if (saved === undefined) {
    if ((await readdir(root)).some((file) => databaseFiles.test(file)))
      throw Error(
        "The protected storage key is missing. Restore the device backup before continuing.",
      );
    record = {
      version: 2,
      initialized: false,
      active: {
        generation: "legacy",
        secret: randomBytes(32).toString("base64"),
        createdAt: Date.now(),
      },
    };
  } else if (validSecret(saved)) {
    const active = { generation: "legacy", secret: saved, createdAt: 0 };
    // Legacy records did not distinguish a newly saved key from an initialized database.
    record = {
      version: 2,
      active,
      initialized: await present(pathFor(root, active)),
    };
  } else record = parseRecord(saved);

  // Also finishes any prior rename whose directory flush did not acknowledge success.
  await files.write("cache-secret", record);
  if (
    record.initialized &&
    !(await (record.active.generation === "legacy"
      ? present(pathFor(root, record.active))
      : exists(`${pathFor(root, record.active)}.protected`)))
  )
    throw Error("The active database is missing. Restore a valid backup.");
  if (options.rotate && record.initialized && !record.rotation) {
    record = {
      ...record,
      rotation: {
        phase: "prepared",
        next: {
          generation: randomUUID(),
          secret: randomBytes(32).toString("base64"),
          createdAt: Date.now(),
        },
      },
    };
    await files.write("cache-secret", record);
  }
  if (record.rotation?.phase === "prepared") {
    const previous = record.active,
      next = record.rotation.next;
    await options.open(pathFor(root, next), next.secret, {
      sourcePath: pathFor(root, previous),
      sourceSecret: previous.secret,
    });
    record = {
      version: 2,
      initialized: true,
      active: next,
      rotation: { phase: "activated", previous },
    };
    await files.write("cache-secret", record);
  } else {
    await options.open(
      pathFor(root, record.active),
      record.active.secret,
      undefined,
      record.rotation?.phase === "activated",
    );
    if (!record.initialized) {
      record = { ...record, initialized: true };
      await files.write("cache-secret", record);
    }
  }
  if (record.rotation?.phase === "activated") {
    // The active database has been opened and validated before the previous key is retired.
    await retire(pathFor(root, record.rotation.previous));
    if (process.platform !== "win32") {
      const directory = await open(root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    await files.write("cache-secret", {
      version: 2,
      initialized: true,
      active: record.active,
    } satisfies StorageKeyRecord);
  }
}

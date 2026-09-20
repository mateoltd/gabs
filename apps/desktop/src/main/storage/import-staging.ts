import { randomUUID } from "node:crypto";
import { lstat, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readJournal, publishJournal, syncDirectory } from "./journal";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const journal = (root: string) => `${resolve(root)}.import.json`;
const stage = (root: string, id: string) =>
  resolve(dirname(root), `.local-restore-${id}`);
/** Import staging is never an active store. A private journal authorizes cleanup after process death. */
export async function cleanImportStaging(root: string, expectedId?: string) {
  const value = (await readJournal(journal(root))) as
    { version?: unknown; id?: unknown } | undefined;
  if (value === undefined) return;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.id !== "string" ||
    !uuid.test(value.id) ||
    (expectedId && value.id !== expectedId)
  )
    throw Error("Invalid import staging record. Files were retained.");
  const path = stage(root, value.id);
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Import staging changed. Files were retained.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rm(path, { recursive: true, force: true });
  await syncDirectory(dirname(root));
  await rm(journal(root));
  await syncDirectory(dirname(root));
}
/** Called only by startup maintenance under the single-instance lock. */
export async function createImportStaging(root: string) {
  await mkdir(dirname(resolve(root)), { recursive: true, mode: 0o700 });
  await cleanImportStaging(root);
  const id = randomUUID();
  await publishJournal(journal(root), { version: 1, id });
  const path = stage(root, id);
  await mkdir(path, { mode: 0o700 });
  return { id, path };
}

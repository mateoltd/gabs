import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

export async function syncIntegrityDirectory(path: string) {
  if (process.platform === "win32") return;
  const file = await open(path, "r");
  try { await file.sync(); } finally { await file.close(); }
}
export async function integrityDirectory(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Integrity records must be in an ordinary directory.");
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function ensureIntegrityDirectory(path: string) {
  const created = await mkdir(path, { recursive: true, mode: 0o700 });
  await integrityDirectory(path);
  if (created) await syncIntegrityDirectory(resolve(path, ".."));
}
export async function readIntegrityFile(path: string): Promise<unknown> {
  let file;
  try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8192) throw Error("Invalid integrity record.");
    return JSON.parse(await file.readFile("utf8"));
  } finally { await file.close(); }
}
export async function writeIntegrityFile(root: string, name: string, value: unknown) {
  if (!/^[a-zA-Z0-9-]+(?:\.[a-z]+)+$/.test(name)) throw Error("Invalid integrity filename.");
  const destination = resolve(root, name), temporary = resolve(root, `${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value) + "\n"); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, destination);
    await syncIntegrityDirectory(root);
  } finally { await rm(temporary, { force: true }); }
}

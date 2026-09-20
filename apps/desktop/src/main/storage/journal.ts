import { randomUUID } from "node:crypto";
import { link, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export async function syncDirectory(path: string) {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
/** Small private startup records, read through one descriptor and published durably. */
export async function readJournal(path: string): Promise<unknown> {
  let file;
  try {
    file = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > 4096)
      throw Error("Invalid storage recovery record.");
    const bytes = Buffer.alloc(stat.size);
    const read = await file.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead !== bytes.length)
      throw Error("Incomplete storage recovery record.");
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    await file.close();
  }
}
export async function publishJournal(
  path: string,
  value: unknown,
  replace = false,
) {
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > 4096)
    throw Error("Invalid storage recovery record.");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    if (replace) await rename(temporary, path);
    else await link(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}

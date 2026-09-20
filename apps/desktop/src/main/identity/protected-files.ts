import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

interface Protection {
  available(): boolean;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

async function syncDirectory(path: string) {
  if (process.platform === "win32") return;
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/** Main-process protected files. One serialized owner covers reads, renewal, writes and removal. */
export class ProtectedFiles {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    private readonly root: () => string,
    private readonly protection: Protection,
  ) {}
  private path(key: string) {
    if (
      key.length > 2048 ||
      key
        .split("/")
        .some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(part))
    )
      throw Error("Invalid protected storage key.");
    return resolve(this.root(), `${key}.bin`);
  }
  private async exclusive<T>(key: string, run: (path: string) => Promise<T>) {
    const path = this.path(key);
    const task = (this.pending.get(path) ?? Promise.resolve())
      .catch(() => {})
      .then(() => run(path));
    this.pending.set(path, task);
    try {
      return await task;
    } finally {
      if (this.pending.get(path) === task) this.pending.delete(path);
    }
  }
  private available() {
    if (!this.protection.available())
      throw Error("Protected storage is unavailable. Unlock it and retry.");
  }
  private async replace(path: string, plaintext: string) {
    this.available();
    const ciphertext = await this.protection.encrypt(plaintext);
    this.available();
    const directory = dirname(path);
    const created = await mkdir(directory, { recursive: true, mode: 0o700 });
    if (created) {
      // Persist each new directory entry, including recursively created parents.
      for (let path = directory; ; path = dirname(path)) {
        await syncDirectory(dirname(path));
        if (path === created) break;
      }
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(ciphertext);
        await file.sync();
      } finally {
        await file.close();
      }
      this.available();
      await rename(temporary, path);
      await syncDirectory(directory);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async read<T>(
    key: string,
    options = { renew: true },
  ): Promise<T | undefined> {
    return this.exclusive(key, async (path) => {
      let ciphertext: Buffer;
      try {
        ciphertext = await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      this.available();
      const decrypted = await this.protection.decrypt(ciphertext);
      this.available();
      let value: T;
      try {
        value = JSON.parse(decrypted.result) as T;
      } catch {
        throw Error("The protected record is invalid. Restore a valid backup.");
      }
      if (options.renew && decrypted.shouldReEncrypt)
        await this.replace(path, decrypted.result);
      return value;
    });
  }
  write(key: string, value: unknown): Promise<void> {
    // Snapshot before yielding, so a caller cannot mutate the pending credential.
    const plaintext = JSON.stringify(value);
    if (plaintext === undefined) throw Error("Invalid protected value.");
    return this.exclusive(key, (path) => this.replace(path, plaintext));
  }
  remove(key: string): Promise<void> {
    return this.exclusive(key, async (path) => {
      try {
        await rm(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      // A retry after unlink succeeded but directory flush failed must still flush.
      try {
        await syncDirectory(dirname(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    });
  }
}

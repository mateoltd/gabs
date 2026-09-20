import { stageLocalBackup } from "../../apps/desktop/src/utility/storage/backup";
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { ProtectedFiles } from "../../apps/desktop/src/main/identity/protected-files";
import {
  openManagedStorage,
  type StorageKeyRecord,
} from "../../apps/desktop/src/main/identity/storage-key";
import { createLocalBackup } from "../../apps/desktop/src/main/storage/backup";
import {
  writeStorageArchive,
  readStorageArchive,
} from "../../apps/desktop/src/main/storage/archive";
import { readBackupPassphrase } from "../../apps/desktop/src/main/storage/passphrase";
import { openProtectedDatabase } from "../../apps/desktop/src/utility/storage/database";
import {
  openCacheValue,
  sealCacheValue,
} from "../../apps/desktop/src/utility/storage/cipher";
import {
  stageDatabaseRotation,
  verifyProtectedDatabase,
} from "../../apps/desktop/src/utility/storage/rotation";
import { localVaultStore } from "../../apps/desktop/src/utility/storage/local-vaults";
import { createVaultEngine } from "../../packages/client/src/identity/local-vault/engine";

const directories: string[] = [];
const connections: ReturnType<typeof openProtectedDatabase>[] = [];
afterEach(async () => {
  for (const db of connections.splice(0)) if (db.open) db.close();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture(quickUnlock = false) {
  const dir = await mkdtemp(join(tmpdir(), "suite-device-backup-"));
  directories.push(dir);
  const root = join(dir, "secure-cache"),
    destination = join(dir, "device.commonbackup");
  const provider = randomBytes(32);
  let available = true;
  const files = new ProtectedFiles(() => root, {
    available: () => available,
    encrypt: async (text) =>
      sealCacheValue(provider, "record", Buffer.from(text)),
    decrypt: async (bytes) => ({
      result: openCacheValue(provider, "record", bytes).toString(),
      shouldReEncrypt: false,
    }),
  });
  let db: ReturnType<typeof openProtectedDatabase> | undefined;
  const host = {
    root,
    files,
    async open(
      path: string,
      secret: string,
      source?: { sourcePath: string; sourceSecret: string },
      verify = false,
    ) {
      if (db?.open) throw Error("Storage is already open");
      const key = Buffer.from(secret, "base64");
      if (source)
        stageDatabaseRotation(
          source.sourcePath,
          Buffer.from(source.sourceSecret, "base64"),
          path,
          key,
        );
      db = openProtectedDatabase(path, key, (row) =>
        JSON.parse(openCacheValue(key, row.key, row.payload).toString()),
      );
      connections.push(db);
      if (verify) verifyProtectedDatabase(db, key);
    },
    async snapshot(
      path: string,
      secret: string,
      source: { sourcePath: string; sourceSecret: string },
    ) {
      stageLocalBackup(
        source.sourcePath,
        Buffer.from(source.sourceSecret, "base64"),
        path,
        Buffer.from(secret, "base64"),
      );
      await host.open(path, secret);
    },
    async close() {
      if (db?.open) db.close();
    },
  };
  const active = await openManagedStorage({ ...host, rotate: false });
  const key = Buffer.from(active.secret, "base64");
  db!
    .prepare("INSERT INTO cache VALUES(?,?)")
    .run(
      "account/workspace/pending",
      sealCacheValue(
        key,
        "account/workspace/pending",
        Buffer.from(
          '[{"id":"exact-request","state":"pending","input":{"note":"Preserved private work"}}]',
        ),
      ),
    );
  const engine = createVaultEngine(localVaultStore(db!, () => {}));
  const created = await engine.createVault(
    "Private standalone profile",
    "original vault passphrase",
    { records: { contacts: [{ name: "Portable contact" }] } },
  );
  if (quickUnlock)
    await engine.configureLocalUnlock(
      created.vault.id,
      "original vault passphrase",
      "12345678",
      false,
    );
  db!.exec(
    "CREATE TABLE local_vault_imports(id TEXT PRIMARY KEY,digest TEXT NOT NULL)",
  );
  db!
    .prepare("INSERT INTO local_vault_imports VALUES(?,?)")
    .run(created.vault.id, "a".repeat(64));
  db!
    .prepare("INSERT INTO local_vault_imports VALUES(?,?)")
    .run(crypto.randomUUID(), "b".repeat(64));
  await host.close();
  await files.write("credentials", {
    refreshToken: "never part of a portable backup",
  });
  const passphrase = "independent archive passphrase";
  const backup = () => createLocalBackup({ ...host, destination, passphrase });
  const read = (
    archive = destination,
    password = passphrase,
    target = join(dir, "restored.sqlite.protected"),
  ) =>
    readStorageArchive({ archive, passphrase: password, destination: target });
  const recover = async (
    secret: Buffer,
    path = join(dir, "restored.sqlite"),
  ) => {
    const restored = openProtectedDatabase(path, secret, () => {
      throw Error("Unexpected plaintext legacy database");
    });
    connections.push(restored);
    verifyProtectedDatabase(restored, secret);
    expect(
      restored.prepare("SELECT COUNT(*) AS count FROM cache").get(),
    ).toEqual({ count: 0 });
    expect(restored.prepare("SELECT * FROM local_vault_imports").all()).toEqual(
      [{ id: created.vault.id, digest: "a".repeat(64) }],
    );
    const vault = await createVaultEngine(
      localVaultStore(restored, () => {}),
    ).unlockVault(created.vault.id, "original vault passphrase");
    expect(vault.vault.unlock).toBeUndefined();
    expect(vault.data).toEqual({
      records: { contacts: [{ name: "Portable contact" }] },
    });
    return restored;
  };
  return {
    dir,
    root,
    destination,
    passphrase,
    active,
    key,
    host,
    backup,
    read,
    recover,
    unavailable: () => {
      available = false;
      provider.fill(0);
    },
  };
}

it("backs up standalone vaults without exporting corporate pending work under an independent key that survives OS-key loss", async () => {
  const f = await fixture(true);
  const original = await readFile(`${f.active.path}.protected`);
  await f.backup();
  expect(await readFile(`${f.active.path}.protected`)).toEqual(original);
  expect(
    (await readdir(f.root)).some((name) => name.startsWith("backup-")),
  ).toBe(false);
  f.unavailable();
  await expect(f.host.files.read("cache-secret")).rejects.toThrow(
    "Protected storage",
  );
  const replacement = await f.read();
  expect(replacement.equals(f.key)).toBe(false);
  const db = await f.recover(replacement);
  db.close();
  expect(() =>
    openProtectedDatabase(join(f.dir, "restored.sqlite"), f.key, () => {}),
  ).toThrow();
  const bytes = await readFile(f.destination);
  for (const value of [
    f.key,
    replacement,
    Buffer.from(f.passphrase),
    Buffer.from("Portable contact"),
    Buffer.from("account/workspace"),
    Buffer.from("never part of a portable backup"),
  ])
    expect(bytes.includes(value)).toBe(false);
  replacement.fill(0);
});

it("works after master-key rotation and does not modify the active generation", async () => {
  const f = await fixture();
  const active = await openManagedStorage({ ...f.host, rotate: true });
  await f.host.close();
  const before = await f.host.files.read<StorageKeyRecord>("cache-secret");
  await f.backup();
  expect(await f.host.files.read("cache-secret")).toEqual(before);
  expect(existsSync(`${active.path}.protected`)).toBe(true);
  await f.recover(await f.read());
});

for (const corruption of [
  "magic",
  "salt",
  "iv",
  "body",
  "tag",
  "truncated",
  "appended",
] as const) {
  it(`rejects ${corruption} damage without publishing unauthenticated recovery data`, async () => {
    const f = await fixture();
    await f.backup();
    let bytes = await readFile(f.destination);
    if (corruption === "truncated")
      bytes = bytes.subarray(0, bytes.length - 20);
    else if (corruption === "appended")
      bytes = Buffer.concat([bytes, Buffer.from("untrusted")]);
    else {
      const offset = {
        magic: 0,
        salt: 12,
        iv: 30,
        body: 64,
        tag: bytes.length - 1,
      }[corruption];
      bytes[offset] ^= 1;
    }
    await writeFile(f.destination, bytes);
    await expect(f.read()).rejects.toThrow();
    expect(existsSync(join(f.dir, "restored.sqlite.protected"))).toBe(false);
    expect(
      (await readdir(f.dir)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    expect(existsSync(`${f.active.path}.protected`)).toBe(true);
  });
}

it("rejects wrong passphrases and preserves existing backup and recovery destinations", async () => {
  const f = await fixture();
  await f.backup();
  const original = await readFile(f.destination);
  await expect(f.read(undefined, "wrong archive passphrase")).rejects.toThrow();
  await expect(f.backup()).rejects.toThrow();
  expect(await readFile(f.destination)).toEqual(original);
  const restored = join(f.dir, "restored.sqlite.protected");
  await writeFile(restored, "existing recovery data");
  await expect(f.read()).rejects.toThrow();
  expect(await readFile(restored, "utf8")).toBe("existing recovery data");
});

it("does not write into managed storage and cancels before publishing an archive", async () => {
  const f = await fixture();
  await expect(
    createLocalBackup({
      ...f.host,
      destination: join(f.root, "replacement.bin"),
      passphrase: f.passphrase,
    }),
  ).rejects.toThrow("outside");
  const controller = new AbortController();
  const writing = writeStorageArchive({
    database: `${f.active.path}.protected`,
    secret: f.key,
    destination: f.destination,
    passphrase: f.passphrase,
    signal: controller.signal,
  });
  controller.abort();
  await expect(writing).rejects.toThrow();
  expect(existsSync(f.destination)).toBe(false);
  expect(
    (await readdir(f.dir)).filter((name) => name.endsWith(".tmp")),
  ).toEqual([]);
});

it("retains live storage and removes staging files after failed backup publication", async () => {
  const f = await fixture();
  await expect(
    createLocalBackup({
      ...f.host,
      destination: join(f.dir, "missing", "backup"),
      passphrase: f.passphrase,
    }),
  ).rejects.toThrow();
  expect(
    (await readdir(f.root)).some((name) => name.startsWith("backup-")),
  ).toBe(false);
  await f.host.open(f.active.path, f.active.secret);
  await f.host.close();
  await f.backup();
  await f.recover(await f.read());
});

it("reads a bounded piped secret without putting credentials in arguments or normalizing spaces", async () => {
  expect(
    await readBackupPassphrase(
      Readable.from([Buffer.from("  deliberate spaces  \r\n")]),
    ),
  ).toBe("  deliberate spaces  ");
  await expect(
    readBackupPassphrase(Object.assign(Readable.from([]), { isTTY: true })),
  ).rejects.toThrow("Pipe");
  for (const value of [
    "short",
    "passphrase with\nsecond line",
    "x".repeat(17000),
  ])
    await expect(
      readBackupPassphrase(Readable.from([Buffer.from(value)])),
    ).rejects.toThrow();
});

import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createVaultEngine } from "../../packages/client/src/identity/local-vault/engine";
import type { LocalData } from "../../packages/client/src/identity/local-profiles";
import { ProtectedFiles } from "../../apps/desktop/src/main/identity/protected-files";
import { openManagedStorage } from "../../apps/desktop/src/main/identity/storage-key";
import { restoreLocalProfiles } from "../../apps/desktop/src/main/storage/restore";
import { writeStorageArchive } from "../../apps/desktop/src/main/storage/archive";
import { stageLocalBackup } from "../../apps/desktop/src/utility/storage/backup";
import {
  prepareLocalRestore,
  mergeLocalRestore,
  type RestoreSource,
} from "../../apps/desktop/src/utility/storage/restore";
import { openProtectedDatabase } from "../../apps/desktop/src/utility/storage/database";
import { localVaultStore } from "../../apps/desktop/src/utility/storage/local-vaults";
import {
  sealCacheValue,
  openCacheValue,
} from "../../apps/desktop/src/utility/storage/cipher";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function fixture(invalidSchema = false) {
  const dir = await mkdtemp(join(tmpdir(), "suite-restore-command-"));
  const source = join(dir, "source.sqlite"),
    snapshot = join(dir, "snapshot.sqlite");
  const sourceKey = randomBytes(32),
    archiveKey = randomBytes(32),
    providerKey = randomBytes(32);
  const archive = join(dir, "local.commonbackup"),
    root = join(dir, "target", "secure-cache");
  let db: ReturnType<typeof openProtectedDatabase> | undefined;
  cleanup.push(async () => {
    if (db?.open) db.close();
    await rm(dir, { recursive: true, force: true });
  });
  db = openProtectedDatabase(source, sourceKey, () => {});
  const created = await createVaultEngine(
    localVaultStore(db, () => {}),
  ).createVault("Portable owner", "original vault passphrase", {
    records: { contacts: [{ name: "Portable contact" }] },
    capabilityGrants: [{ id: "old-device" }],
    deviceRequests: {
      pending: {
        id: "pending",
        state: "pending",
        attemptId: "original-attempt",
        createdAt: 1,
        grantId: "old-device",
        call: {
          moduleId: "contacts",
          moduleVersion: "1.0.0",
          capability: "export",
          input: { filename: "contact.txt", content: "Captured work" },
        },
      },
    },
  });
  db.close();
  stageLocalBackup(source, sourceKey, snapshot, archiveKey);
  if (invalidSchema) {
    db = openProtectedDatabase(snapshot, archiveKey, () => {});
    db.exec("CREATE TABLE credentials(value TEXT)");
    db.close();
  }
  await writeStorageArchive({
    database: `${snapshot}.protected`,
    secret: archiveKey,
    destination: archive,
    passphrase: "independent archive passphrase",
  });
  let providerAvailable = true;
  const files = new ProtectedFiles(() => root, {
    available: () => providerAvailable,
    encrypt: async (value) =>
      sealCacheValue(providerKey, "test-provider", Buffer.from(value)),
    decrypt: async (bytes) => ({
      result: openCacheValue(providerKey, "test-provider", bytes).toString(),
      shouldReEncrypt: false,
    }),
  });
  const host = {
    root,
    files,
    async open(path: string, secret: string) {
      if (db?.open) throw Error("Already open");
      db = openProtectedDatabase(path, Buffer.from(secret, "base64"), () => {});
      localVaultStore(db, () => {});
    },
    async close() {
      if (db?.open) db.close();
    },
    async prepare(path: string, secret: string, source: RestoreSource) {
      prepareLocalRestore(
        source.path,
        Buffer.from(source.secret, "base64"),
        path,
        Buffer.from(secret, "base64"),
      );
    },
    async merge(source: RestoreSource) {
      return mergeLocalRestore(
        db!,
        source.path,
        Buffer.from(source.secret, "base64"),
      );
    },
  };
  const options = {
    ...host,
    archive,
    passphrase: "independent archive passphrase",
  };
  const open = async () => {
    const active = await openManagedStorage({ ...host, rotate: false });
    return {
      active,
      db: db!,
      engine: createVaultEngine(localVaultStore(db!, () => {})),
    };
  };
  const staged = async () =>
    (await readdir(join(dir, "target"))).filter((name) =>
      name.startsWith(".local-restore-"),
    );
  return {
    root,
    archive,
    archiveKey,
    created,
    host,
    options,
    open,
    staged,
    unavailable() {
      providerAvailable = false;
    },
  };
}

it("imports alongside existing profiles and corporate work, then preserves later edits on replay", async () => {
  const f = await fixture();
  let live = await f.open();
  const existing = await live.engine.createVault(
    "Existing owner",
    "existing vault passphrase",
    { records: {} },
  );
  const cacheKey = "account/company/pending";
  const sealed = sealCacheValue(
    Buffer.from(live.active.secret, "base64"),
    cacheKey,
    Buffer.from('[{"id":"same-request"}]'),
  );
  live.db.prepare("INSERT INTO cache VALUES(?,?)").run(cacheKey, sealed);
  await f.host.close();
  expect(await restoreLocalProfiles(f.options)).toEqual({
    count: 1,
    alreadyRestored: false,
  });
  live = await f.open();
  expect(await live.engine.listLocalProfiles()).toHaveLength(2);
  expect(
    (
      await live.engine.unlockVault(
        existing.vault.id,
        "existing vault passphrase",
      )
    ).data,
  ).toEqual({ records: {} });
  expect(
    live.db.prepare("SELECT payload FROM cache WHERE key=?").get(cacheKey),
  ).toEqual({ payload: sealed });
  const restored = await live.engine.unlockVault<LocalData>(
    f.created.vault.id,
    "original vault passphrase",
  );
  expect(restored.data.capabilityGrants).toEqual([]);
  expect(restored.data.deviceRequests?.pending).toMatchObject({
    state: "uncertain",
    attemptId: "original-attempt",
  });
  await live.engine.commitVault(
    restored.vault,
    restored.key,
    { records: { contacts: [{ name: "Edited later" }] } },
    restored.vault.revision!,
    undefined,
    () => true,
  );
  await f.host.close();
  expect(await restoreLocalProfiles(f.options)).toEqual({
    count: 1,
    alreadyRestored: true,
  });
  live = await f.open();
  expect(
    (
      await live.engine.unlockVault(
        f.created.vault.id,
        "original vault passphrase",
      )
    ).data,
  ).toEqual({ records: { contacts: [{ name: "Edited later" }] } });
  await f.host.close();
  expect(await f.staged()).toEqual([]);
});

it("rejects an incorrect archive passphrase before creating protected storage", async () => {
  const f = await fixture();
  const original = await readFile(f.archive);
  await expect(
    restoreLocalProfiles({
      ...f.options,
      passphrase: "incorrect archive passphrase",
    }),
  ).rejects.toThrow();
  expect(existsSync(f.root)).toBe(false);
  expect(await f.staged()).toEqual([]);
  expect(await readFile(f.archive)).toEqual(original);
});

it("does not open the target when authenticated archive schema validation fails", async () => {
  const f = await fixture(true);
  const original = await readFile(f.archive);
  await expect(restoreLocalProfiles(f.options)).rejects.toThrow("schema");
  expect(existsSync(f.root)).toBe(false);
  expect(await f.staged()).toEqual([]);
  expect(await readFile(f.archive)).toEqual(original);
});

it("can retry a lost merge acknowledgement without replacing recovered changes", async () => {
  const f = await fixture();
  await expect(
    restoreLocalProfiles({
      ...f.options,
      merge: async (source) => {
        await f.host.merge(source);
        throw Error("Reply lost after commit");
      },
    }),
  ).rejects.toThrow("Reply lost");
  const live = await f.open();
  const restored = await live.engine.unlockVault(
    f.created.vault.id,
    "original vault passphrase",
  );
  await live.engine.commitVault(
    restored.vault,
    restored.key,
    { records: {} },
    restored.vault.revision!,
    undefined,
    () => true,
  );
  await f.host.close();
  expect(await restoreLocalProfiles(f.options)).toEqual({
    count: 1,
    alreadyRestored: true,
  });
  const reopened = await f.open();
  expect(await reopened.engine.listLocalProfiles()).toHaveLength(1);
  expect(
    (
      await reopened.engine.unlockVault(
        f.created.vault.id,
        "original vault passphrase",
      )
    ).data,
  ).toEqual({ records: {} });
});

it("preserves inaccessible original storage when the OS provider is unavailable", async () => {
  const f = await fixture();
  const { active } = await f.open();
  await f.host.close();
  const before = await readFile(`${active.path}.protected`);
  const key = await readFile(join(f.root, "cache-secret.bin"));
  f.unavailable();
  await expect(restoreLocalProfiles(f.options)).rejects.toThrow(
    "Protected storage",
  );
  expect(await readFile(`${active.path}.protected`)).toEqual(before);
  expect(await readFile(join(f.root, "cache-secret.bin"))).toEqual(key);
  expect(await f.staged()).toEqual([]);
});

it("cancels after preparation without initializing a target store", async () => {
  const f = await fixture();
  const controller = new AbortController();
  await expect(
    restoreLocalProfiles({
      ...f.options,
      signal: controller.signal,
      prepare: async (...args) => {
        await f.host.prepare(...args);
        controller.abort();
      },
    }),
  ).rejects.toThrow();
  expect(existsSync(f.root)).toBe(false);
  expect(await f.staged()).toEqual([]);
});

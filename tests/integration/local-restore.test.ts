import { afterEach, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createVaultEngine } from "../../packages/client/src/identity/local-vault/engine";
import {
  localVaultStore,
  importLocalVaults,
} from "../../apps/desktop/src/utility/storage/local-vaults";
import { openProtectedDatabase } from "../../apps/desktop/src/utility/storage/database";
import {
  prepareLocalRestore,
  mergeLocalRestore,
} from "../../apps/desktop/src/utility/storage/restore";
import { stageLocalBackup } from "../../apps/desktop/src/utility/storage/backup";
import { sealCacheValue } from "../../apps/desktop/src/utility/storage/cipher";
import type { LocalData } from "../../packages/client/src/identity/local-profiles";

const directories: string[] = [];
const connections: ReturnType<typeof openProtectedDatabase>[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) if (db.open) db.close();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "suite-local-restore-"));
  directories.push(root);
  const source = join(root, "source.sqlite"),
    backup = join(root, "backup.sqlite"),
    prepared = join(root, "prepared.sqlite"),
    live = join(root, "live.sqlite");
  const sourceKey = randomBytes(32),
    archiveKey = randomBytes(32),
    restoredKey = randomBytes(32),
    liveKey = randomBytes(32);
  const open = (path: string, key: Buffer) => {
    const db = openProtectedDatabase(path, key, () => {
      throw Error("Unexpected legacy import");
    });
    connections.push(db);
    return db;
  };
  let db = open(source, sourceKey);
  const engine = createVaultEngine(localVaultStore(db, () => {}));
  const pending = crypto.randomUUID(),
    running = crypto.randomUUID(),
    completed = crypto.randomUUID();
  const created = await engine.createVault(
    "Recovered owner",
    "original profile passphrase",
    {
      records: { contacts: [{ name: "Retained contact" }] },
      capabilityGrants: [{ id: "original-device-grant" }],
      deviceRequests: {
        [pending]: {
          id: pending,
          state: "pending",
          call: { capability: "download" },
        },
        [running]: {
          id: running,
          state: "running",
          attemptId: "exact-attempt",
          call: { capability: "download" },
        },
        [completed]: {
          id: completed,
          state: "completed",
          result: { saved: true },
        },
      },
    },
  );
  db.close();
  stageLocalBackup(source, sourceKey, backup, archiveKey);
  const prepare = () =>
    prepareLocalRestore(
      `${backup}.protected`,
      archiveKey,
      prepared,
      restoredKey,
    );
  const destination = () => {
    db = open(live, liveKey);
    localVaultStore(db, () => {});
    return db;
  };
  return {
    root,
    source,
    backup,
    prepared,
    sourceKey,
    archiveKey,
    restoredKey,
    liveKey,
    created,
    pending,
    running,
    completed,
    open,
    prepare,
    destination,
  };
}

it("stages under a fresh device key and revokes copied device grants before the first unlocked result", async () => {
  const f = await fixture();
  f.prepare();
  const db = f.open(f.prepared, f.restoredKey),
    store = localVaultStore(db, () => {}),
    engine = createVaultEngine(store);
  expect((await store.get(f.created.vault.id))?.recoveryRequired).toBe(true);
  await expect(
    engine.unlockVault(f.created.vault.id, "wrong passphrase"),
  ).rejects.toThrow();
  expect((await store.get(f.created.vault.id))?.recoveryRequired).toBe(true);
  await expect(
    engine.configureLocalUnlock(
      f.created.vault.id,
      "original profile passphrase",
      "12345678",
      false,
    ),
  ).rejects.toThrow("Unlock the restored profile");
  const unlocked = await engine.unlockVault<LocalData>(
    f.created.vault.id,
    "original profile passphrase",
  );
  expect(unlocked.data.records).toEqual({
    contacts: [{ name: "Retained contact" }],
  });
  expect(unlocked.data.capabilityGrants).toEqual([]);
  expect(unlocked.data.deviceRequests?.[f.pending]?.state).toBe("uncertain");
  expect(unlocked.data.deviceRequests?.[f.running]).toMatchObject({
    state: "uncertain",
    attemptId: "exact-attempt",
  });
  expect(unlocked.data.deviceRequests?.[f.completed]).toMatchObject({
    state: "completed",
    result: { saved: true },
  });
  expect(unlocked.vault.recoveryRequired).toBeUndefined();
  expect(unlocked.vault.revision).toBe(1);
  db.close();
  expect(() => f.open(f.prepared, f.archiveKey)).toThrow();
  const reopened = createVaultEngine(
    localVaultStore(f.open(f.prepared, f.restoredKey), () => {}),
  );
  expect(
    (
      await reopened.unlockVault(
        f.created.vault.id,
        "original profile passphrase",
      )
    ).data,
  ).toEqual(unlocked.data);
});

it("atomically merges into live storage, retains corporate rows and never overwrites later edits on replay", async () => {
  const f = await fixture();
  f.prepare();
  const db = f.destination(),
    store = localVaultStore(db, () => {});
  const retained = sealCacheValue(
    f.liveKey,
    "account/workspace/pending",
    Buffer.from('[{"id":"retained-corporate-attempt"}]'),
  );
  db.prepare("INSERT INTO cache VALUES(?,?)").run(
    "account/workspace/pending",
    retained,
  );
  expect(
    mergeLocalRestore(db, `${f.prepared}.protected`, f.restoredKey),
  ).toEqual({ count: 1, alreadyRestored: false });
  const engine = createVaultEngine(store);
  const opened = await engine.unlockVault(
    f.created.vault.id,
    "original profile passphrase",
  );
  await engine.commitVault(
    opened.vault,
    opened.key,
    { records: { newer: [] } },
    opened.vault.revision!,
    undefined,
    () => true,
  );
  expect(
    mergeLocalRestore(db, `${f.prepared}.protected`, f.restoredKey),
  ).toEqual({ count: 1, alreadyRestored: true });
  expect(
    ["-wal", "-shm", "-journal"].some((suffix) =>
      existsSync(`${f.prepared}.protected${suffix}`),
    ),
  ).toBe(false);
  expect(
    (
      await engine.unlockVault(
        f.created.vault.id,
        "original profile passphrase",
      )
    ).data,
  ).toEqual({ records: { newer: [] } });
  expect(db.prepare("SELECT payload FROM cache").get()).toEqual({
    payload: retained,
  });
});

it("rejects profile collisions without partial copies or changes to existing work", async () => {
  const f = await fixture();
  f.prepare();
  const db = f.destination(),
    store = localVaultStore(db, () => {});
  await store.add(f.created.vault);
  const before = (await store.get(f.created.vault.id))!.ciphertext;
  expect(() =>
    mergeLocalRestore(db, `${f.prepared}.protected`, f.restoredKey),
  ).toThrow("already exists");
  expect((await store.get(f.created.vault.id))!.ciphertext).toEqual(before);
  expect(
    db.prepare("SELECT COUNT(*) AS count FROM local_vaults").get(),
  ).toEqual({ count: 1 });
  expect(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='local_backup_restores'")
      .get(),
  ).toBeUndefined();
});

for (const attack of [
  "trigger",
  "corporate-cache",
  "table",
  "profile-id",
  "migration-receipt",
] as const) {
  it(`refuses an authenticated archive with unexpected ${attack} contents`, async () => {
    const f = await fixture();
    const db = f.open(f.backup, f.archiveKey);
    if (attack === "trigger")
      db.exec(
        "CREATE TRIGGER unexpected AFTER INSERT ON local_vaults BEGIN DELETE FROM local_vaults; END",
      );
    if (attack === "corporate-cache")
      db.prepare("INSERT INTO cache VALUES(?,?)").run(
        "private/company",
        Buffer.from("not eligible"),
      );
    if (attack === "table") db.exec("CREATE TABLE credentials(value TEXT)");
    if (attack === "profile-id")
      db.prepare("UPDATE local_vaults SET id=?").run(crypto.randomUUID());
    if (attack === "migration-receipt")
      db.prepare("INSERT INTO local_vault_imports VALUES(?,?)").run(
        f.created.vault.id,
        "invalid",
      );
    db.close();
    const before = readFileSync(`${f.backup}.protected`);
    expect(f.prepare).toThrow();
    expect(readFileSync(`${f.backup}.protected`)).toEqual(before);
  });
}

it("does not bypass restoration safeguards when legacy IndexedDB profiles are imported afterward", async () => {
  const f = await fixture();
  f.prepare();
  const db = f.open(f.prepared, f.restoredKey);
  const another = await createVaultEngine(
    localVaultStore(f.open(f.source, f.sourceKey), () => {}),
  ).createVault("Legacy", "another profile passphrase", {
    records: {},
    capabilityGrants: [{ id: "stale" }],
  });
  importLocalVaults(db, [another.vault]);
  const restored = await createVaultEngine(
    localVaultStore(db, () => {}),
  ).unlockVault<LocalData>(another.vault.id, "another profile passphrase");
  expect(restored.data.capabilityGrants).toEqual([]);
});

it("keeps the recovery marker when unlock is cancelled before its atomic update", async () => {
  const f = await fixture();
  f.prepare();
  const db = f.open(f.prepared, f.restoredKey),
    store = localVaultStore(db, () => {});
  const controller = new AbortController();
  const engine = createVaultEngine({
    ...store,
    update: async (id, change) => {
      controller.abort();
      return store.update(id, change);
    },
  });
  await expect(
    engine.unlockVault(
      f.created.vault.id,
      "original profile passphrase",
      controller.signal,
    ),
  ).rejects.toThrow();
  expect((await store.get(f.created.vault.id))?.recoveryRequired).toBe(true);
  expect((await store.get(f.created.vault.id))?.revision).toBe(0);
});

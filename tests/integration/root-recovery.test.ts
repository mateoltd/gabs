import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
  rename,
  symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createVaultEngine } from "../../packages/client/src/identity/local-vault/engine";
import { ProtectedFiles } from "../../apps/desktop/src/main/identity/protected-files";
import { openManagedStorage } from "../../apps/desktop/src/main/identity/storage-key";
import {
  recoverLocalProfiles,
  resumeLocalRecovery,
} from "../../apps/desktop/src/main/storage/recovery";
import { writeStorageArchive } from "../../apps/desktop/src/main/storage/archive";
import { stageLocalBackup } from "../../apps/desktop/src/utility/storage/backup";
import { prepareLocalRestore } from "../../apps/desktop/src/utility/storage/restore";
import { openProtectedDatabase } from "../../apps/desktop/src/utility/storage/database";
import { verifyProtectedDatabase } from "../../apps/desktop/src/utility/storage/rotation";
import { localVaultStore } from "../../apps/desktop/src/utility/storage/local-vaults";
import {
  sealCacheValue,
  openCacheValue,
} from "../../apps/desktop/src/utility/storage/cipher";

const fault = vi.hoisted(() => ({ phase: "", once: false }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  const stop = (phase: string) => {
    if (fault.phase === phase && !fault.once) {
      fault.once = true;
      throw Error(`Interrupted ${phase}`);
    }
  };
  return {
    ...fs,
    link: async (...args: Parameters<typeof fs.link>) => {
      await fs.link(...args);
      if (String(args[1]).endsWith(".recovery.json")) stop("preparing");
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      await fs.rename(...args);
      if (String(args[1]).endsWith(".recovery.json")) stop("intent");
      if (String(args[1]).includes(".retained-")) stop("retained");
      if (String(args[1]).endsWith("secure-cache")) stop("activated");
    },
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (String(args[0]).endsWith(".recovery.json")) stop("cleanup");
      return fs.rm(...args);
    },
  };
});
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  fault.phase = "";
  fault.once = false;
  for (const close of cleanup.splice(0)) await close();
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "suite-root-recovery-"));
  const root = join(dir, "secure-cache"),
    snapshot = join(dir, "snapshot.sqlite"),
    archive = join(dir, "local.commonbackup");
  const oldProvider = randomBytes(32),
    newProvider = randomBytes(32),
    archiveKey = randomBytes(32);
  let provider = oldProvider,
    available = true;
  let db: ReturnType<typeof openProtectedDatabase> | undefined;
  cleanup.push(async () => {
    if (db?.open) db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const filesFor = (path: string) =>
    new ProtectedFiles(() => path, {
      available: () => available,
      encrypt: async (value) =>
        sealCacheValue(provider, "provider", Buffer.from(value)),
      decrypt: async (value) => ({
        result: openCacheValue(provider, "provider", value).toString(),
        shouldReEncrypt: false,
      }),
    });
  const host = {
    root,
    filesFor,
    async open(
      path: string,
      secret: string,
      _source?: unknown,
      verify = false,
    ) {
      if (db?.open) throw Error("Already open");
      const key = Buffer.from(secret, "base64");
      db = openProtectedDatabase(path, key, () => {});
      localVaultStore(db, () => {});
      if (verify) verifyProtectedDatabase(db, key);
    },
    async close() {
      if (db?.open) db.close();
    },
    async prepare(
      path: string,
      secret: string,
      source: { path: string; secret: string },
    ) {
      prepareLocalRestore(
        source.path,
        Buffer.from(source.secret, "base64"),
        path,
        Buffer.from(secret, "base64"),
      );
    },
  };
  const active = await openManagedStorage({
    ...host,
    files: filesFor(root),
    rotate: false,
  });
  const engine = createVaultEngine(localVaultStore(db!, () => {}));
  const profile = await engine.createVault(
    "Recovered profile",
    "original profile passphrase",
    { records: { contacts: [{ name: "Archived contact" }] } },
  );
  db!
    .prepare("INSERT INTO cache VALUES(?,?)")
    .run(
      "account/company/pending",
      sealCacheValue(
        Buffer.from(active.secret, "base64"),
        "account/company/pending",
        Buffer.from('[{"id":"retained-corporate-request"}]'),
      ),
    );
  await host.close();
  stageLocalBackup(
    active.path,
    Buffer.from(active.secret, "base64"),
    snapshot,
    archiveKey,
  );
  await writeStorageArchive({
    database: `${snapshot}.protected`,
    secret: archiveKey,
    destination: archive,
    passphrase: "independent archive passphrase",
  });
  await filesFor(root).write("credentials", {
    refreshToken: "retained-original-only",
  });
  const original = new Map(
    await Promise.all(
      (await readdir(root)).map(
        async (name) => [name, await readFile(join(root, name))] as const,
      ),
    ),
  );
  provider = newProvider; // Old OS wrapper cannot decrypt; new encryption remains available.
  const options = {
    ...host,
    archive,
    passphrase: "independent archive passphrase",
  };
  const read = async () => {
    await openManagedStorage({ ...host, files: filesFor(root), rotate: false });
    const engine = createVaultEngine(localVaultStore(db!, () => {}));
    return {
      engine,
      db: db!,
      opened: await engine.unlockVault(
        profile.vault.id,
        "original profile passphrase",
      ),
    };
  };
  const unchanged = async (path: string) => {
    for (const [name, value] of original)
      expect(await readFile(join(path, name))).toEqual(value);
    expect(await readdir(path)).toEqual([...original.keys()]);
  };
  return {
    dir,
    root,
    options,
    host,
    read,
    unchanged,
    unavailable() {
      available = false;
    },
  };
}

it("replaces unreadable storage under a fresh OS key while retaining the complete original", async () => {
  const f = await fixture();
  await expect(f.host.filesFor(f.root).read("cache-secret")).rejects.toThrow();
  const result = await recoverLocalProfiles(f.options);
  await f.unchanged(result.retained);
  const { opened, db } = await f.read();
  expect(opened.data).toMatchObject({
    records: { contacts: [{ name: "Archived contact" }] },
    capabilityGrants: [],
  });
  expect(db.prepare("SELECT COUNT(*) AS count FROM cache").get()).toEqual({
    count: 0,
  });
  expect(await f.host.filesFor(f.root).read("credentials")).toBeUndefined();
  expect(existsSync(`${f.root}.recovery.json`)).toBe(false);
});
for (const phase of ["intent", "retained", "activated", "cleanup"]) {
  it(`resumes a durable ${phase} interruption and never overwrites newer recovered work`, async () => {
    const f = await fixture();
    fault.phase = phase;
    await expect(recoverLocalProfiles(f.options)).rejects.toThrow(
      "Interrupted",
    );
    expect(existsSync(`${f.root}.recovery.json`)).toBe(true);
    fault.phase = "";
    if (phase === "activated" || phase === "cleanup") {
      const { opened, engine } = await f.read();
      await engine.commitVault(
        opened.vault,
        opened.key,
        { records: { contacts: [{ name: "Newer accepted work" }] } },
        opened.vault.revision!,
        undefined,
        () => true,
      );
      await f.host.close();
    }
    const result = await resumeLocalRecovery(f.host);
    await f.unchanged(result!.retained);
    const { opened } = await f.read();
    expect(opened.data).toMatchObject({
      records: {
        contacts: [
          {
            name:
              phase === "activated" || phase === "cleanup"
                ? "Newer accepted work"
                : "Archived contact",
          },
        ],
      },
    });
    await f.host.close();
    expect(await resumeLocalRecovery(f.host)).toBeUndefined();
  });
}
it("recognizes an already recovered archive and preserves edits; explicit new recovery retains them separately", async () => {
  const f = await fixture();
  const first = await recoverLocalProfiles(f.options);
  const { opened, engine } = await f.read();
  await engine.commitVault(
    opened.vault,
    opened.key,
    { records: { contacts: [{ name: "Later edit" }] } },
    opened.vault.revision!,
    undefined,
    () => true,
  );
  await f.host.close();
  expect(await recoverLocalProfiles(f.options)).toEqual({
    ...first,
    alreadyRecovered: true,
  });
  expect((await f.read()).opened.data).toEqual({
    records: { contacts: [{ name: "Later edit" }] },
  });
  await f.host.close();
  const fresh = await recoverLocalProfiles({
    ...f.options,
    forceNewRecovery: true,
  });
  expect(fresh.retained).not.toBe(first.retained);
  expect(existsSync(first.retained)).toBe(true);
  expect(existsSync(fresh.retained)).toBe(true);
  expect((await f.read()).opened.data).toMatchObject({
    records: { contacts: [{ name: "Archived contact" }] },
  });
});
it("rejects a wrong archive password without touching the unreadable original", async () => {
  const f = await fixture();
  await expect(
    recoverLocalProfiles({
      ...f.options,
      passphrase: "incorrect archive passphrase",
    }),
  ).rejects.toThrow();
  await f.unchanged(f.root);
  expect(
    (await readdir(f.dir)).some((name) => name.includes(".recovery")),
  ).toBe(false);
});
it("requires current protected storage before publishing any recovery intent", async () => {
  const f = await fixture();
  f.unavailable();
  await expect(recoverLocalProfiles(f.options)).rejects.toThrow(
    "Protected storage",
  );
  await f.unchanged(f.root);
  expect(existsSync(`${f.root}.recovery.json`)).toBe(false);
});
it("fails closed on a malformed recovery intent without opening or moving storage", async () => {
  const f = await fixture();
  await writeFile(
    `${f.root}.recovery.json`,
    JSON.stringify({ version: 1, id: "../../other" }),
  );
  await expect(resumeLocalRecovery(f.host)).rejects.toThrow(
    "Invalid local recovery",
  );
  await f.unchanged(f.root);
});

it("abandons a durably recorded preparation without moving the original", async () => {
  const f = await fixture();
  fault.phase = "preparing";
  await expect(recoverLocalProfiles(f.options)).rejects.toThrow("Interrupted");
  fault.phase = "";
  expect(await resumeLocalRecovery(f.host)).toBeUndefined();
  await f.unchanged(f.root);
  expect(
    (await readdir(f.dir)).some((name) => name.includes(".recovery")),
  ).toBe(false);
});

it("preserves an unexpected active directory instead of replacing it on resume", async () => {
  const f = await fixture();
  fault.phase = "retained";
  await expect(recoverLocalProfiles(f.options)).rejects.toThrow("Interrupted");
  fault.phase = "";
  await mkdir(f.root);
  await writeFile(join(f.root, "newer-work"), "preserve this directory");
  await expect(resumeLocalRecovery(f.host)).rejects.toThrow(
    "Recovery paths changed",
  );
  expect(await readFile(join(f.root, "newer-work"), "utf8")).toBe(
    "preserve this directory",
  );
  const retained = (await readdir(f.dir)).find((name) =>
    name.startsWith("secure-cache.retained-"),
  )!;
  await f.unchanged(join(f.dir, retained));
});
it("refuses a staged-directory link without touching the target or original", async () => {
  const f = await fixture();
  fault.phase = "intent";
  await expect(recoverLocalProfiles(f.options)).rejects.toThrow("Interrupted");
  fault.phase = "";
  const staged = join(
    f.dir,
    (await readdir(f.dir)).find((name) =>
      name.startsWith("secure-cache.recovery-"),
    )!,
  );
  const held = `${staged}.held`;
  await rename(staged, held);
  await symlink(held, staged, "junction");
  await expect(resumeLocalRecovery(f.host)).rejects.toThrow(
    "ordinary directories",
  );
  await f.unchanged(f.root);
  expect(existsSync(join(held, "cache-secret.bin"))).toBe(true);
});

import { afterEach, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ProtectedFiles } from "../../apps/desktop/src/main/identity/protected-files";
import {
  openManagedStorage,
  type StorageKeyRecord,
} from "../../apps/desktop/src/main/identity/storage-key";
import { openProtectedDatabase } from "../../apps/desktop/src/utility/storage/database";
import {
  openCacheValue,
  sealCacheValue,
} from "../../apps/desktop/src/utility/storage/cipher";
import {
  stageDatabaseRotation,
  verifyProtectedDatabase,
} from "../../apps/desktop/src/utility/storage/rotation";

const directories: string[] = [];
const connections: ReturnType<typeof openProtectedDatabase>[] = [];
afterEach(async () => {
  for (const db of connections.splice(0)) if (db.open) db.close();
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "suite-storage-rotation-"));
  directories.push(root);
  const provider = randomBytes(32);
  const files = new ProtectedFiles(() => root, {
    available: () => true,
    encrypt: async (text) =>
      sealCacheValue(provider, "key-record", Buffer.from(text)),
    decrypt: async (bytes) => ({
      result: openCacheValue(provider, "key-record", bytes).toString(),
      shouldReEncrypt: false,
    }),
  });
  const pathFor = (slot: StorageKeyRecord["active"]) =>
    join(
      root,
      slot.generation === "legacy"
        ? "workspace.sqlite"
        : `workspace-${slot.generation}.sqlite`,
    );
  const record = async () =>
    (await files.read<StorageKeyRecord>("cache-secret"))!;
  const connect = (path: string, secret: string) => {
    const key = Buffer.from(secret, "base64");
    const db = openProtectedDatabase(path, key, (row) => {
      JSON.parse(openCacheValue(key, row.key, row.payload).toString());
    });
    connections.push(db);
    return db;
  };
  type Fault =
    | "prepared"
    | "staged"
    | "activate-before"
    | "activate-after"
    | "retire-before"
    | "retire-after";
  const start = async (rotate = false, fault?: Fault) => {
    let db: ReturnType<typeof connect> | undefined;
    let writes = 0;
    try {
      await openManagedStorage({
        root,
        rotate,
        files: {
          read: files.read.bind(files),
          write: async (name, value) => {
            const state = value as StorageKeyRecord;
            const phase = state.rotation?.phase;
            const retirement =
              ++writes > 1 && !phase && state.active.generation !== "legacy";
            if (
              (fault === "activate-before" && phase === "activated") ||
              (fault === "retire-before" && retirement)
            )
              throw Error("interrupted");
            await files.write(name, value);
            if (
              (fault === "prepared" && phase === "prepared") ||
              (fault === "activate-after" && phase === "activated") ||
              (fault === "retire-after" && retirement)
            )
              throw Error("interrupted");
          },
        },
        open: async (path, secret, source, verify) => {
          if (source) {
            stageDatabaseRotation(
              source.sourcePath,
              Buffer.from(source.sourceSecret, "base64"),
              path,
              Buffer.from(secret, "base64"),
            );
            if (fault === "staged") throw Error("interrupted");
          }
          db = connect(path, secret);
          if (verify)
            verifyProtectedDatabase(db, Buffer.from(secret, "base64"));
        },
      });
      return db!;
    } catch (error) {
      if (db?.open) db.close();
      throw error;
    }
  };
  const seed = async () => {
    const db = await start();
    const { active } = await record();
    const secret = Buffer.from(active.secret, "base64");
    for (const [key, value] of Object.entries({
      "account/workspace/pending": [
        { id: "stable-operation", state: "pending", baseVersion: 7 },
      ],
      "account/workspace/draft": { title: "Saved business work" },
    }))
      db.prepare("INSERT INTO cache VALUES(?,?)").run(
        key,
        sealCacheValue(secret, key, Buffer.from(JSON.stringify(value))),
      );
    // Full-file copy must preserve opaque vaults, migration receipts and future schema.
    db.exec(
      "CREATE TABLE local_vaults(id TEXT PRIMARY KEY, envelope BLOB NOT NULL); CREATE TABLE local_vault_imports(id TEXT PRIMARY KEY,digest TEXT); CREATE TABLE future_data(value TEXT)",
    );
    db.prepare("INSERT INTO local_vaults VALUES(?,?)").run(
      "profile",
      Buffer.from("opaque encrypted standalone envelope"),
    );
    db.prepare("INSERT INTO local_vault_imports VALUES(?,?)").run(
      "profile",
      "migration-receipt",
    );
    db.prepare("INSERT INTO future_data VALUES(?)").run(
      "future schema preserved",
    );
    db.close();
    return active;
  };
  const assertWork = (db: ReturnType<typeof connect>, secret: string) => {
    verifyProtectedDatabase(db, Buffer.from(secret, "base64"));
    const row = db
      .prepare<[], { payload: Buffer }>(
        "SELECT payload FROM cache WHERE key='account/workspace/pending'",
      )
      .get()!;
    expect(
      JSON.parse(
        openCacheValue(
          Buffer.from(secret, "base64"),
          "account/workspace/pending",
          row.payload,
        ).toString(),
      ),
    ).toEqual([{ id: "stable-operation", state: "pending", baseVersion: 7 }]);
    expect(db.prepare("SELECT * FROM local_vaults").get()).toEqual({
      id: "profile",
      envelope: Buffer.from("opaque encrypted standalone envelope"),
    });
    expect(db.prepare("SELECT * FROM local_vault_imports").get()).toEqual({
      id: "profile",
      digest: "migration-receipt",
    });
    expect(db.prepare("SELECT * FROM future_data").get()).toEqual({
      value: "future schema preserved",
    });
  };
  return { root, files, record, pathFor, start, seed, connect, assertWork };
}

it("rotates pages and payloads, preserves every table and retires only the previous encrypted generation", async () => {
  const f = await fixture(),
    previous = await f.seed();
  const oldBytes = await readFile(`${f.pathFor(previous)}.protected`);
  const db = await f.start(true);
  const state = await f.record();
  expect(state.rotation).toBeUndefined();
  expect(state.active.secret).not.toBe(previous.secret);
  expect(state.active.generation).not.toBe(previous.generation);
  f.assertWork(db, state.active.secret);
  db.close();
  expect(existsSync(`${f.pathFor(previous)}.protected`)).toBe(false);
  expect(() => f.connect(f.pathFor(state.active), previous.secret)).toThrow();
  const newBytes = await readFile(`${f.pathFor(state.active)}.protected`);
  expect(newBytes).not.toEqual(oldBytes);
  for (const name of await readdir(f.root)) {
    const bytes = await readFile(join(f.root, name));
    for (const text of [
      "stable-operation",
      "account/workspace",
      "future schema",
      previous.secret,
      state.active.secret,
    ])
      expect(bytes.includes(Buffer.from(text))).toBe(false);
  }
  const reopened = await f.start();
  f.assertWork(reopened, state.active.secret);
  reopened.close();
  // A second generation must work as well as the legacy-to-first transition.
  const twice = await f.start(true);
  const final = await f.record();
  f.assertWork(twice, final.active.secret);
  expect(existsSync(`${f.pathFor(state.active)}.protected`)).toBe(false);
});

for (const fault of [
  "prepared",
  "staged",
  "activate-before",
  "activate-after",
  "retire-before",
  "retire-after",
] as const) {
  it(`recovers interruption at ${fault} without needing a repeated rotation flag`, async () => {
    const f = await fixture(),
      previous = await f.seed();
    await expect(f.start(true, fault)).rejects.toThrow("interrupted");
    const interrupted = await f.record();
    if (interrupted.rotation?.phase === "prepared") {
      expect(interrupted.active).toEqual(previous);
      const source = f.connect(f.pathFor(previous), previous.secret);
      f.assertWork(source, previous.secret);
      source.close();
      // Partial/corrupt staged bytes must be rebuilt from the retained authority.
      await writeFile(
        `${f.pathFor(interrupted.rotation.next)}.protected`,
        randomBytes(1024),
      );
    }
    const db = await f.start();
    const state = await f.record();
    f.assertWork(db, state.active.secret);
    expect(state.rotation).toBeUndefined();
    expect(state.active.secret).not.toBe(previous.secret);
    expect(existsSync(`${f.pathFor(previous)}.protected`)).toBe(false);
  });
}

it("keeps the previous generation when activated storage cannot be authenticated", async () => {
  const f = await fixture(),
    previous = await f.seed();
  await expect(f.start(true, "activate-after")).rejects.toThrow();
  const state = await f.record();
  const path = `${f.pathFor(state.active)}.protected`;
  const bytes = await readFile(path);
  bytes[100] ^= 1;
  await writeFile(path, bytes);
  await expect(f.start()).rejects.toThrow();
  expect(existsSync(`${f.pathFor(previous)}.protected`)).toBe(true);
  expect(await readFile(path)).toEqual(bytes);
  expect((await f.record()).rotation?.phase).toBe("activated");
});

it("refuses missing initialized storage and a missing key without replacing business data", async () => {
  const f = await fixture();
  await f.seed();
  (await f.start(true)).close();
  const state = await f.record();
  const path = `${f.pathFor(state.active)}.protected`;
  const bytes = await readFile(path);
  await rm(path);
  await expect(f.start()).rejects.toThrow("active database is missing");
  expect(existsSync(path)).toBe(false);
  await writeFile(path, bytes);
  await f.files.remove("cache-secret");
  await expect(f.start()).rejects.toThrow("storage key is missing");
  expect(await f.files.read("cache-secret")).toBeUndefined();
  expect(await readFile(path)).toEqual(bytes);
});

it("authenticates source cache values before activation and retains originals on failure", async () => {
  const f = await fixture(),
    previous = await f.seed();
  const source = f.connect(f.pathFor(previous), previous.secret);
  source
    .prepare("UPDATE cache SET payload=? WHERE key='account/workspace/draft'")
    .run(randomBytes(50));
  source.close();
  const original = await readFile(`${f.pathFor(previous)}.protected`);
  await expect(f.start(true)).rejects.toThrow();
  expect((await f.record()).active).toEqual(previous);
  expect((await f.record()).rotation?.phase).toBe("prepared");
  expect(await readFile(`${f.pathFor(previous)}.protected`)).toEqual(original);
});

it("upgrades the previous raw-key envelope and validates manifest paths before touching databases", async () => {
  const f = await fixture(),
    previous = await f.seed();
  await f.files.write("cache-secret", previous.secret);
  const db = await f.start(true);
  const state = await f.record();
  f.assertWork(db, state.active.secret);
  db.close();
  await f.files.write("cache-secret", {
    ...state,
    rotation: {
      phase: "prepared",
      next: { ...previous, generation: "../../outside" },
    },
  });
  const before = await readFile(join(f.root, "cache-secret.bin"));
  await expect(f.start()).rejects.toThrow("Invalid storage rotation record");
  expect(await readFile(join(f.root, "cache-secret.bin"))).toEqual(before);
  f.assertWork(
    f.connect(f.pathFor(state.active), state.active.secret),
    state.active.secret,
  );
});

it("rotates across batch boundaries without skipping empty or unicode keys", async () => {
  const f = await fixture(),
    previous = await f.seed();
  const source = f.connect(f.pathFor(previous), previous.secret);
  const names = ["", "ñ", ...Array.from({ length: 300 }, (_, i) => `row-${i}`)];
  for (const name of names)
    source
      .prepare("INSERT INTO cache VALUES(?,?)")
      .run(
        name,
        sealCacheValue(
          Buffer.from(previous.secret, "base64"),
          name,
          Buffer.from(JSON.stringify({ name })),
        ),
      );
  source.close();
  const db = await f.start(true);
  const state = await f.record();
  f.assertWork(db, state.active.secret);
  expect(db.prepare("SELECT COUNT(*) AS count FROM cache").get()).toEqual({
    count: 304,
  });
  for (const name of names) {
    const row = db
      .prepare<[string], { payload: Buffer }>(
        "SELECT payload FROM cache WHERE key=?",
      )
      .get(name)!;
    expect(
      JSON.parse(
        openCacheValue(
          Buffer.from(state.active.secret, "base64"),
          name,
          row.payload,
        ).toString(),
      ),
    ).toEqual({ name });
    expect(() =>
      openCacheValue(Buffer.from(previous.secret, "base64"), name, row.payload),
    ).toThrow();
  }
});

it("finishes retirement from the activated copy without overwriting its newer work", async () => {
  const f = await fixture();
  await f.seed();
  await expect(f.start(true, "activate-after")).rejects.toThrow();
  const state = await f.record();
  const active = f.connect(f.pathFor(state.active), state.active.secret);
  active
    .prepare("INSERT INTO cache VALUES(?,?)")
    .run(
      "newer",
      sealCacheValue(
        Buffer.from(state.active.secret, "base64"),
        "newer",
        Buffer.from('{"retained":true}'),
      ),
    );
  active.close();
  const db = await f.start();
  expect(db.prepare("SELECT COUNT(*) AS count FROM cache").get()).toEqual({
    count: 3,
  });
  verifyProtectedDatabase(db, Buffer.from(state.active.secret, "base64"));
  expect((await f.record()).active).toEqual(state.active);
});

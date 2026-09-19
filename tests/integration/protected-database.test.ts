import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fork } from "node:child_process";
import { once } from "node:events";
import { build } from "esbuild";
import { openProtectedDatabase } from "../../apps/desktop/src/utility/storage/database";

const directories: string[] = [];
const connections: ReturnType<typeof openProtectedDatabase>[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "suite-protected-database-"));
  directories.push(directory);
  const path = join(directory, "workspace.sqlite");
  const key = randomBytes(32);
  const validate = (row: { key: string; payload: Buffer }) => {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      row.payload.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(row.key));
    decipher.setAuthTag(row.payload.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(row.payload.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
  };
  const open = (secret = key, check = validate) => {
    const db = openProtectedDatabase(path, secret, check);
    connections.push(db);
    return db;
  };
  const legacy = (rows: Record<string, unknown>) => {
    const db = new DatabaseSync(path);
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE cache(key TEXT PRIMARY KEY,payload BLOB NOT NULL)",
    );
    for (const [name, value] of Object.entries(rows)) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(name));
      const bytes = Buffer.concat([
        cipher.update(JSON.stringify(value)),
        cipher.final(),
      ]);
      db.prepare("INSERT INTO cache VALUES(?,?)").run(
        name,
        Buffer.concat([iv, cipher.getAuthTag(), bytes]),
      );
    }
    db.close();
  };
  return { directory, path, key, open, legacy, validate };
}
it("encrypts page metadata, data and live WAL, and rejects unkeyed/wrong-key readers without changing data", () => {
  const f = fixture();
  const db = f.open();
  db.pragma("wal_autocheckpoint=0");
  const metadata = "private-account/private-workspace/unconfirmed-order";
  const input = "sensitive pending stock adjustment";
  db.prepare("INSERT INTO cache VALUES(?,?)").run(metadata, Buffer.from(input));
  const files = readdirSync(f.directory);
  expect(files).toContain("workspace.sqlite.protected-wal");
  for (const file of files) {
    const bytes = readFileSync(join(f.directory, file));
    for (const needle of [metadata, input, "CREATE TABLE cache"])
      expect(bytes.includes(Buffer.from(needle))).toBe(false);
  }
  if (process.platform !== "win32")
    expect(statSync(`${f.path}.protected`).mode & 0o777).toBe(0o600);
  db.close();
  const before = readFileSync(`${f.path}.protected`);
  expect(before.subarray(0, 16).toString()).not.toBe("SQLite format 3\0");
  const plain = new DatabaseSync(`${f.path}.protected`, { readOnly: true });
  try {
    expect(() => plain.prepare("SELECT * FROM sqlite_master").all()).toThrow();
  } finally {
    plain.close();
  }
  expect(() => f.open(randomBytes(32))).toThrow();
  expect(readFileSync(`${f.path}.protected`)).toEqual(before);
  expect(
    f.open().prepare("SELECT payload FROM cache WHERE key=?").get(metadata),
  ).toEqual({ payload: Buffer.from(input) });
});
it("authenticates and migrates pending work before retiring the legacy database and sidecars", () => {
  const f = fixture();
  f.legacy({
    "account/workspace/pending": [{ id: "stable-attempt", state: "pending" }],
    "account/workspace/drafts": { note: "retained" },
  });
  expect(
    readFileSync(f.path).includes(Buffer.from("account/workspace/pending")),
  ).toBe(true);
  const db = f.open();
  const rows = db
    .prepare<[], { key: string; payload: Buffer }>(
      "SELECT key,payload FROM cache ORDER BY key",
    )
    .all();
  expect(rows.map(f.validate)).toEqual([
    { note: "retained" },
    [{ id: "stable-attempt", state: "pending" }],
  ]);
  expect(existsSync(f.path)).toBe(false);
  expect(
    readdirSync(f.directory).every((name) =>
      name.startsWith("workspace.sqlite.protected"),
    ),
  ).toBe(true);
  db.close();
  expect(f.open().prepare("SELECT COUNT(*) AS count FROM cache").get()).toEqual(
    { count: 2 },
  );
});
it("rolls back a rejected partial import and leaves the source recoverable for a corrected retry", () => {
  const f = fixture();
  f.legacy({ first: { pending: true }, second: { draft: true } });
  const before = readFileSync(f.path);
  let checked = 0;
  expect(() =>
    f.open(f.key, (row) => {
      if (++checked === 2) throw Error("corrupt payload");
      return f.validate(row);
    }),
  ).toThrow("corrupt payload");
  expect(checked).toBe(2);
  expect(readFileSync(f.path)).toEqual(before);
  expect(existsSync(`${f.path}.protected`)).toBe(false);
  expect(f.open().prepare("SELECT COUNT(*) AS count FROM cache").get()).toEqual(
    { count: 2 },
  );
});
it("does not retire a legacy row whose authentication fails", () => {
  const f = fixture();
  f.legacy({ pending: { id: "retained" } });
  const db = new DatabaseSync(f.path);
  db.prepare("UPDATE cache SET payload=?").run(randomBytes(80));
  db.close();
  const original = readFileSync(f.path);
  expect(() => f.open()).toThrow();
  expect(readFileSync(f.path)).toEqual(original);
  expect(existsSync(`${f.path}.protected`)).toBe(false);
});
it("resumes post-commit legacy retirement without replacing newer authoritative records", () => {
  const f = fixture();
  f.legacy({ pending: { id: "original" } });
  const db = f.open();
  db.prepare("UPDATE cache SET payload=? WHERE key='pending'").run(
    Buffer.from("new accepted outcome"),
  );
  // Durable state after import commit and before legacy cleanup completes.
  db.prepare("UPDATE storage_format SET legacy='imported'").run();
  db.close();
  f.legacy({ pending: { id: "stale" } });
  const reopened = f.open();
  expect(
    reopened.prepare("SELECT payload FROM cache WHERE key='pending'").get(),
  ).toEqual({ payload: Buffer.from("new accepted outcome") });
  expect(existsSync(f.path)).toBe(false);
});
it("refuses a reappearing legacy source after retirement and preserves both copies", () => {
  const f = fixture();
  f.open().close();
  f.legacy({ pending: { id: "older-executable" } });
  expect(() => f.open()).toThrow("reappeared");
  expect(existsSync(f.path)).toBe(true);
  expect(existsSync(`${f.path}.protected`)).toBe(true);
});
it("rejects damaged authenticated pages instead of rebuilding an empty database", () => {
  const f = fixture();
  f.open().close();
  const path = `${f.path}.protected`;
  const bytes = readFileSync(path);
  bytes[100] ^= 1;
  writeFileSync(path, bytes);
  expect(() => f.open()).toThrow();
  expect(readFileSync(path)).toEqual(bytes);
});

it("recovers an import interrupted by process death without losing or duplicating pending work", async () => {
  const f = fixture();
  f.legacy({ first: { id: "pending-1" }, second: { id: "pending-2" } });
  const require = createRequire(
    join(process.cwd(), "apps/desktop/package.json"),
  );
  const bundle = join(f.directory, "database.cjs");
  await build({
    entryPoints: ["apps/desktop/src/utility/storage/database.ts"],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    plugins: [
      {
        name: "native-sqlite",
        setup(build) {
          build.onResolve(
            { filter: /^better-sqlite3-multiple-ciphers$/ },
            () => ({
              path: require.resolve("better-sqlite3-multiple-ciphers"),
              external: true,
            }),
          );
        },
      },
    ],
  });
  const childFile = join(f.directory, "interrupted.cjs");
  writeFileSync(
    childFile,
    `const {openProtectedDatabase}=require('./database.cjs');
let rows=0;
openProtectedDatabase(process.argv[2],Buffer.from(process.argv[3],'base64'),()=>{
 if (++rows===2) { process.send('copying');
   // Leave the import transaction open while the parent observes the checkpoint.
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
 }
});`,
  );
  const child = fork(childFile, [f.path, f.key.toString("base64")], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  try {
    const stage = await Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => {
        throw Error("Migration child exited before interruption");
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(Error("Migration checkpoint timed out")),
          5000,
        );
        timer.unref();
      }),
    ]);
    expect(stage[0]).toBe("copying");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
    }
  }
  expect(existsSync(f.path)).toBe(true);
  const db = f.open();
  expect(
    db
      .prepare<[], { key: string; payload: Buffer }>(
        "SELECT key,payload FROM cache ORDER BY key",
      )
      .all()
      .map(f.validate),
  ).toEqual([{ id: "pending-1" }, { id: "pending-2" }]);
  expect(existsSync(f.path)).toBe(false);
});

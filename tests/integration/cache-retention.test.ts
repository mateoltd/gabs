import { afterEach, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createRequire } from "node:module";
const desktopRequire = createRequire(
  join(process.cwd(), "apps/desktop/package.json"),
);

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
async function storage() {
  const directory = await mkdtemp(join(tmpdir(), "suite-cache-retention-"));
  const bundle = await build({
    entryPoints: ["apps/desktop/src/utility/cache-worker.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    plugins: [
      {
        name: "native-sqlite",
        setup(build) {
          build.onResolve(
            { filter: /^better-sqlite3-multiple-ciphers$/ },
            () => ({
              path: desktopRequire.resolve("better-sqlite3-multiple-ciphers"),
              external: true,
            }),
          );
        },
      },
    ],
  });
  const entry = join(directory, "cache.cjs");
  await writeFile(entry, bundle.outputFiles[0].text);
  const worker = new Worker(
    `const {parentPort}=require('node:worker_threads');
    process.parentPort={on:(_,callback)=>parentPort.on('message',data=>callback({data})),postMessage:value=>parentPort.postMessage(value)};
    import(${JSON.stringify(pathToFileURL(entry).href)}).then(()=>parentPort.postMessage({ready:true}));`,
    { eval: true },
  );
  cleanup.push(async () => {
    await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", () => resolve());
  });
  let sequence = 0;
  const request = (action: string, args: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++sequence;
      const handler = (message: {
        id: number;
        value?: unknown;
        error?: string;
      }) => {
        if (message.id !== id) return;
        worker.off("message", handler);
        if (message.error) reject(Error(message.error));
        else resolve(message.value);
      };
      worker.on("message", handler);
      worker.postMessage({ id, action, ...args });
    });
  await request("open", {
    session: randomUUID(),
    path: join(directory, "cache.sqlite"),
    secret: randomBytes(32).toString("base64"),
  });
  return {
    request,
    write: (key: string, value: unknown) =>
      request("write", { key: `account/company/${key}`, value }),
    read: (key: string) => request("read", { key: `account/company/${key}` }),
    purge: () => request("purge-workspace", { key: "account/company" }),
  };
}

it("the real encrypted SQLite worker refuses deletion of pending work without changing any records", async () => {
  const store = await storage();
  const cases = [
    ["drafts", [{ input: "retained draft" }]],
    ["pending", [{ key: "original-online-attempt" }]],
    [
      "module-state",
      {
        journal: [{ id: "original", state: "pending", delivery: "uncertain" }],
        drafts: {},
      },
    ],
    [
      "module-state",
      { journal: [{ id: "rejected", state: "rejected" }], drafts: {} },
    ],
    [
      "module-state",
      {
        journal: [],
        drafts: {},
        commandReviews: { original: { input: "review" } },
      },
    ],
    [
      "module-state",
      {
        journal: [
          { id: "original", state: "rejected", supersededBy: "missing" },
        ],
        drafts: {},
      },
    ],
    [
      "module-state",
      {
        journal: [],
        drafts: {},
        lifecycle: { installing: { requestId: "original-install" } },
      },
    ],
    [
      "module-state",
      {
        journal: [],
        drafts: {},
        recoveryImports: { original: { input: "retained imported work" } },
      },
    ],
    ["relay-inbox", [{ id: "unreviewed-envelope" }]],
  ] as const;
  for (const [key, value] of cases) {
    await store.request("purge", { key: "account/company" });
    await store.write("snapshot", { expiresAt: 123 });
    await store.write(key, value);
    await expect(store.purge()).rejects.toThrow(
      /before disabling offline storage/,
    );
    expect(await store.read(key)).toEqual(value);
    expect(await store.read("snapshot")).toEqual({ expiresAt: 123 });
    expect(await store.read("workspace-authority")).toBeUndefined();
  }
});

it("SQLite removes settled data atomically and keeps opt-out effective until explicit re-enabling", async () => {
  const store = await storage();
  await store.write("snapshot", { expiresAt: 123 });
  await store.write("module-state", {
    journal: [
      { id: "old", state: "rejected", supersededBy: "replacement" },
      { id: "replacement", state: "accepted" },
    ],
    drafts: {},
  });
  await store.request("write", {
    key: "account/other/snapshot",
    value: { untouched: true },
  });
  await store.purge();
  expect(await store.read("snapshot")).toBeUndefined();
  expect(await store.read("module-state")).toBeUndefined();
  const authority = (await store.read("workspace-authority")) as {
    generation: string;
    denied: boolean;
    storageDisabled: boolean;
  };
  expect(authority).toMatchObject({ denied: true, storageDisabled: true });
  expect(authority.generation).toBeTruthy();
  expect(
    await store.request("read", { key: "account/other/snapshot" }),
  ).toEqual({ untouched: true });
  await expect(store.write("snapshot", { late: true })).rejects.toThrow(
    "Offline storage was disabled",
  );
  await expect(
    store.write("module-state", {
      journal: [],
      drafts: { late: { input: "captured" } },
    }),
  ).rejects.toThrow("Offline storage was disabled");
  await store.write("module-state", {
    journal: [],
    drafts: {},
    pages: {},
    installed: {},
  });
  await store.write("workspace-authority", { ...authority, denied: false });
  await expect(store.write("snapshot", { late: true })).rejects.toThrow(
    "Offline storage was disabled",
  );
  await store.write("workspace-authority", {
    ...authority,
    denied: false,
    storageDisabled: false,
  });
  await store.write("snapshot", { fresh: true });
  expect(await store.read("snapshot")).toEqual({ fresh: true });
  await expect(
    store.request("unknown", { key: "account/company" }),
  ).rejects.toThrow();
  expect(await store.read("snapshot")).toEqual({ fresh: true });
});

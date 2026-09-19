import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
const require = createRequire(resolve("apps/desktop/package.json"));

test("real utility storage encrypts metadata and recovers acknowledged pending work after process termination", async () => {
  const profile = await mkdtemp(resolve(tmpdir(), "suite-encrypted-storage-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("apps/desktop/dist/main.cjs"), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUITE_DESKTOP_DEV_AUTH: "1",
      SUITE_DESKTOP_TEST_MINIMIZED: "1",
    },
  });
  const path = resolve(profile, "acceptance.sqlite");
  try {
    const result = await app.evaluate(
      async ({ utilityProcess, BrowserWindow }, args) => {
        const start = () => {
          const worker = utilityProcess.fork(args.entry, [], {
            serviceName: "Common storage acceptance",
            stdio: "pipe",
          });
          let sequence = 0;
          const request = (action: string, values: Record<string, unknown>) =>
            new Promise<unknown>((resolve, reject) => {
              const id = ++sequence;
              const timer = setTimeout(() => {
                finish();
                reject(Error("Storage acceptance timed out"));
              }, 10000);
              const exit = () => {
                finish();
                reject(Error("Storage exited"));
              };
              const message = (reply: {
                id: number;
                value?: unknown;
                error?: string;
              }) => {
                if (reply.id !== id) return;
                finish();
                if (reply.error) reject(Error(reply.error));
                else resolve(reply.value);
              };
              function finish() {
                clearTimeout(timer);
                worker.off("message", message);
                worker.off("exit", exit);
              }
              worker.on("message", message);
              worker.on("exit", exit);
              worker.postMessage({ id, action, ...values });
            });
          const kill = () =>
            new Promise<void>((resolve) => {
              worker.once("exit", () => resolve());
              process.kill(worker.pid!, "SIGKILL");
            });
          return { request, kill };
        };
        let store = start();
        try {
          await store.request("open", { path: args.path, secret: args.secret });
          await store.request("write", {
            key: "private-account/private-company/pending",
            value: [
              {
                id: "durable-attempt",
                state: "pending",
                input: "confidential operation",
              },
            ],
          });
          let retained = false;
          try {
            await store.request("purge-workspace", {
              key: "private-account/private-company",
            });
          } catch {
            retained = true;
          }
          if (!retained) throw Error("Pending work was deleted");
        } finally {
          await store.kill();
        }
        store = start();
        try {
          await store.request("open", { path: args.path, secret: args.secret });
          const recovered = await store.request("read", {
            key: "private-account/private-company/pending",
          });
          return {
            recovered,
            hidden: BrowserWindow.getAllWindows().every(
              (window) =>
                !window.isFocused() &&
                (!window.isVisible() || window.isMinimized()),
            ),
          };
        } finally {
          await store.kill();
        }
      },
      {
        entry:
          process.env.SUITE_ACCEPT_STORAGE_ENTRY ??
          resolve("apps/desktop/dist/cache-worker.cjs"),
        path,
        secret: randomBytes(32).toString("base64"),
      },
    );
    expect(result.recovered).toEqual([
      {
        id: "durable-attempt",
        state: "pending",
        input: "confidential operation",
      },
    ]);
    expect(result.hidden).toBe(true);
    const files = (await readdir(profile)).filter((name) =>
      name.startsWith("acceptance.sqlite"),
    );
    expect(files).toContain("acceptance.sqlite.protected");
    expect(files).toContain("acceptance.sqlite.protected-wal");
    for (const file of files) {
      const bytes = await readFile(resolve(profile, file));
      for (const text of [
        "private-account",
        "private-company",
        "durable-attempt",
        "confidential operation",
        "CREATE TABLE cache",
      ])
        expect(bytes.includes(Buffer.from(text))).toBe(false);
    }
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

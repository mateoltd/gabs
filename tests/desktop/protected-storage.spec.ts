import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { OpenedNativeVault } from "../../packages/client/src/identity/local-vault/protocol";
const require = createRequire(resolve("apps/desktop/package.json"));

test("real utility storage encrypts metadata and recovers acknowledged pending work after process termination and key rotation", async () => {
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
        let profileId = "";
        try {
          await store.request("open", {
            path: args.path,
            secret: args.secret,
            session: process.getBuiltinModule("node:crypto").randomUUID(),
          });
          const opened = (await store.request("vault", {
            requestId: "packaged-create",
            request: {
              action: "create",
              input: {
                name: "Private packaged profile",
                password: "packaged vault passphrase",
                data: { records: {} },
              },
            },
          })) as OpenedNativeVault;
          if ("key" in opened) throw Error("Vault key escaped utility custody");
          profileId = opened.profile.id;
          await store.request("vault", {
            requestId: "packaged-commit",
            request: {
              action: "commit",
              input: {
                handle: opened.handle,
                revision: opened.revision,
                value: { records: { note: "Private packaged work" } },
              },
            },
          });
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
          await store.request("open", {
            path: `${args.path}.rotated`,
            secret: args.replacement,
            rotation: { sourcePath: args.path, sourceSecret: args.secret },
            session: process.getBuiltinModule("node:crypto").randomUUID(),
          });
          const recovered = await store.request("read", {
            key: "private-account/private-company/pending",
          });
          const vault = (await store.request("vault", {
            requestId: "packaged-reopen",
            request: {
              action: "unlock",
              input: { id: profileId, password: "packaged vault passphrase" },
            },
          })) as OpenedNativeVault;
          if ("key" in vault) throw Error("Vault key escaped utility custody");
          return {
            recovered,
            vault: {
              profile: vault.profile,
              revision: vault.revision,
              data: vault.data,
            },
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
        replacement: randomBytes(32).toString("base64"),
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
    expect(result.vault).toMatchObject({
      profile: { name: "Private packaged profile" },
      revision: 1,
      data: { records: { note: "Private packaged work" } },
    });
    const files = (await readdir(profile)).filter((name) =>
      name.startsWith("acceptance.sqlite"),
    );
    expect(files).toContain("acceptance.sqlite.protected");
    expect(files).toContain("acceptance.sqlite.rotated.protected");
    expect(files).toContain("acceptance.sqlite.rotated.protected-wal");
    for (const file of files) {
      const bytes = await readFile(resolve(profile, file));
      for (const text of [
        "private-account",
        "private-company",
        "durable-attempt",
        "confidential operation",
        "CREATE TABLE cache",
        "local_vaults",
        result.vault.profile.id,
        "Private packaged profile",
        "Private packaged work",
      ])
        expect(bytes.includes(Buffer.from(text))).toBe(false);
    }
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

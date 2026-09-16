import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { publishLocalPackage } from "../local-package-fixture";
const require = createRequire(resolve("apps/desktop/package.json"));

test("minimized Electron executes a signed local package in its packaged worker and recovers after restart", async () => {
  test.setTimeout(60000);
  const published = await publishLocalPackage();
  const upgraded = await publishLocalPackage({
    id: published.pkg.module_id,
    version: "2.0.0",
    field: "body",
    localStorage: {
      version: 2,
      compatible: { minimum: 2, maximum: 2 },
      migrations: { rename: { from: 1, to: 2 } },
    },
  });
  const profile = await mkdtemp(resolve(tmpdir(), "suite-local-package-"));
  const worker = (await readdir("apps/desktop/dist/renderer/assets")).find(
    (name) => /^local-worker-entry-.*\.js$/.test(name),
  );
  expect(worker).toBeTruthy();
  // Use the production worker asset under the real native CSP and protocol.
  // The helper exposes profile APIs for this acceptance test, not production UI.
  const helper = await build({
    stdin: {
      contents: `export * from './packages/platform/src/local-profiles';export {hydrateModule,createModuleClient} from '@suite/module-sdk';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    plugins: [
      {
        name: "packaged-local-worker",
        setup(builder) {
          builder.onLoad({ filter: /\/local-worker\.ts$/ }, async (args) => ({
            contents: (await readFile(args.path, "utf8")).replace(
              '"./local-worker-entry.ts"',
              JSON.stringify(`suite://app/assets/${worker}`),
            ),
            loader: "ts",
          }));
        },
      },
    ],
  });
  const javascript = helper.outputFiles[0].text;
  const launch = () =>
    electron.launch({
      executablePath: require("electron"),
      args: [
        resolve("apps/desktop/dist/main.cjs"),
        `--user-data-dir=${profile}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
      },
    });
  let app = await launch();
  try {
    const run = async (saved?: {
      profileId: string;
      key: string;
      rowId: string;
    }) => {
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await page.context().setOffline(true);
      const workerStarted = page.waitForEvent("worker");
      const result = await page.evaluate(
        async ({ javascript, published, upgraded, saved }) => {
          const url = URL.createObjectURL(
            new Blob([javascript], { type: "text/javascript" }),
          );
          type SDK =
            typeof import("../../packages/platform/src/local-profiles") &
              typeof import("@suite/module-sdk");
          const sdk = (await import(url)) as SDK;
          URL.revokeObjectURL(url);
          const password = "correct horse battery staple";
          const session = saved
            ? await sdk.unlockLocalProfile(saved.profileId, password)
            : await sdk.createLocalProfile("Native signed notes", password);
          if (!saved) await session.install(published.pkg, published.publicKey);
          const module = sdk.hydrateModule(
            published.pkg
              .artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
          );
          const key = saved?.key ?? crypto.randomUUID();
          const rowId = (await sdk
            .createModuleClient(module, (call) => session.execute(module, call))
            .call(
              "capture",
              { text: "Native signed local execution" },
              key,
            )) as string;
          if (!saved) await session.install(upgraded.pkg, upgraded.publicKey);
          const rows = session.data.records[module.id + "/items"];
          const stored = session.data.modules![module.id];
          const profileId = session.id;
          session.lock();
          return { profileId, key, rowId, rows, stored };
        },
        { javascript, published, upgraded, saved },
      );
      expect((await workerStarted).url()).toBe(`suite://app/assets/${worker}`);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        id: result.rowId,
        data: { body: "Native signed local execution" },
      });
      expect(result.stored).toMatchObject({
        version: "2.0.0",
        schemaVersion: 2,
      });
      expect(result.stored.migrations).toHaveLength(1);
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (window) => window.isMinimized() && !window.isFocused(),
          ),
        ),
      ).toBe(true);
      return result;
    };
    const first = await run();
    await app.close();
    app = await launch();
    const restored = await run(first);
    expect(restored.rowId).toBe(first.rowId);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

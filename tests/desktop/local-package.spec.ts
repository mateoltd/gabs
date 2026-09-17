import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm, readdir, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { publishLocalPackage } from "../support/local-package-fixture";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

test("minimized Electron executes a signed local package in its packaged worker and recovers after restart", async () => {
  test.setTimeout(60000);
  const dependency = await publishLocalPackage({ name: "Native foundation" });
  const published = await publishLocalPackage({
    dependencies: { [dependency.pkg.module_id]: "^1" },
    dependencyPackages: [dependency.pkg],
  });
  const upgradedDependency = await publishLocalPackage({
    id: dependency.pkg.module_id,
    name: "Native foundation",
    version: "2.0.0",
    field: "body",
    localStorage: {
      version: 2,
      compatible: { minimum: 2, maximum: 2 },
      migrations: { rename: { from: 1, to: 2 } },
    },
  });
  const upgraded = await publishLocalPackage({
    id: published.pkg.module_id,
    version: "2.0.0",
    field: "body",
    migrationDelayMs: 3000,
    dependencies: { [dependency.pkg.module_id]: "^2" },
    dependencyPackages: [upgradedDependency.pkg],
    localStorage: {
      version: 2,
      compatible: { minimum: 2, maximum: 2 },
      migrations: { rename: { from: 1, to: 2 } },
    },
  });
  const profile = await mkdtemp(resolve(tmpdir(), "suite-local-package-"));
  const worker = (await readdir("apps/desktop/dist/renderer/assets")).find(
    (name) => /^worker-entry-.*\.js$/.test(name),
  );
  expect(worker).toBeTruthy();
  // Use the production worker asset under the real native CSP and protocol.
  // The helper exposes profile APIs for this acceptance test, not production UI.
  const helper = await build({
    stdin: {
      contents: `export * from './composition/src/local/product';export {hydrateModule,createModuleClient} from '@suite/module-sdk';`,
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
          builder.onLoad(
            { filter: /\/composition\/src\/local\/runtime\.ts$/ },
            async (args) => ({
              contents: (await readFile(args.path, "utf8")).replace(
                '"./worker-entry.ts"',
                JSON.stringify(`suite://app/assets/${worker}`),
              ),
              loader: "ts",
            }),
          );
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
    const initial = await app.firstWindow();
    await initial.waitForLoadState("domcontentloaded");
    const downloadedProfile = await initial.evaluate(
      async ({ javascript, published, dependency }) => {
        const url = URL.createObjectURL(
          new Blob([javascript], { type: "text/javascript" }),
        );
        const sdk = (await import(
          url
        )) as typeof import("../../composition/src/local/product") &
          typeof import("@suite/module-sdk");
        URL.revokeObjectURL(url);
        const session = await sdk.createLocalProfile(
          "Native signed notes",
          "correct horse battery staple",
        );
        const id = await session.beginDownload(
          published.pkg.module_id,
          { userId: "native-fixture", workspaceId: "native-personal" },
          [dependency, published].map((r) =>
            sdk.hydrateModule(
              r.pkg
                .artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
            ),
          ),
        );
        for (const release of [dependency, published])
          await session.saveDownload(id, release.pkg, release.publicKey);
        const profileId = session.id;
        session.lock();
        return profileId;
      },
      { javascript, published, dependency },
    );
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => w.isMinimized() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
    await app.close();
    app = await launch();
    const run = async (saved?: {
      profileId: string;
      key: string;
      rowId: string;
      installationId: string;
    }) => {
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await page.context().setOffline(true);
      const workerStarted = page.waitForEvent("worker");
      if (!saved) {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page
          .getByRole("button", {
            name: /^(Use a local profile|Open local profiles)$/,
          })
          .click();
        await selectValue(page, "Profile", downloadedProfile);
        await page
          .getByLabel("Passphrase", { exact: true })
          .fill("correct horse battery staple");
        await page
          .getByRole("button", { name: "Unlock profile", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Manage local modules", exact: true })
          .click();
        const downloads = page.getByRole("list", {
          name: "Saved local downloads",
          exact: true,
        });
        await expect(
          downloads.getByText("2 of 2 releases saved", { exact: true }),
        ).toBeVisible();
        await mkdir("docs/verification/local-downloads", { recursive: true });
        await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
        await page.screenshot({
          path: "docs/verification/local-downloads/desktop-ready.png",
        });
        await downloads
          .getByRole("button", { name: "Review installation", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Save local installation", exact: true })
          .click();
        await expect(
          page.getByText(
            "Local package notes is ready in this local profile.",
            { exact: true },
          ),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
      }
      if (saved) {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page
          .getByRole("button", {
            name: /^(Use a local profile|Open local profiles)$/,
          })
          .click();
        await selectValue(page, "Profile", saved.profileId);
        await page
          .getByLabel("Passphrase", { exact: true })
          .fill("correct horse battery staple");
        await page
          .getByRole("button", { name: "Unlock profile", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Manage local modules", exact: true })
          .click();
        const recovery = page.getByRole("list", {
          name: "Unfinished local installations",
          exact: true,
        });
        await expect(
          recovery.getByText("Awaiting recovery", { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
        await mkdir("docs/verification/local-dependencies", {
          recursive: true,
        });
        await page.screenshot({
          path: "docs/verification/local-dependencies/desktop-pending.png",
        });
        await recovery
          .getByRole("button", { name: "Resume installation", exact: true })
          .click();
        await expect(
          page.getByText(
            "Local package notes is ready in this local profile.",
            { exact: true },
          ),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        await selectValue(
          page,
          "Module and resource",
          published.pkg.module_id + "/items",
        );
        await expect(
          page.getByRole("cell", {
            name: "Native signed local execution",
            exact: true,
          }),
        ).toHaveCount(1);
        await expect(
          page.getByRole("columnheader", { name: "Body", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: "docs/verification/local-dependencies/desktop-recovered.png",
        });
        await page
          .getByRole("button", { name: "Manage local modules", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Installation history", exact: true })
          .click();
        const history = page.getByRole("list", {
          name: "Local installation history",
          exact: true,
        });
        await expect(
          history.getByRole("heading", {
            name: "Saved installation",
            exact: true,
          }),
        ).toHaveCount(2);
        await mkdir("docs/verification/local-versions", { recursive: true });
        await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
        await page.screenshot({
          path: "docs/verification/local-versions/desktop-history.png",
        });
        await page
          .getByRole("button", { name: "Back to modules", exact: true })
          .click();
        await page
          .getByRole("table", { name: "Local modules", exact: true })
          .getByRole("row")
          .filter({ hasText: "Local package notes" })
          .getByRole("button", { name: "Retained versions", exact: true })
          .click();
        await expect(
          page.getByRole("button", {
            name: "Review version 1.0.0",
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", {
            name: "Review version 2.0.0",
            exact: true,
          }),
        ).toBeEnabled();
        await page.screenshot({
          path: "docs/verification/local-versions/desktop-versions.png",
        });
        await page
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
      }
      const result = await page.evaluate(
        async ({
          javascript,
          published,
          upgraded,
          dependency,
          upgradedDependency,
          saved,
          downloadedProfile,
        }) => {
          const url = URL.createObjectURL(
            new Blob([javascript], { type: "text/javascript" }),
          );
          type SDK = typeof import("../../composition/src/local/product") &
            typeof import("@suite/module-sdk");
          const sdk = (await import(url)) as SDK;
          URL.revokeObjectURL(url);
          const password = "correct horse battery staple";
          const session = await sdk.unlockLocalProfile(
            saved?.profileId ?? downloadedProfile,
            password,
          );
          const module = sdk.hydrateModule(
            published.pkg
              .artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
          );
          if (saved) {
            await session.retryInstallation(saved.installationId);
            // An accepted attempt is a durable receipt, including after restart.
            await session.retryInstallation(saved.installationId);
          }
          const key = saved?.key ?? crypto.randomUUID();
          const rowId = (await sdk
            .createModuleClient(module, (call) => session.execute(module, call))
            .call(
              "capture",
              { text: "Native signed local execution" },
              key,
            )) as string;
          if (!saved) {
            void session
              .installSet(
                upgraded.pkg.module_id,
                [upgraded, upgradedDependency].map((r) => ({
                  package: r.pkg,
                  publicKey: r.publicKey,
                  configuration: {},
                })),
              )
              .catch(() => {});
            while (
              !Object.values(session.data.installationAttempts ?? {}).some(
                (attempt) => attempt.state === "pending",
              )
            )
              await new Promise((resolve) => setTimeout(resolve, 10));
          }
          const installationId =
            saved?.installationId ??
            Object.entries(session.data.installationAttempts!).find(
              ([, attempt]) => attempt.state === "pending",
            )![0];
          const attempt = session.data.installationAttempts![installationId];
          const rows = session.data.records[module.id + "/items"];
          const stored = session.data.modules![module.id];
          const related = session.data.modules![dependency.pkg.module_id];
          const profileId = session.id;
          const history = session.data.lifecycle ?? [];
          if (saved) session.lock();
          return {
            profileId,
            key,
            rowId,
            rows,
            stored,
            related,
            history,
            installationId,
            state: attempt.state,
          };
        },
        {
          javascript,
          published,
          upgraded,
          dependency,
          upgradedDependency,
          saved,
          downloadedProfile,
        },
      );
      expect((await workerStarted).url()).toBe(`suite://app/assets/${worker}`);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        id: result.rowId,
        data: saved
          ? { body: "Native signed local execution" }
          : { text: "Native signed local execution" },
      });
      expect(result.stored).toMatchObject({
        version: saved ? "2.0.0" : "1.0.0",
        schemaVersion: saved ? 2 : 1,
      });
      expect(result.stored.migrations).toHaveLength(saved ? 1 : 0);
      expect(result.state).toBe(saved ? "accepted" : "pending");
      expect(result.related).toMatchObject({
        version: saved ? "2.0.0" : "1.0.0",
        schemaVersion: saved ? 2 : 1,
      });
      expect(result.related.migrations).toHaveLength(saved ? 1 : 0);
      expect(result.history).toHaveLength(saved ? 2 : 1);
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

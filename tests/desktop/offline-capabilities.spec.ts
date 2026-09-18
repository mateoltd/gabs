import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  access,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { publishExecutableFixture } from "../support/executable-fixture";
import {
  assignHostFixture,
  exportPermission,
} from "../support/host-capability-journey";
const require = createRequire(resolve("apps/desktop/package.json"));
async function hidden(app: ElectronApplication) {
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(
        (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
      ),
    ),
  ).toBe(true);
}

test("hidden native corporate leases survive process restart and recheck policy after an offline file dialog", async () => {
  test.setTimeout(150000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-native-offline-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const id = `native-offline-${randomUUID().slice(0, 8)}`,
    workspaceId = randomUUID();
  let app: ElectronApplication | undefined;
  const launch = async (entry = resolve("apps/desktop/dist/main.cjs")) => {
    const native = await electron.launch({
      executablePath: require("electron"),
      args: [entry, `--user-data-dir=${profile}`],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
      },
    });
    await hidden(native);
    return native;
  };
  try {
    const published = await publishExecutableFixture({
      id,
      name: "Offline native notes",
      sourceDirectory: "tests/fixtures/host-capabilities",
      transform: (filename, source) =>
        filename === "module.ts"
          ? source.replace(
              'kind: "files.export",',
              'kind: "files.export", offline: "lease",',
            )
          : source,
    });
    app = await launch();
    let page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await page.evaluate(() =>
      window.suiteDesktop!.execute({ operation: "me" }),
    );
    const userId = (me.body as { user: { id: string } }).user.id;
    const created = await page.evaluate(
      (id) =>
        window.suiteDesktop!.execute({
          operation: "workspaceCreate",
          body: { id, name: "Native offline acceptance", currency: "EUR" },
          idempotencyKey: crypto.randomUUID(),
        }),
      workspaceId,
    );
    expect(created.status).toBe(200);
    expect(
      (
        await page.evaluate(() =>
          window.suiteDesktop!.execute({ operation: "capabilityLeaseKey" }),
        )
      ).status,
      "Managed test API must have its disposable lease signer",
    ).toBe(200);
    await assignHostFixture(pool, workspaceId, id);
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspaceId}"]`))
      .click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Offline native notes", exact: true })
      .click();
    await expect(
      page.getByText(/^Offline access for file exports until/),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.evaluate(
        ({ userId, workspaceId }) =>
          window.suiteDesktop!.cacheWrite(
            { userId, workspaceId },
            "native-authority" as never,
            { permissions: ["*"] },
          ),
        { userId, workspaceId },
      ),
    ).rejects.toThrow(/Invalid cache key/);
    const missing = await page.evaluate(
      ({ workspaceId, id, version }) =>
        window.suiteDesktop!.execute({
          operation: "moduleQuery",
          params: { workspaceId, moduleId: id, operationName: "missing" },
          moduleVersion: version,
          body: {},
        }),
      { workspaceId, id, version: published.version as string },
    );
    expect(missing.status).toBe(404);
    await app.close();
    app = undefined;

    // Block main-process transport before startup, without modifying the production application or the user's network.
    const entry = resolve(profile, "offline-entry.cjs");
    await writeFile(
      entry,
      `globalThis.nativeOriginalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); }; require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});`,
    );
    app = await launch(entry);
    page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("link", { name: "Offline native notes", exact: true })
      .click();
    const area = page.getByRole("region", {
      name: "Module host actions",
      exact: true,
    });
    await expect(area).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByText(/^Offline access for file exports until/),
    ).toBeVisible();
    const accepted = resolve(profile, "accepted.txt"),
      denied = resolve(profile, "denied.txt");
    await app.evaluate(({ dialog }, path) => {
      const state = {
        path,
        hold: false,
        waiting: false,
        release: undefined as undefined | (() => void),
      };
      (globalThis as unknown as { nativeExport: typeof state }).nativeExport =
        state;
      dialog.showSaveDialog = async () => {
        state.waiting = true;
        if (state.hold)
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        state.waiting = false;
        return { canceled: false, filePath: state.path };
      };
    }, accepted);
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("Export saved");
    expect(await readFile(accepted, "utf8")).toBe(
      "Exported through the typed module host\n",
    );
    await area
      .getByRole("button", { name: "Show notification", exact: true })
      .click();
    await expect(area.getByRole("alert")).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode()
          .include("#main-content")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/native-capability-leases", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/verification/native-capability-leases/offline-native.png",
    });

    const expired = resolve(profile, "expired.txt");
    await app.evaluate((_, path) => {
      const state = (
        globalThis as unknown as {
          nativeExport: { path: string; hold: boolean };
        }
      ).nativeExport;
      state.path = path;
      state.hold = true;
    }, expired);
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect
      .poll(() =>
        app!.evaluate(
          () =>
            (globalThis as unknown as { nativeExport: { waiting: boolean } })
              .nativeExport.waiting,
        ),
      )
      .toBe(true);
    await app.evaluate(() => {
      const originalNow = Date.now;
      (
        globalThis as unknown as { nativeOriginalNow: typeof Date.now }
      ).nativeOriginalNow = originalNow;
      Date.now = () => originalNow() + 25 * 3600000;
      (
        globalThis as unknown as { nativeExport: { release: () => void } }
      ).nativeExport.release();
    });
    await expect(area.getByRole("alert")).toContainText(/expired/i);
    await expect(access(expired)).rejects.toThrow();
    await app.evaluate(() => {
      Date.now = (
        globalThis as unknown as { nativeOriginalNow: typeof Date.now }
      ).nativeOriginalNow;
    });

    // Reauthenticate before opening the next dialog so the policy proof cannot pass merely by closing an old session.
    await app.evaluate(() => {
      globalThis.fetch = (
        globalThis as unknown as { nativeOriginalFetch: typeof fetch }
      ).nativeOriginalFetch;
    });
    await page.evaluate(() => window.suiteDesktop!.login({}));
    await page.reload();
    await expect(area).toBeVisible();
    await expect(
      page.getByText(/^Offline access for file exports until/),
    ).toBeVisible();
    await app.evaluate(() => {
      globalThis.fetch = async () => {
        throw new TypeError("fetch failed", {
          cause: { code: "ECONNREFUSED" },
        });
      };
    });

    await app.evaluate((_, path) => {
      const state = (
        globalThis as unknown as {
          nativeExport: { path: string; hold: boolean };
        }
      ).nativeExport;
      state.path = path;
      state.hold = true;
    }, denied);
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect
      .poll(() =>
        app!.evaluate(
          () =>
            (globalThis as unknown as { nativeExport: { waiting: boolean } })
              .nativeExport.waiting,
        ),
      )
      .toBe(true);
    await exportPermission(pool, workspaceId, id, false);
    // A fresh authenticated policy response reaches main while the native dialog is still pending.
    await app.evaluate(() => {
      globalThis.fetch = (
        globalThis as unknown as { nativeOriginalFetch: typeof fetch }
      ).nativeOriginalFetch;
    });
    const policy = await page.evaluate(
      (workspaceId) =>
        window.suiteDesktop!.execute({
          operation: "bootstrap",
          params: { workspaceId },
        }),
      workspaceId,
    );
    expect(policy.status).toBe(200);
    await app.evaluate(() => {
      globalThis.fetch = async () => {
        throw new TypeError("fetch failed", {
          cause: { code: "ECONNREFUSED" },
        });
      };
      (
        globalThis as unknown as { nativeExport: { release: () => void } }
      ).nativeExport.release();
    });
    await expect(area.getByRole("alert")).toContainText(
      /authority|permissions/i,
    );
    await expect(access(denied)).rejects.toThrow();
    await hidden(app);
  } finally {
    await app?.close();
    await pool.end();
    await rm(profile, { recursive: true, force: true });
  }
});

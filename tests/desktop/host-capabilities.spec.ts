import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  publishHostFixture,
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
test("hidden native module exports recheck revocation and close stale view sessions before writing", async () => {
  test.setTimeout(120000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-host-capabilities-")),
    pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL }),
    id = `native-host-${randomUUID().slice(0, 8)}`,
    workspace = randomUUID();
  let app: ElectronApplication | undefined;
  try {
    await publishHostFixture(id);
    app = await electron.launch({
      executablePath: require("electron"),
      args: [
        resolve("apps/desktop/dist/main.cjs"),
        `--user-data-dir=${profile}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
      },
    });
    const page = await app.firstWindow();
    await hidden(app);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    expect(
      (
        await page.evaluate(
          (workspace) =>
            window.suiteDesktop!.execute({
              operation: "workspaceCreate",
              body: {
                id: workspace,
                name: "Native host capabilities",
                currency: "EUR",
              },
              idempotencyKey: crypto.randomUUID(),
            }),
          workspace,
        )
      ).status,
    ).toBe(200);
    await assignHostFixture(pool, workspace, id);
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspace}"]`))
      .click();
    await page
      .getByRole("link", { name: "Capability notes", exact: true })
      .click();
    const area = page.getByRole("region", {
      name: "Module host actions",
      exact: true,
    });
    await area
      .getByRole("button", { name: "Inspect local network", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("Local network disabled");
    await app.evaluate(({ Notification }) => {
      const notices: { title: string; body: string }[] = [];
      (globalThis as unknown as { hostNotices: typeof notices }).hostNotices =
        notices;
      Notification.isSupported = () => true;
      Notification.prototype.show = function () {
        notices.push({ title: this.title, body: this.body });
      };
    });
    await area
      .getByRole("button", { name: "Show notification", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("Notification requested");
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { hostNotices: unknown[] }).hostNotices,
      ),
    ).toEqual([{ title: "Module notice", body: "Authorized host action" }]);
    const target = resolve(profile, "accepted.txt"),
      denied = resolve(profile, "denied.txt"),
      abandoned = resolve(profile, "abandoned.txt");
    await app.evaluate(({ dialog }, target) => {
      const state = {
        path: target,
        hold: false,
        waiting: false,
        release: undefined as undefined | (() => void),
      };
      (globalThis as unknown as { hostExport: typeof state }).hostExport =
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
    }, target);
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("Export saved");
    expect(await readFile(target, "utf8")).toBe(
      "Exported through the typed module host\n",
    );
    await app.evaluate((_, path) => {
      const state = (
        globalThis as unknown as { hostExport: { path: string; hold: boolean } }
      ).hostExport;
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
            (globalThis as unknown as { hostExport: { waiting: boolean } })
              .hostExport.waiting,
        ),
      )
      .toBe(true);
    await exportPermission(pool, workspace, id, false);
    await app.evaluate(() =>
      (
        globalThis as unknown as { hostExport: { release: () => void } }
      ).hostExport.release(),
    );
    await expect(area.getByRole("alert")).toContainText("current permissions");
    await expect(access(denied)).rejects.toThrow();
    await mkdir("docs/verification/host-capabilities", { recursive: true });
    await page.screenshot({
      path: "docs/verification/host-capabilities/revoked-native.png",
    });
    await exportPermission(pool, workspace, id, true);
    await app.evaluate((_, path) => {
      (
        globalThis as unknown as { hostExport: { path: string } }
      ).hostExport.path = path;
    }, abandoned);
    await page.evaluate(() => {
      delete document.documentElement.dataset.hostFixtureComplete;
      document.addEventListener(
        "host-fixture-complete",
        () => {
          document.documentElement.dataset.hostFixtureComplete = "true";
        },
        { once: true },
      );
    });
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect
      .poll(() =>
        app!.evaluate(
          () =>
            (globalThis as unknown as { hostExport: { waiting: boolean } })
              .hostExport.waiting,
        ),
      )
      .toBe(true);
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(area).toHaveCount(0);
    await app.evaluate(() =>
      (
        globalThis as unknown as { hostExport: { release: () => void } }
      ).hostExport.release(),
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.hostFixtureComplete === "true",
    );
    await expect(access(abandoned)).rejects.toThrow();
    await hidden(app);
  } finally {
    await app?.close();
    await pool.end();
    await rm(profile, { recursive: true, force: true });
  }
});

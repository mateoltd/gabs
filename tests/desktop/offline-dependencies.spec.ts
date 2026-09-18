import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { selectValue } from "../e2e/controls.helpers";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
async function journal(
  page: Page,
  scope: { userId: string; workspaceId: string },
) {
  return page.evaluate(
    async (scope) =>
      (
        (await window.suiteDesktop!.cacheRead(
          scope,
          "module-state",
        )) as ModuleStorage
      ).journal,
    scope,
  );
}
test("native dependent drafts survive an offline process restart without duplicate effects", async () => {
  test.setTimeout(120000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const profile = await mkdtemp(
    resolve(tmpdir(), "suite-offline-dependencies-"),
  );
  const require = createRequire(resolve("apps/desktop/package.json"));
  const offlineEntry = resolve(profile, "offline-entry.cjs");
  await writeFile(
    offlineEntry,
    `globalThis.savedFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new TypeError("fetch failed",{cause:{code:"ECONNREFUSED"}})};require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});`,
  );
  let app!: ElectronApplication;
  let page!: Page;
  const launch = async (offline = false) => {
    app = await electron.launch({
      executablePath: require("electron"),
      args: [
        offline ? offlineEntry : resolve("apps/desktop/dist/main.cjs"),
        `--user-data-dir=${profile}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
      },
    });
    page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 960),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
  };
  const context = {
    setOffline: async (offline: boolean) => {
      await app.evaluate((_, offline) => {
        const state = globalThis as typeof globalThis & {
          savedFetch?: typeof fetch;
          onlineFetch?: typeof fetch;
        };
        state.savedFetch ??= globalThis.fetch;
        globalThis.fetch = offline
          ? async () => {
              throw new TypeError("fetch failed", {
                cause: { code: "ECONNREFUSED" },
              });
            }
          : (state.onlineFetch ?? state.savedFetch);
      }, offline);
      await page.evaluate((offline) => {
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          get: () => !offline,
        });
        window.dispatchEvent(new Event(offline ? "offline" : "online"));
      }, offline);
    },
  };
  try {
    await launch();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await page.evaluate(
      async () =>
        (await window.suiteDesktop!.execute({ operation: "me" })).body as {
          user: { id: string };
        },
    );
    const scope = { userId: me.user.id, workspaceId: randomUUID() };
    const created = await page.evaluate(
      async (id) =>
        window.suiteDesktop!.execute({
          operation: "workspaceCreate",
          body: {
            id,
            name: "Native offline dependency acceptance",
            currency: "EUR",
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      scope.workspaceId,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    await page.reload();
    await selectValue(page, "Workspace", scope.workspaceId);
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
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "New projects", exact: true }),
    ).toBeVisible();
    await context.setOffline(true);
    const save = async () => {
      await page
        .getByRole("button", { name: "Save pending change", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await page
      .getByRole("button", { name: "New projects", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Captured project");
    await selectValue(page, "Status", "planned");
    await save();
    await page.getByRole("tab", { name: "Tasks", exact: true }).click();
    await page.getByRole("button", { name: "New tasks", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Captured task");
    await selectValue(page, "Status", "todo");
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "Project Id", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Captured project (pending)", exact: true })
      .click();
    await mkdir("docs/verification/offline-dependencies", { recursive: true });
    await page.screenshot({
      path: "docs/verification/offline-dependencies/native-picker.png",
    });
    await save();
    await page.getByRole("tab", { name: "Comments", exact: true }).click();
    await page
      .getByRole("button", { name: "New comments", exact: true })
      .click();
    await page.getByLabel("Text", { exact: true }).fill("Captured comment");
    await dialog
      .getByRole("combobox", { name: "Task Id", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Captured task (pending)", exact: true })
      .click();
    await save();
    const captured = await journal(page, scope);
    expect(captured).toHaveLength(3);
    expect(captured[1].dependencies).toEqual([captured[0].id]);
    expect(captured[2].dependencies).toEqual([captured[1].id]);
    await page.getByRole("tab", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", { name: "New projects", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Independent project");
    await selectValue(page, "Status", "planned");
    await save();
    await app.close();
    await launch(true);
    await context.setOffline(true);
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Pending changes", exact: true }),
    ).toBeVisible();
    expect((await journal(page, scope)).map((e) => e.id)).toEqual([
      ...captured.map((e) => e.id),
      expect.any(String),
    ]);
    await page.getByRole("tab", { name: "Comments", exact: true }).click();
    await expect(
      page.getByText(
        "Waiting for prerequisite changes to be accepted. Unrelated work can still synchronize.",
      ),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(390, 844),
    );
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode()
          .include("#main-content")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("heading", { name: "Pending changes", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/offline-dependencies/native-pending.png",
    });
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,'projects.comments.write') where workspace_id=$1",
      [scope.workspaceId],
    );
    await app.evaluate((_, parent) => {
      const state = globalThis as typeof globalThis & {
        savedFetch: typeof fetch;
        onlineFetch: typeof fetch;
        dispatched: string[];
      };
      state.dispatched = [];
      let lose = true;
      state.onlineFetch = async (...args) => {
        const body =
          typeof args[1]?.body === "string"
            ? JSON.parse(args[1].body)
            : undefined;
        const create =
          String(args[0]).includes("/records") && body?.action === "create";
        const key = new Headers(args[1]?.headers).get("idempotency-key")!;
        if (create) state.dispatched.push(key);
        const response = await state.savedFetch(...args);
        if (create && key === parent && lose && response.ok) {
          lose = false;
          throw new TypeError("fetch failed", {
            cause: { code: "ECONNRESET" },
          });
        }
        return response;
      };
    }, captured[0].id);
    await context.setOffline(false);
    await page.evaluate(() => window.suiteDesktop!.login());
    await page.reload();
    await expect
      .poll(async () => (await journal(page, scope)).map((e) => e.state), {
        timeout: 45000,
      })
      .toEqual(["accepted", "accepted", "rejected", "accepted"]);
    const dispatched = await app.evaluate(
      () => (globalThis as unknown as { dispatched: string[] }).dispatched,
    );
    expect(dispatched.filter((key) => key === captured[0].id)).toHaveLength(2);
    expect(dispatched.indexOf(captured[1].id)).toBeGreaterThan(
      dispatched.lastIndexOf(captured[0].id),
    );
    expect(dispatched.indexOf(captured[2].id)).toBeGreaterThan(
      dispatched.indexOf(captured[1].id),
    );
    const records = await pool.query(
      "select resource,data from suite.module_records where workspace_id=$1 and module_id='projects'",
      [scope.workspaceId],
    );
    expect(records.rows).toHaveLength(3);
    expect(records.rows.filter((r) => r.resource === "projects")).toHaveLength(
      2,
    );
    expect(
      records.rows.find((r) => r.resource === "tasks")?.data.projectId,
    ).toBe((captured[0].call.input as { id: string }).id);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from suite.audit where workspace_id=$1 and action like 'projects.%.create'",
          [scope.workspaceId],
        )
      ).rows[0].n,
    ).toBe(3);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    await pool.end();
    await rm(profile, { recursive: true, force: true });
  }
});

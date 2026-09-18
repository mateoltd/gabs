import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
async function journal(
  page: Page,
  scope: { userId: string; workspaceId: string },
) {
  return page.evaluate(async (scope) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("suite-offline-v1");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise<ModuleStorage["journal"]>((resolve, reject) => {
        const tx = db.transaction("records", "readonly");
        const get = tx
          .objectStore("records")
          .get(`${scope.userId}/${scope.workspaceId}/module-state`);
        get.onsuccess = () => resolve(get.result.journal);
        get.onerror = () => reject(get.error);
      });
    } finally {
      db.close();
    }
  }, scope);
}
test("offline project, task and comment dependencies survive reload, lost replies and rejected writes", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/");
    await selectValue(page, "Local demonstration account", "owner@demo.local");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
    const created = await page.request.post("/api/v1/workspaces", {
      headers: {
        origin: new URL(page.url()).origin,
        "x-csrf-token": me.csrfToken,
        "idempotency-key": randomUUID(),
      },
      data: {
        id: scope.workspaceId,
        name: "Offline dependency acceptance",
        currency: "EUR",
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
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
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
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
      path: "docs/verification/offline-dependencies/picker.png",
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
    await page.reload();
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
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      (
        await new AxeBuilder({ page })
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
      path: "docs/verification/offline-dependencies/pending.png",
    });
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,'projects.comments.write') where workspace_id=$1",
      [scope.workspaceId],
    );
    const dispatched: string[] = [];
    let lose = true;
    await page.route(
      `**/api/v1/module/projects/workspaces/${scope.workspaceId}/records`,
      async (route) => {
        if (route.request().postDataJSON().action !== "create")
          return route.continue();
        const key = route.request().headers()["idempotency-key"];
        dispatched.push(key);
        const response = await route.fetch();
        if (key === captured[0].id && lose && response.ok()) {
          lose = false;
          return route.abort("connectionreset");
        }
        return route.fulfill({ response });
      },
    );
    await context.setOffline(false);
    await expect
      .poll(async () => (await journal(page, scope)).map((e) => e.state), {
        timeout: 45000,
      })
      .toEqual(["accepted", "accepted", "rejected", "accepted"]);
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
  } finally {
    await context.setOffline(false);
    await pool.end();
  }
});

import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  publishQueryFixture,
  assignQueryFixture,
  queryId,
  queryName,
  queryData,
  exerciseQuery,
} from "../resource-query-journey";
const require = createRequire(resolve("apps/desktop/package.json"));

test("hidden desktop composes signed resource query views without taking focus", async () => {
  test.setTimeout(120000);
  await publishQueryFixture();
  const profile = await mkdtemp(resolve(tmpdir(), "common-schema-review-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
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
  try {
    expect(
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return (
          !window.isFocused() && (!window.isVisible() || window.isMinimized())
        );
      }),
    ).toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 960),
    );
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const workspaceId = randomUUID();
    const created = await page.evaluate(
      (workspaceId) =>
        window.suiteDesktop!.execute({
          operation: "workspaceCreate",
          body: {
            id: workspaceId,
            name: "Native schema acceptance",
            currency: "EUR",
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      workspaceId,
    );
    expect(created.status).toBe(200);
    await assignQueryFixture(pool, workspaceId);
    for (const input of [
      ...queryData,
      {
        id: "00000000-0000-4000-8000-000000000008",
        data: { name: "Other record", amount: 100, approved: true },
      },
    ]) {
      const saved = await page.evaluate(
        ({ workspaceId, moduleId, input }) =>
          window.suiteDesktop!.execute({
            operation: "moduleRequest",
            params: { workspaceId, moduleId },
            body: {
              resource:
                input.data.name === "Other record" ? "other" : "records",
              action: "create",
              input,
            },
            idempotencyKey: crypto.randomUUID(),
          }),
        { workspaceId, moduleId: queryId, input },
      );
      expect(saved.status, JSON.stringify(saved)).toBe(200);
    }
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspaceId}"]`))
      .click();
    await page.getByRole("link", { name: queryName, exact: true }).click();
    await exerciseQuery(page);
    expect(
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return (
          !window.isFocused() && (!window.isVisible() || window.isMinimized())
        );
      }),
    ).toBe(true);
    await mkdir("docs/verification/resource-query", { recursive: true });
    await page
      .getByRole("heading", { name: queryName, exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/resource-query/electron.png",
    });
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { require?: unknown }).require,
      ),
    ).toBe("undefined");
  } finally {
    await app.close();
    await pool.end();
    await rm(profile, { recursive: true, force: true });
  }
});

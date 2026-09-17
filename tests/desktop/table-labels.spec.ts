import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  publishTableLabels,
  assignTableLabels,
  tableLabelsId,
  tableTargets,
  inspectTableLabels,
  tableLabelsName,
  tableData,
} from "../support/table-labels-journey";
const require = createRequire(resolve("apps/desktop/package.json"));
test("hidden Electron resolves structured reference tables without taking focus", async () => {
  test.setTimeout(120000);
  await publishTableLabels();
  const directory = await mkdtemp(resolve(tmpdir(), "suite-table-labels-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [
      resolve("apps/desktop/dist/main.cjs"),
      `--user-data-dir=${directory}`,
    ],
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
    const workspace = crypto.randomUUID();
    const created = await page.evaluate(
      (workspace) =>
        window.suiteDesktop!.execute({
          operation: "workspaceCreate",
          body: {
            id: workspace,
            name: "Native reference tables",
            currency: "EUR",
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      workspace,
    );
    expect(created.status).toBe(200);
    await assignTableLabels(pool, workspace);
    for (const input of tableTargets) {
      const saved = await page.evaluate(
        ({ workspace, moduleId, input }) =>
          window.suiteDesktop!.execute({
            operation: "moduleRequest",
            params: { workspaceId: workspace, moduleId },
            body: { resource: "targets", action: "create", input },
            idempotencyKey: crypto.randomUUID(),
          }),
        { workspace, moduleId: tableLabelsId, input },
      );
      expect(saved.status).toBe(200);
    }
    const record = await page.evaluate(
      ({ workspace, moduleId, input }) =>
        window.suiteDesktop!.execute({
          operation: "moduleRequest",
          params: { workspaceId: workspace, moduleId },
          body: { resource: "records", action: "create", input },
          idempotencyKey: crypto.randomUUID(),
        }),
      { workspace, moduleId: tableLabelsId, input: { data: tableData } },
    );
    expect(record.status).toBe(200);
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspace}"]`))
      .click();
    await page
      .getByRole("link", { name: tableLabelsName, exact: true })
      .click();
    await inspectTableLabels(page);
    expect(
      (
        await pool.query(
          "select data from suite.module_records where workspace_id=$1 and module_id=$2 and resource='records'",
          [workspace, tableLabelsId],
        )
      ).rows.map((row) => row.data),
    ).toEqual([tableData]);
    await mkdir("docs/verification/table-labels", { recursive: true });
    await page
      .getByRole("heading", { name: "Reference records", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/table-labels/electron.png",
    });
    expect(
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return (
          !window.isFocused() && (!window.isVisible() || window.isMinimized())
        );
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { require?: unknown }).require,
      ),
    ).toBe("undefined");
  } finally {
    await app.close();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});

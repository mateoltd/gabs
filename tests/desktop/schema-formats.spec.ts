import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  publishFormats,
  assignFormats,
  exerciseFormats,
  exerciseLocalFormats,
  formatId,
  formatName,
  valid,
} from "../support/schema-formats-journey";
const require = createRequire(resolve("apps/desktop/package.json"));
test("hidden Electron validates signed formats and standalone encrypted records", async () => {
  test.setTimeout(150000);
  await publishFormats();
  const directory = await mkdtemp(resolve(tmpdir(), "suite-formats-"));
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
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
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
            name: "Native formatted records",
            currency: "EUR",
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      workspace,
    );
    expect(created.status).toBe(200);
    await assignFormats(pool, workspace);
    const me = await page.evaluate(
      async () =>
        (await window.suiteDesktop!.execute({ operation: "me" })).body as {
          workspaces: { id: string; kind: string }[];
        },
    );
    const personal = me.workspaces.find((w) => w.kind === "personal")!;
    await assignFormats(pool, personal.id);
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspace}"]`))
      .click();
    await page.getByRole("link", { name: formatName, exact: true }).click();
    await exerciseFormats(page);
    expect(
      (
        await pool.query(
          "select data from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspace, formatId],
        )
      ).rows.map((row) => row.data),
    ).toEqual([valid]);
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode()
          .include('[aria-label="Formatted intake"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/schema-formats", { recursive: true });
    await page
      .getByRole("heading", { name: "Formatted intake", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/schema-formats/native.png",
    });
    await exerciseLocalFormats(page, async () => {
      await page.context().setOffline(true);
      await page.evaluate(() => dispatchEvent(new Event("offline")));
    });
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspace, formatId],
        )
      ).rows[0].count,
    ).toBe("1");
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    await app.close();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});

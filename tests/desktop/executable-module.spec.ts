import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { publishExecutableFixture } from "../executable-fixture";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import module from "../fixtures/custom-notes/module";
const require = createRequire(resolve("apps/desktop/package.json"));

test("native Electron installs and executes a separately signed module through the bounded bridge", async () => {
  test.setTimeout(120000);
  await publishExecutableFixture();
  const profile = await mkdtemp(resolve(tmpdir(), "common-executable-review-"));
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
    },
  });
  try {
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
            name: "Native executable acceptance",
            currency: "EUR",
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      workspaceId,
    );
    expect(created.status).toBe(200);
    await pool.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true) on conflict(workspace_id,module_id) do update set active=true",
      [workspaceId, module.id],
    );
    await pool.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}') on conflict(workspace_id,module_id) do update set state='enabled'",
      [workspaceId, module.id],
    );
    await pool.query(
      "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1 on conflict do nothing",
      [workspaceId, module.id],
    );
    await pool.query(
      "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
      [workspaceId, module.permissions],
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspaceId}"]`))
      .click();
    await page.getByRole("link", { name: "Custom notes", exact: true }).click();
    const region = page.getByRole("region", {
      name: "Custom notes workspace",
      exact: true,
    });
    await expect(
      region.getByRole("heading", { name: "Custom notes", exact: true }),
    ).toBeVisible();
    await region
      .getByLabel("Note name", { exact: true })
      .fill("Native independently installed record");
    await region
      .getByRole("button", { name: "Save note", exact: true })
      .click();
    await expect(
      region.getByText("Native independently installed record", {
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      region.getByText("Native independently installed record", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { require?: unknown }).require,
      ),
    ).toBe("undefined");
    await mkdir("docs/verification/executable-modules", { recursive: true });
    await page.screenshot({
      path: "docs/verification/executable-modules/custom-view-electron.png",
    });
  } finally {
    await app.close();
    await pool.end();
    await rm(profile, { recursive: true, force: true });
  }
});

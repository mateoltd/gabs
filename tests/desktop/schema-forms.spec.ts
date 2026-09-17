import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { publishExecutableFixture } from "../support/executable-fixture";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import module from "../fixtures/schema-editor/module";
const require = createRequire(resolve("apps/desktop/package.json"));

test("native structured SDK form saves authoritative nested data without focusing the desktop", async () => {
  test.setTimeout(120000);
  await publishExecutableFixture({
    id: module.id,
    sourceDirectory: "tests/fixtures/schema-editor",
  });
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
            name: "Native schema acceptance",
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
    await page.getByRole("link", { name: module.name, exact: true }).click();
    const region = page.getByRole("region", {
      name: "Structured intake",
      exact: true,
    });
    await expect(
      region.getByRole("heading", { name: module.name, exact: true }),
    ).toBeVisible();
    await region
      .getByLabel("Candidate", { exact: true })
      .fill("Native nested record");
    await region
      .getByRole("checkbox", { name: "Approved", exact: true })
      .check();
    const select = async (label: string, value: string) => {
      await region.getByRole("combobox", { name: label, exact: true }).click();
      await region
        .getByRole("option")
        .and(page.locator(`[data-value="${value}"]`))
        .click();
    };
    await select("Choice", "choice:1");
    await select("Delivery format", "1");
    await region.getByLabel("Desk", { exact: true }).fill("Reception");
    await region
      .getByRole("button", { name: "Add lines item", exact: true })
      .click();
    await region.getByLabel("Label", { exact: true }).fill("Paper");
    await region.getByLabel("Quantity", { exact: true }).fill("3");
    await region
      .getByRole("button", { name: "Edit metrics as JSON", exact: true })
      .click();
    await region.getByLabel("Metrics", { exact: true }).fill('{"boxes":2}');
    await region
      .getByRole("button", { name: "Save intake", exact: true })
      .click();
    await expect(region.getByRole("status")).toHaveText(
      "Saved Native nested record: 1 lines.",
    );
    const records = () =>
      pool.query(
        "select data from suite.module_records where workspace_id=$1 and module_id=$2 and resource='records'",
        [workspaceId, module.id],
      );
    const expected = [
      {
        data: {
          candidate: "Native nested record",
          approved: true,
          choice: false,
          delivery: { method: "pickup", desk: "Reception" },
          lines: [{ label: "Paper", quantity: 3, tags: [] }],
          metrics: { boxes: 2 },
        },
      },
    ];
    expect((await records()).rows).toEqual(expected);
    // The test must remain invisible/unfocused, including after native dialogs and IPC.
    expect(
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return (
          !window.isFocused() && (!window.isVisible() || window.isMinimized())
        );
      }),
    ).toBe(true);
    await mkdir("docs/verification/schema-forms", { recursive: true });
    // Native capture is viewport-bound while the window stays hidden.
    // Capture both ends instead of requesting offscreen pixels from a tall element.
    await region
      .getByRole("heading", { name: module.name, exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/schema-forms/electron.png",
    });
    await region.getByRole("status").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/schema-forms/electron-bottom.png",
    });
    await page.reload();
    await expect(
      region.getByRole("heading", { name: module.name, exact: true }),
    ).toBeVisible();
    expect((await records()).rows).toEqual(expected);
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

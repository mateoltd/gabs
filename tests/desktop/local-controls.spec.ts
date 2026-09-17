import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import { publishLocalPackage } from "../support/local-package-fixture";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));
test("minimized native local module controls install signed code and recover an interrupted operation", async () => {
  test.setTimeout(90000);
  const name = `Native notes ${crypto.randomUUID().slice(0, 8)}`;
  const fixture = await publishLocalPackage({ name });
  const profile = await mkdtemp(resolve(tmpdir(), "suite-local-controls-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
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
  let app = await launch(),
    workspace = "";
  try {
    let page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    const me = await page.evaluate(async () => {
      const response = await window.suiteDesktop!.execute({ operation: "me" });
      if (response.status !== 200) throw Error("Native authentication failed");
      return response.body as { workspaces: { id: string; kind: string }[] };
    });
    workspace = me.workspaces.find((w) => w.kind === "personal")!.id;
    await pool.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
      [workspace, fixture.pkg.module_id],
    );
    await pool.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
      [workspace, fixture.pkg.module_id],
    );
    await pool.query(
      "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1 on conflict do nothing",
      [workspace, fixture.pkg.module_id],
    );
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Native local actions");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage local modules", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Browse personal modules", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Install ${name}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save local installation", exact: true })
      .click();
    await expect(
      page.getByText(`${name} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Local actions", exact: true })
      .click();
    await page
      .getByLabel("Text", { exact: true })
      .fill("Native recovered operation");
    await page.getByLabel("Delay Ms", { exact: true }).fill("1500");
    const started = page.waitForEvent("worker");
    await page
      .getByRole("button", { name: "Run locally", exact: true })
      .click();
    await started;
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => w.isMinimized() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await page.getByLabel("Profile", { exact: true }).click();
    await page
      .getByRole("option", { name: "Native local actions", exact: true })
      .click();
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Local actions", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Awaiting recovery", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Retry request", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Accepted", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await selectValue(
      page,
      "Module and resource",
      fixture.pkg.module_id + "/items",
    );
    await expect(
      page.getByRole("cell", {
        name: "Native recovered operation",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await mkdir("docs/verification/local-controls", { recursive: true });
    await page.screenshot({
      path: "docs/verification/local-controls/desktop.png",
    });
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => w.isMinimized() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    await app.close();
    if (workspace)
      await pool.query(
        "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id=$2",
        [workspace, fixture.pkg.module_id],
      );
    await pool.end();
    await rm(profile, { recursive: true, force: true });
  }
});

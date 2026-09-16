import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { publishLocalPackage } from "../local-package-fixture";
import { selectValue } from "./controls.helpers";

test("personal registry installation, local action cancellation and restart recovery preserve independent work", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const name = `Local notes ${crypto.randomUUID().slice(0, 8)}`;
  const fixture = await publishLocalPackage({ name });
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let workspace = "";
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    workspace = me.workspaces.find(
      (w: { kind: string }) => w.kind === "personal",
    ).id;
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
      .fill("Offline actions");
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
    await expect(
      page.getByRole("button", { name: `Install ${name}`, exact: true }),
    ).toBeVisible();
    await pool.query(
      "update suite.entitlements set active=false where workspace_id=$1 and module_id=$2",
      [workspace, fixture.pkg.module_id],
    );
    await page
      .getByRole("button", { name: `Install ${name}`, exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("must be enabled");
    await pool.query(
      "update suite.entitlements set active=true where workspace_id=$1 and module_id=$2",
      [workspace, fixture.pkg.module_id],
    );
    await page
      .getByRole("button", { name: `Install ${name}`, exact: true })
      .click();
    await page.getByLabel("Prefix", { exact: true }).fill("Personal: ");
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
    await selectValue(
      page,
      "Module and resource",
      fixture.pkg.module_id + "/items",
    );
    await context.setOffline(true);
    await page
      .getByRole("button", { name: "Local actions", exact: true })
      .click();
    await page.getByLabel("Text", { exact: true }).fill("Cancelled note");
    await page.getByLabel("Delay Ms", { exact: true }).fill("1500");
    let worker = page.waitForEvent("worker");
    await page
      .getByRole("button", { name: "Run locally", exact: true })
      .click();
    await worker;
    await page
      .getByRole("button", { name: "Cancel operation", exact: true })
      .click();
    const requests = page.getByRole("table", {
      name: "Local requests",
      exact: true,
    });
    await expect(
      requests.getByRole("cell", { name: /Interrupted/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage local modules", exact: true })
      .click();
    await page
      .getByRole("table", { name: "Local modules", exact: true })
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Configure locally", exact: true })
      .click();
    await page.getByLabel("Prefix", { exact: true }).fill("Changed: ");
    await page
      .getByRole("button", { name: "Save local installation", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Resolve or dismiss pending local requests",
    );
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Local actions", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry request", exact: true })
      .click();
    await expect(
      page.getByText("Completed and saved locally.", { exact: true }),
    ).toBeVisible();
    await expect(
      requests.getByRole("cell", { name: "Accepted", exact: true }),
    ).toHaveCount(1);
    await page.getByLabel("Text", { exact: true }).fill("Rejected note");
    await page.getByRole("checkbox", { name: "Reject", exact: true }).check();
    await page
      .getByRole("button", { name: "Run locally", exact: true })
      .click();
    await expect(
      requests.getByRole("cell", { name: /^Rejected/ }),
    ).toBeVisible();
    await requests
      .getByRole("row")
      .filter({ hasText: "Rejected" })
      .getByRole("button", { name: "Dismiss request", exact: true })
      .click();
    await page.getByRole("checkbox", { name: "Reject", exact: true }).uncheck();
    await page.getByLabel("Text", { exact: true }).fill("Restart note");
    await page.getByLabel("Delay Ms", { exact: true }).fill("1500");
    worker = page.waitForEvent("worker");
    await page
      .getByRole("button", { name: "Run locally", exact: true })
      .click();
    await worker;
    // Reload kills the renderer worker after the encrypted pending request was saved.
    await page.reload();
    await context.setOffline(false);
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
    const profileId = await page
      .getByLabel("Profile", { exact: true })
      .evaluate(async () => {
        const request = indexedDB.open("suite-local-profiles");
        const db = await new Promise<IDBDatabase>((resolve) => {
          request.onsuccess = () => resolve(request.result);
        });
        const read = db.transaction("vaults").objectStore("vaults").getAll();
        const profiles = await new Promise<{ id: string }[]>((resolve) => {
          read.onsuccess = () => resolve(read.result);
        });
        db.close();
        return profiles[0].id;
      });
    await selectValue(page, "Profile", profileId);
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await context.setOffline(true);
    await page
      .getByRole("button", { name: "Local actions", exact: true })
      .click();
    await expect(
      requests.getByRole("cell", { name: "Awaiting recovery", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Retry request", exact: true })
      .click();
    await expect(
      requests.getByRole("cell", { name: "Accepted", exact: true }),
    ).toHaveCount(2);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/local-controls", { recursive: true });
    await page.getByRole("dialog").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: "docs/verification/local-controls/actions.png",
    });
    await requests.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/local-controls/recovery.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await requests.scrollIntoViewIfNeeded();
    expect(
      await page
        .locator("body")
        .evaluate((element) => element.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/local-controls/recovery-narrow.png",
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await selectValue(
      page,
      "Module and resource",
      fixture.pkg.module_id + "/items",
    );
    await expect(
      page.getByRole("cell", { name: "Personal: Cancelled note", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("cell", { name: "Personal: Restart note", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("cell", { name: "Personal: Rejected note", exact: true }),
    ).toHaveCount(0);
    await publishLocalPackage({
      id: fixture.pkg.module_id,
      name,
      version: "2.0.0",
      field: "body",
      migrationDelayMs: 4000,
      localStorage: {
        version: 2,
        compatible: { minimum: 2, maximum: 2 },
        migrations: { rename: { from: 1, to: 2 } },
      },
    });
    await context.setOffline(false);
    await page
      .getByRole("button", { name: "Manage local modules", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Browse personal modules", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Install ${name}`, exact: true })
      .click();
    await expect(page.getByLabel("Prefix", { exact: true })).toHaveValue(
      "Personal: ",
    );
    await expect(
      page.getByText("This update changes how saved records are stored.", {
        exact: false,
      }),
    ).toBeVisible();
    const migrationWorker = page.waitForEvent("worker");
    await page
      .getByRole("button", { name: "Save local installation", exact: true })
      .click();
    await migrationWorker;
    await page
      .getByRole("button", { name: "Cancel installation", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("cancelled");
    await page
      .getByRole("button", { name: "Back to modules", exact: true })
      .click();
    const installations = page.getByRole("list", {
      name: "Unfinished local installations",
      exact: true,
    });
    await expect(
      installations.getByText("Interrupted", { exact: true }),
    ).toBeVisible();
    await installations
      .getByRole("button", { name: "Discard installation", exact: true })
      .click();
    await expect(installations).toHaveCount(0);
    await expect(
      page.getByText(
        "Installation request discarded. Your installed module and records are preserved.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("table", { name: "Local modules", exact: true })
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("cell", { name: "1.0.0", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: `Install ${name}`, exact: true })
      .click();
    const resuming = page.waitForEvent("worker");
    await page
      .getByRole("button", { name: "Save local installation", exact: true })
      .click();
    await resuming;
    await context.setOffline(true);
    // Navigation destroys the running worker after its candidate has been saved.
    await page.reload();
    await page
      .getByRole("button", { name: "Open local profiles", exact: true })
      .click();
    await selectValue(page, "Profile", profileId);
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage local modules", exact: true })
      .click();
    await expect(
      installations.getByText("Awaiting recovery", { exact: true }),
    ).toBeVisible();
    await mkdir("docs/verification/local-install-recovery", {
      recursive: true,
    });
    await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: "docs/verification/local-install-recovery/pending.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    for (const name of ["Resume installation", "Discard installation"]) {
      const button = installations.getByRole("button", { name, exact: true });
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    await page.screenshot({
      path: "docs/verification/local-install-recovery/pending-narrow.png",
    });
    const audit = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await installations
      .getByRole("button", { name: "Resume installation", exact: true })
      .click();
    await expect(
      page.getByText(`${name} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await context.setOffline(true);
    const row = page
      .getByRole("table", { name: "Local modules", exact: true })
      .getByRole("row")
      .filter({ hasText: name });
    await row
      .getByRole("button", { name: "Uninstall locally", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await mkdir("docs/verification/local-migrations", { recursive: true });
    await page.screenshot({
      path: "docs/verification/local-migrations/retained.png",
    });
    await page
      .getByRole("table", { name: "Retained local modules", exact: true })
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Restore locally", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save local installation", exact: true })
      .click();
    await expect(
      page.getByText(`${name} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/verification/local-controls/modules.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page
        .locator("body")
        .evaluate((el) => el.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/local-controls/modules-narrow.png",
    });
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await selectValue(
      page,
      "Module and resource",
      fixture.pkg.module_id + "/items",
    );
    await expect(
      page.getByRole("columnheader", { name: "Body", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Personal: Restart note", exact: true }),
    ).toHaveCount(1);
    await page.screenshot({
      path: "docs/verification/local-migrations/restored-narrow.png",
    });
    await page
      .getByRole("button", { name: "Local actions", exact: true })
      .click();
    await page.getByLabel("Text", { exact: true }).fill("After installation");
    await page
      .getByRole("button", { name: "Run locally", exact: true })
      .click();
    await expect(
      page.getByText("Completed and saved locally.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(
      page.getByRole("cell", {
        name: "Personal: After installation",
        exact: true,
      }),
    ).toHaveCount(1);
    await page.screenshot({
      path: "docs/verification/local-install-recovery/recovered-narrow.png",
    });
  } finally {
    if (workspace)
      await pool.query(
        "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id=$2",
        [workspace, fixture.pkg.module_id],
      );
    await pool.end();
  }
});

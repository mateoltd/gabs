import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { publishLocalPackage } from "../local-package-fixture";
import { selectValue } from "./controls.helpers";

test("retained local releases support safe offline rollback and preserve installation history across removal and unlock", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const name = `Version notes ${crypto.randomUUID().slice(0, 8)}`;
  const first = await publishLocalPackage({ name });
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let workspace = "";
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const rows = () =>
    page.getByRole("table", { name: "Local modules", exact: true });
  const install = async (prefix: string) => {
    await button("Browse personal modules").click();
    await button(`Install ${name}`).click();
    await page.getByLabel("Prefix", { exact: true }).fill(prefix);
    await button("Save local installation").click();
    await expect(
      page.getByText(`${name} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
  };
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await button("Open workspace").click();
    await expect(button("Account menu")).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    workspace = me.workspaces.find(
      (w: { kind: string }) => w.kind === "personal",
    ).id;
    await pool.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
      [workspace, first.pkg.module_id],
    );
    await pool.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
      [workspace, first.pkg.module_id],
    );
    await pool.query(
      "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1 on conflict do nothing",
      [workspace, first.pkg.module_id],
    );
    await button("Account menu").click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Retained versions");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Create profile").click();
    await button("Manage local modules").click();
    await install("Original: ");
    await button("Close dialog").click();
    await button("Local actions").click();
    await selectValue(page, "Action", first.pkg.module_id + "/capture");
    await page.getByLabel("Text", { exact: true }).fill("Preserved note");
    await button("Run locally").click();
    await expect(
      page.getByText("Completed and saved locally.", { exact: true }),
    ).toBeVisible();
    await button("Close dialog").click();
    await publishLocalPackage({
      id: first.pkg.module_id,
      name,
      version: "2.0.0",
      field: "body",
      localStorage: {
        version: 2,
        compatible: { minimum: 2, maximum: 2 },
        migrations: { rename: { from: 1, to: 2 } },
      },
    });
    await button("Manage local modules").click();
    await install("Current: ");
    await publishLocalPackage({
      id: first.pkg.module_id,
      name,
      version: "1.1.0",
      field: "body",
      localStorage: {
        version: 1,
        compatible: { minimum: 1, maximum: 2 },
        migrations: {},
      },
    });
    await pool.query(
      "insert into suite.platform_settings(workspace_id,key,value) values($1,$2,$3)",
      [workspace, `pin:${first.pkg.module_id}`, { version: "1.1.0" }],
    );
    await install("Compatible: ");
    await pool.query(
      "delete from suite.platform_settings where workspace_id=$1 and key=$2",
      [workspace, `pin:${first.pkg.module_id}`],
    );
    await install("Current: ");
    await context.setOffline(true);
    await rows()
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Retained versions", exact: true })
      .click();
    await expect(button("Review version 1.0.0")).toBeDisabled();
    await expect(
      page.getByText(/1.0.0 cannot use local data version 2/),
    ).toBeVisible();
    await expect(button("Review version 1.1.0")).toBeEnabled();
    await mkdir("docs/verification/local-versions", { recursive: true });
    await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: "docs/verification/local-versions/versions.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/local-versions/versions-narrow.png",
    });
    await button("Review version 1.1.0").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Prefix", { exact: true })).toHaveValue(
      "Compatible: ",
    );
    await button("Save local installation").click();
    await expect(
      page.getByText(`${name} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await button("Back to modules").click();
    await button("Installation history").click();
    const history = () =>
      page.getByRole("list", {
        name: "Local installation history",
        exact: true,
      });
    await expect(
      history().getByRole("heading", {
        name: "Saved installation",
        exact: true,
      }),
    ).toHaveCount(5);
    await button("Back to modules").click();
    await rows()
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Uninstall locally", exact: true })
      .click();
    await button("Installation history").click();
    await expect(
      history().getByRole("heading", { name: "Removed locally", exact: true }),
    ).toHaveCount(1);
    await button("Back to modules").click();
    await button("Restore locally").click();
    await button("Save local installation").click();
    await expect(
      page.getByText(`${name} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await button("Close dialog").click();
    await button("Lock profile").click();
    await page.getByRole("combobox", { name: "Profile", exact: true }).click();
    await page
      .getByRole("option", { name: "Retained versions", exact: true })
      .click();
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Unlock profile").click();
    await selectValue(
      page,
      "Module and resource",
      first.pkg.module_id + "/items",
    );
    await expect(
      page.getByRole("cell", { name: "Original: Preserved note", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Body", exact: true }),
    ).toBeVisible();
    await button("Manage local modules").click();
    await button("Installation history").click();
    await expect(
      history().getByRole("heading", {
        name: "Saved installation",
        exact: true,
      }),
    ).toHaveCount(6);
    await expect(
      history().getByRole("heading", { name: "Removed locally", exact: true }),
    ).toHaveCount(1);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: "docs/verification/local-versions/history-narrow.png",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: "docs/verification/local-versions/history.png",
    });
  } finally {
    await context.setOffline(false);
    if (workspace)
      await pool.query(
        "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id=$2",
        [workspace, first.pkg.module_id],
      );
    await pool.end();
  }
});

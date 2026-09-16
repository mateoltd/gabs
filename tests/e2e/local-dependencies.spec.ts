import "dotenv/config";
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { publishLocalPackage } from "../local-package-fixture";
import { selectValue } from "./controls.helpers";

test("local installation reviews dependencies and coordinated consumer updates, then restores the set offline", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const suffix = crypto.randomUUID().slice(0, 8);
  const providerName = `Provider ${suffix}`,
    consumerName = `Consumer ${suffix}`;
  const provider = await publishLocalPackage({ name: providerName });
  const consumer = await publishLocalPackage({
    name: consumerName,
    dependencies: { [provider.pkg.module_id]: "^1" },
    dependencyPackages: [provider.pkg],
  });
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let workspace = "";
  const ids = [provider.pkg.module_id, consumer.pkg.module_id];
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const rows = () =>
    page.getByRole("table", { name: "Local modules", exact: true });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await button("Open workspace").click();
    await expect(button("Account menu")).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    workspace = me.workspaces.find(
      (w: { kind: string }) => w.kind === "personal",
    ).id;
    for (const id of ids) {
      await pool.query(
        "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
        [workspace, id],
      );
      await pool.query(
        "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
        [workspace, id],
      );
      await pool.query(
        "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1 on conflict do nothing",
        [workspace, id],
      );
    }
    await button("Account menu").click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Local dependency review");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Create profile").click();
    await button("Manage local modules").click();
    await button("Browse personal modules").click();
    await expect(button(`Install ${providerName}`)).toBeVisible();
    // A root entitlement cannot authorize a now-revoked dependency download.
    await pool.query(
      "update suite.entitlements set active=false where workspace_id=$1 and module_id=$2",
      [workspace, provider.pkg.module_id],
    );
    await button(`Install ${consumerName}`).click();
    await expect(page.getByRole("alert")).toContainText("must be enabled");
    await expect(
      rows().getByRole("row").filter({ hasText: consumerName }),
    ).toHaveCount(0);
    await pool.query(
      "update suite.entitlements set active=true where workspace_id=$1 and module_id=$2",
      [workspace, provider.pkg.module_id],
    );
    await button(`Install ${consumerName}`).click();
    await expect(
      page.getByRole("group", { name: providerName, exact: true }),
    ).toBeVisible();
    await page.getByLabel("Prefix", { exact: true }).first().fill("Consumer: ");
    await page
      .getByRole("group", { name: providerName, exact: true })
      .getByLabel("Prefix", { exact: true })
      .fill("Provider: ");
    await button("Save local installation").click();
    await expect(
      page.getByText(`${consumerName} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    for (const name of [providerName, consumerName])
      await expect(
        rows().getByRole("row").filter({ hasText: name }),
      ).toHaveCount(1);
    await button("Close dialog").click();
    const capture = async (id: string, text: string) => {
      await button("Local actions").click();
      await selectValue(page, "Action", id + "/capture");
      await page.getByLabel("Text", { exact: true }).fill(text);
      await button("Run locally").click();
      await expect(
        page.getByText("Completed and saved locally.", { exact: true }),
      ).toBeVisible();
      await button("Close dialog").click();
    };
    await capture(provider.pkg.module_id, "Saved provider");
    await capture(consumer.pkg.module_id, "Saved consumer");
    const localStorage = {
      version: 2,
      compatible: { minimum: 2, maximum: 2 },
      migrations: { rename: { from: 1, to: 2 } },
    };
    const nextProvider = await publishLocalPackage({
      id: provider.pkg.module_id,
      name: providerName,
      version: "2.0.0",
      field: "body",
      localStorage,
    });
    await publishLocalPackage({
      id: consumer.pkg.module_id,
      name: consumerName,
      version: "2.0.0",
      field: "body",
      localStorage,
      dependencies: { [provider.pkg.module_id]: "^2" },
      dependencyPackages: [nextProvider.pkg],
    });
    await button("Manage local modules").click();
    await button("Browse personal modules").click();
    await button(`Install ${providerName}`).click();
    const consumerConfig = page.getByRole("group", {
      name: consumerName,
      exact: true,
    });
    await expect(consumerConfig).toBeVisible();
    await expect(
      consumerConfig.getByText("Version 2.0.0", { exact: true }),
    ).toBeVisible();
    await expect(
      consumerConfig.getByLabel("Prefix", { exact: true }),
    ).toHaveValue("Consumer: ");
    await expect(
      page.getByLabel("Prefix", { exact: true }).first(),
    ).toHaveValue("Provider: ");
    await mkdir("docs/verification/local-dependencies", { recursive: true });
    await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
    await expect
      .poll(() => page.getByRole("dialog").evaluate((el) => el.scrollTop))
      .toBe(0);
    await page.screenshot({
      path: "docs/verification/local-dependencies/review.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/local-dependencies/review-narrow.png",
    });
    await button("Save local installation").click();
    await expect(
      page.getByText(`${providerName} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await context.setOffline(true);
    for (const name of [consumerName, providerName]) {
      await rows()
        .getByRole("row")
        .filter({ hasText: name })
        .getByRole("button", { name: "Uninstall locally", exact: true })
        .click();
      await expect(
        rows().getByRole("row").filter({ hasText: name }),
      ).toHaveCount(0);
    }
    await page
      .getByRole("table", { name: "Retained local modules", exact: true })
      .getByRole("row")
      .filter({ hasText: consumerName })
      .getByRole("button", { name: "Restore locally", exact: true })
      .click();
    await expect(
      page.getByRole("group", { name: providerName, exact: true }),
    ).toBeVisible();
    await button("Save local installation").click();
    await expect(
      page.getByText(`${consumerName} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    for (const name of [providerName, consumerName])
      await expect(
        rows()
          .getByRole("row")
          .filter({ hasText: name })
          .getByRole("cell", { name: "2.0.0", exact: true }),
      ).toBeVisible();
    await button("Close dialog").click();
    await selectValue(
      page,
      "Module and resource",
      provider.pkg.module_id + "/items",
    );
    await expect(
      page.getByRole("columnheader", { name: "Body", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Provider: Saved provider", exact: true }),
    ).toHaveCount(1);
    await selectValue(
      page,
      "Module and resource",
      consumer.pkg.module_id + "/items",
    );
    await expect(
      page.getByRole("cell", { name: "Consumer: Saved consumer", exact: true }),
    ).toHaveCount(1);
    await capture(consumer.pkg.module_id, "After coordinated restore");
    await expect(
      page.getByRole("cell", {
        name: "Consumer: After coordinated restore",
        exact: true,
      }),
    ).toHaveCount(1);
    await page.screenshot({
      path: "docs/verification/local-dependencies/restored-narrow.png",
    });
  } finally {
    if (workspace)
      await pool.query(
        "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id=any($2::text[])",
        [workspace, ids],
      );
    await pool.end();
  }
});

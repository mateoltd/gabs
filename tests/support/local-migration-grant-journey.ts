import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { selectValue } from "../e2e/controls.helpers";
import { migrationGrantFixture } from "./local-migration-grant-fixture";
export async function migrationGrantJourney(
  page: Page,
  native: boolean,
  review: () => Promise<void>,
) {
  const fixture = await migrationGrantFixture();
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const me = native
    ? await page.evaluate(
        async () =>
          (await window.suiteDesktop!.execute({ operation: "me" })).body as {
            workspaces: { id: string; kind: string }[];
          },
      )
    : await (await page.request.get("/api/v1/me")).json();
  const workspace = me.workspaces.find(
    (w: { kind: string }) => w.kind === "personal",
  ).id;
  try {
    for (const id of [
      fixture.provider.pkg.module_id,
      fixture.consumer.pkg.module_id,
    ]) {
      await pool.query(
        "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
        [workspace, id],
      );
      await pool.query(
        "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
        [workspace, id],
      );
      await pool.query(
        "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1",
        [workspace, id],
      );
    }
    await button("Account menu").click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Migration reference review");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Create profile").click();
    await button("Manage local modules").click();
    await button("Browse personal modules").click();
    await button(`Install ${fixture.consumerName}`).click();
    await button("Save local installation").click();
    await expect(
      page.getByText(
        `${fixture.consumerName} is ready in this local profile.`,
        { exact: true },
      ),
    ).toBeVisible();
    await button("Close dialog").click();
    for (const pkg of [fixture.provider.pkg, fixture.consumer.pkg]) {
      await button("Local actions").click();
      await selectValue(page, "Action", pkg.module_id + "/capture");
      await page
        .getByLabel("Text", { exact: true })
        .fill("Preserved local note");
      await button("Run locally").click();
      await expect(
        page.getByText("Completed and saved locally.", { exact: true }),
      ).toBeVisible();
      await button("Close dialog").click();
    }
    await fixture.upgrade();
    await button("Manage local modules").click();
    const choose = async () => {
      await button("Browse personal modules").click();
      await button(`Install ${fixture.consumerName}`).click();
      return page.getByRole("checkbox", {
        name: `Allow ${fixture.consumerName} to read ${fixture.providerName}: Notes`,
        exact: true,
      });
    };
    let consent = await choose();
    await expect(consent).not.toBeChecked();
    await button("Save local installation").click();
    await expect(page.getByRole("alert")).toContainText(
      "Allow this reference in Local modules",
    );
    await button("Back to modules").click();
    const modules = page.getByRole("table", {
      name: "Local modules",
      exact: true,
    });
    for (const name of [fixture.providerName, fixture.consumerName])
      await expect(
        modules.getByRole("row").filter({ hasText: name }),
      ).toContainText("1.0.0");
    await button("Discard installation").click();
    consent = await choose();
    await expect(consent).not.toBeChecked();
    await consent.focus();
    await consent.press("Space");
    await expect(consent).toBeChecked();
    await review();
    await page.getByLabel("Prefix", { exact: true }).first().fill("slow");
    const started = page.waitForEvent("worker");
    await button("Save local installation").click();
    await started;
    await button("Cancel installation").click();
    await expect(page.getByRole("alert")).toContainText("cancelled");
    await button("Back to modules").click();
    await expect(
      page.getByText("Reference access approved for this installation:", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        `${fixture.consumerName} 1.1.0 may read ${fixture.providerName} 1.1.0: Notes.`,
        { exact: true },
      ),
    ).toBeVisible();
    for (const name of [fixture.providerName, fixture.consumerName])
      await expect(
        modules.getByRole("row").filter({ hasText: name }),
      ).toContainText("1.0.0");
    await button("Close dialog").click();
    await button("Lock profile").click();
    await page.getByRole("combobox", { name: "Profile", exact: true }).click();
    await page
      .getByRole("option", { name: "Migration reference review", exact: true })
      .click();
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Unlock profile").click();
    await button("Manage local modules").click();
    await button("Resume installation").click();
    await expect(
      page.getByText(
        `${fixture.consumerName} is ready in this local profile.`,
        { exact: true },
      ),
    ).toBeVisible();
    for (const name of [fixture.providerName, fixture.consumerName])
      await expect(
        modules.getByRole("row").filter({ hasText: name }),
      ).toContainText("1.1.0");
    await button("Reference access").click();
    await expect(
      page.getByRole("checkbox", {
        name: `Allow ${fixture.consumerName} to read ${fixture.providerName}: Notes`,
        exact: true,
      }),
    ).toBeChecked();
    await button("Close dialog").click();
    await selectValue(
      page,
      "Module and resource",
      fixture.consumer.pkg.module_id + "/items",
    );
    await expect(
      page.getByRole("cell", { name: "Preserved local note", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "New migration target", exact: true }),
    ).toBeVisible();
  } finally {
    await pool.end();
  }
}

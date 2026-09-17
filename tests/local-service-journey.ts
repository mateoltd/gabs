import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { selectValue } from "./e2e/controls.helpers";
import { localServiceFixture } from "./local-service-fixture";
export async function localServiceJourney(page: Page, native: boolean) {
  const fixture = await localServiceFixture();
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
      .fill("Local service consent");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Create profile").click();
    await button("Manage local modules").click();
    await button("Browse personal modules").click();
    await button(`Install ${fixture.consumerName}`).click();
    await page
      .getByRole("group", { name: fixture.providerName, exact: true })
      .getByLabel("Prefix", { exact: true })
      .fill("Provider: ");
    await button("Save local installation").click();
    await expect(
      page.getByText(
        `${fixture.consumerName} is ready in this local profile.`,
        { exact: true },
      ),
    ).toBeVisible();
    await button("Close dialog").click();
    const capture = async (text: string) => {
      await button("Local actions").click();
      await selectValue(
        page,
        "Action",
        fixture.consumer.pkg.module_id + "/capture",
      );
      await page.getByLabel("Text", { exact: true }).fill(text);
      await button("Run locally").click();
    };
    await capture("Shared note");
    await expect(page.getByRole("alert")).toContainText(
      "Allow this service in Local modules",
    );
    await button("Close dialog").click();
    const grant = async () => {
      await button("Manage local modules").click();
      await button("Service access").click();
      return page.getByRole("checkbox", {
        name: `Allow ${fixture.consumerName} to run ${fixture.providerName}: Capture note`,
        exact: true,
      });
    };
    let consent = await grant();
    await expect(consent).not.toBeChecked();
    await consent.focus();
    await consent.press("Space");
    await expect(consent).toBeChecked();
    await expect(consent).toBeEnabled();
    await button("Close dialog").click();
    await button("Lock profile").click();
    await page.getByRole("combobox", { name: "Profile", exact: true }).click();
    await page
      .getByRole("option", { name: "Local service consent", exact: true })
      .click();
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Unlock profile").click();
    await button("Local actions").click();
    await button("Retry request").click();
    await expect(
      page.getByText("Completed and saved locally.", { exact: true }),
    ).toBeVisible();
    await button("Close dialog").click();
    for (const [id, text] of [
      [fixture.consumer.pkg.module_id, "Consumer: Shared note"],
      [fixture.provider.pkg.module_id, "Provider: Shared note"],
    ]) {
      await selectValue(page, "Module and resource", id + "/items");
      await expect(
        page.getByRole("cell", { name: text, exact: true }),
      ).toHaveCount(1);
    }
    consent = await grant();
    await consent.click();
    await expect(consent).not.toBeChecked();
    await expect(consent).toBeEnabled();
    await button("Close dialog").click();
    await capture("Rejected after revocation");
    await expect(page.getByRole("alert")).toContainText(
      "Allow this service in Local modules",
    );
    await button("Close dialog").click();
    await selectValue(
      page,
      "Module and resource",
      fixture.consumer.pkg.module_id + "/items",
    );
    await expect(
      page.getByRole("cell", { name: "Consumer: Shared note", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("cell", {
        name: "Consumer: Rejected after revocation",
        exact: true,
      }),
    ).toHaveCount(0);
    await grant();
  } finally {
    await pool.end();
  }
}

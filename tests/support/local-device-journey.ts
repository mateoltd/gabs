import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { publishLocalPackage } from "./local-package-fixture";

export async function localDeviceJourney(page: Page, native: boolean) {
  const id = `device-notebook-${crypto.randomUUID().slice(0, 8)}`;
  const fixture = await publishLocalPackage({
    id,
    name: "Device notebook",
    transform: (file, source) =>
      file === "module.ts"
        ? source
            .replace("operation,Type", "operation,capability,Type")
            .replace(
              "resources:{items:",
              `capabilities:{export:capability({kind:'files.export',permission:'${id}.capture'}),notify:capability({kind:'notifications.show',permission:'${id}.capture'})},resources:{items:`,
            )
        : source,
  });
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
    await button("Account menu").click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Device consent");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Create profile").click();
    await button("Manage local modules").click();
    await button("Device access").click();
    await expect(
      page.getByText("No device access needed", { exact: true }),
    ).toBeVisible();
    await button("Back to modules").click();
    await button("Browse personal modules").click();
    await button("Install Device notebook").click();
    await button("Save local installation").click();
    await expect(
      page.getByText("Device notebook is ready in this local profile.", {
        exact: true,
      }),
    ).toBeVisible();
    if (!native) await page.context().setOffline(true);
    await button("Device access").click();
    const files = page.getByRole("checkbox", {
      name: "Allow Device notebook to export files",
      exact: true,
    });
    const notifications = page.getByRole("checkbox", {
      name: "Allow Device notebook to show notifications",
      exact: true,
    });
    await expect(files).not.toBeChecked();
    await expect(notifications).not.toBeChecked();
    await expect(files).toHaveAccessibleDescription(
      `Version 1.0.0. Capability: export. Permission: ${id}.capture.`,
    );
    await expect(notifications).toHaveAccessibleDescription(
      `Version 1.0.0. Capability: notify. Permission: ${id}.capture.`,
    );
    await files.focus();
    await files.press("Space");
    await expect(files).toBeChecked();
    await expect(files).toBeEnabled();
    await expect(files).toBeFocused();
    await expect(notifications).not.toBeChecked();
    const unlock = async () => {
      await button("Close dialog").click();
      await button("Lock profile").click();
      await page
        .getByRole("combobox", { name: "Profile", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Device consent", exact: true })
        .click();
      await page
        .getByLabel("Passphrase", { exact: true })
        .fill("correct horse battery staple");
      await button("Unlock profile").click();
      await button("Manage local modules").click();
      await button("Device access").click();
    };
    await unlock();
    await expect(files).toBeChecked();
    await expect(notifications).not.toBeChecked();
    await files.click();
    await expect(files).not.toBeChecked();
    await expect(files).toBeEnabled();
    await expect(page.getByRole("status")).toContainText(
      "Device access revoked.",
    );
    await unlock();
    await expect(files).not.toBeChecked();
    await files.click();
    await expect(files).toBeChecked();
    await expect(files).toBeEnabled();
    return fixture;
  } finally {
    await pool.end();
  }
}

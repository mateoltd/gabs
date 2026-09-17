import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { publishLocalPackage } from "./local-package-fixture";
import { selectValue } from "../e2e/controls.helpers";

export async function localDeviceEffectsJourney(page: Page, native: boolean) {
  const id = `device-export-${crypto.randomUUID().slice(0, 8)}`;
  await publishLocalPackage({
    id,
    name: "Device exports",
    transform: (file, source) =>
      file === "module.ts"
        ? source
            .replace("operation,Type", "operation,capability,Type")
            .replace(
              "resources:{items:",
              `capabilities:{export:capability({kind:'files.export',permission:'${id}.capture'})},resources:{items:`,
            )
        : `import {defineLocalModule} from '@suite/module-sdk/local';import module from './module';export default defineLocalModule(module)({async capture(ctx,input){await ctx.resource('items').create({text:input.text});return ctx.device.request('export',{filename:'notes.txt',content:input.text});}});`,
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
  } finally {
    await pool.end();
  }
  await button("Account menu").click();
  await page
    .getByRole("menuitem", { name: "Local profiles", exact: true })
    .click();
  await page.getByLabel("Profile name", { exact: true }).fill("Device actions");
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("correct horse battery staple");
  await button("Create profile").click();
  await button("Device requests").click();
  await expect(
    page.getByText("No device requests", { exact: true }),
  ).toBeVisible();
  await button("Close dialog").click();
  await button("Manage local modules").click();
  await button("Browse personal modules").click();
  await button("Install Device exports").click();
  await button("Save local installation").click();
  await expect(
    page.getByText("Device exports is ready in this local profile.", {
      exact: true,
    }),
  ).toBeVisible();
  await button("Device access").click();
  const consent = page.getByRole("checkbox", {
    name: "Allow Device exports to export files",
    exact: true,
  });
  await consent.click();
  await expect(consent).toBeChecked();
  await expect(consent).toBeEnabled();
  await button("Close dialog").click();
  await selectValue(page, "Module and resource", id + "/items");
  const capture = async (text: string) => {
    await button("Local actions").click();
    await selectValue(page, "Action", id + "/capture");
    await page.getByLabel("Text", { exact: true }).fill(text);
    await button("Run locally").click();
    await expect(
      page.getByText(
        "Saved locally. 1 device request is ready in Device requests.",
        { exact: true },
      ),
    ).toBeVisible();
    await button("Close dialog").click();
    await expect(
      page.getByRole("cell", { name: text, exact: true }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: /^Device requests/ }).click();
  };
  const grant = async (allowed: boolean) => {
    await button("Close dialog").click();
    await button("Manage local modules").click();
    if (await button("Device access").isVisible())
      await button("Device access").click();
    if ((await consent.isChecked()) !== allowed) await consent.click();
    if (allowed) await expect(consent).toBeChecked();
    else await expect(consent).not.toBeChecked();
    await expect(consent).toBeEnabled();
    await button("Close dialog").click();
    await page.getByRole("button", { name: /^Device requests/ }).click();
  };
  return { id, capture, grant, button };
}

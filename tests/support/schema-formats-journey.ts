import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { publishExecutableFixture } from "./executable-fixture";
import { valid } from "../fixtures/schema-formats/module";
export { valid };
export const formatId = `schema-formats-${crypto.randomUUID().slice(0, 8)}`;
export const formatName = `Formatted records ${formatId.slice(-8)}`;
export const publishFormats = () =>
  publishExecutableFixture({
    id: formatId,
    sourceDirectory: "tests/fixtures/schema-formats",
    transform: (_file, source) =>
      source
        .replaceAll("schema-formats", formatId)
        .replaceAll("Formatted records", formatName),
  });
export async function assignFormats(pool: Pool, workspace: string) {
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspace, formatId],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspace, formatId],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
    [workspace, formatId],
  );
  await pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      workspace,
      [
        `${formatId}.records.read`,
        `${formatId}.records.write`,
        `${formatId}.capture`,
      ],
    ],
  );
}
export async function exerciseFormats(page: Page) {
  const view = page.getByRole("region", {
    name: "Formatted intake",
    exact: true,
  });
  await expect(
    view.getByRole("heading", { name: "Formatted intake" }),
  ).toBeVisible({ timeout: 45000 });
  await view.getByRole("button", { name: "Check fields", exact: true }).click();
  const labels = {
    identifier: "Identifier",
    email: "Email",
    website: "Website",
    date: "Date",
    time: "Time",
    timestamp: "Timestamp",
  };
  for (const [key, label] of Object.entries(labels))
    await view
      .getByLabel(label, { exact: true })
      .fill(valid[key as keyof typeof valid]);
  const save = view.getByRole("button", { name: "Save record", exact: true });
  await expect(save).toBeEnabled();
  for (const [label, bad, good] of [
    ["Email", "reader..office@example.com", valid.email],
    ["Identifier", "bad-uuid", valid.identifier],
    ["Website", "/relative", valid.website],
    ["Timestamp", "2025-02-29T09:30:00Z", valid.timestamp],
    ["Time", "09:30:00", valid.time],
  ]) {
    const input = view.getByLabel(label, { exact: true });
    await input.fill(bad);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
    await input.fill(good);
    await expect(input).toHaveAttribute("aria-invalid", "false");
  }
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(view.getByRole("status")).toHaveText(`Saved ${valid.email}`);
  return view;
}

/** Real installed standalone storage, using the host-generated editor. */
export async function exerciseLocalFormats(
  page: Page,
  offline: () => Promise<void>,
) {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await button("Account menu").click();
  await page
    .getByRole("menuitem", { name: "Local profiles", exact: true })
    .click();
  await page.getByLabel("Profile name", { exact: true }).fill("Local formats");
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("correct horse battery staple");
  await button("Create profile").click();
  await button("Manage local modules").click();
  await button("Browse personal modules").click();
  await button(`Install ${formatName}`).click();
  await button("Save local installation").click();
  await expect(
    page.getByText(`${formatName} is ready in this local profile.`, {
      exact: true,
    }),
  ).toBeVisible();
  await button("Close dialog").click();
  const resource = page.getByRole("combobox", {
    name: "Module and resource",
    exact: true,
  });
  await resource.click();
  await page
    .getByRole("option")
    .and(page.locator(`[data-value="${formatId}/records"]`))
    .click();
  await expect(resource).toHaveAttribute("aria-expanded", "false");
  await offline();
  await button("New record").click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Local record", exact: true }),
  });
  await expect(dialog.getByLabel("Identifier", { exact: true })).toBeVisible();
  for (const [key, label] of Object.entries({
    identifier: "Identifier",
    email: "Email",
    website: "Website",
    date: "Date",
    time: "Time",
    timestamp: "Timestamp",
  }))
    await dialog
      .getByLabel(label, { exact: true })
      .fill(valid[key as keyof typeof valid]);
  const timestamp = dialog.getByLabel("Timestamp", { exact: true });
  await timestamp.fill("2025-02-29T09:30:00Z");
  await button("Save locally").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("/timestamp");
  await expect(dialog.getByRole("alert")).toContainText("date-time");
  await timestamp.fill(valid.timestamp);
  await button("Save locally").click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: valid.email, exact: true }),
  ).toBeVisible();
}

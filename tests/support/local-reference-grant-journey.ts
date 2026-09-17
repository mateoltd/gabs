import { expect, type Page } from "@playwright/test";
import { selectValue } from "../e2e/controls.helpers";
export const grantLabel = "Allow Projects to read Contacts: Contacts";
export async function openReferenceGrants(page: Page) {
  await page
    .getByRole("button", { name: "Manage local modules", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reference access", exact: true })
    .click();
  return page.getByRole("checkbox", { name: grantLabel, exact: true });
}
export async function localReferenceGrantJourney(page: Page, name: string) {
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Local profiles", exact: true })
    .click();
  await page.getByLabel("Profile name", { exact: true }).fill(name);
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("correct horse battery staple");
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await selectValue(page, "Module and resource", "contacts/contacts");
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Local client");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await selectValue(page, "Module and resource", "projects/projects");
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: /Contact/i })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Allow this reference in Local modules",
  );
  // Leave the picker and discard the unsaved editor using keyboard dismissal.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const grant = await openReferenceGrants(page);
  await expect(grant).not.toBeChecked();
  await grant.focus();
  await grant.press("Space");
  await expect(grant).toBeChecked();
  await expect(grant).toBeEnabled();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Lock profile", exact: true }).click();
  await page.getByRole("combobox", { name: "Profile", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("correct horse battery staple");
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await selectValue(page, "Module and resource", "projects/projects");
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Linked local project");
  await selectValue(page, "Status", "planned");
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: /Contact/i })
    .click();
  await page.getByRole("option", { name: "Local client", exact: true }).click();
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Linked local project", exact: true }),
  ).toBeVisible();
  const retained = await openReferenceGrants(page);
  await expect(retained).toBeChecked();
  await retained.click();
  await expect(retained).not.toBeChecked();
  await expect(retained).toBeEnabled();
  return retained;
}

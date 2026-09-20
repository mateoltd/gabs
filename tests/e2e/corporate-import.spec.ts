import { test, expect } from "@playwright/test";
import { selectValue } from "./controls.helpers";
import { corporateImportJourney } from "../support/corporate-import-journey";
test("corporate saved-work import restores reviewed drafts and authoritatively stops uncertain requests", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await selectValue(page, "Local demonstration account", "owner@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  await corporateImportJourney(page, page.request, "web", async () => {
    await page.reload();
    return page;
  });
});

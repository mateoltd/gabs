import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { localReferenceGrantJourney } from "../support/local-reference-grant-journey";
test.use({ actionTimeout: 10000 });
test("local reference consent survives lock and revocation blocks lookup while preserving saved projects", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await localReferenceGrantJourney(page, "Reference consent");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir("docs/verification/local-reference-grants", { recursive: true });
  await page.screenshot({
    path: "docs/verification/local-reference-grants/wide.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/verification/local-reference-grants/narrow.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: /Contact/i })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Allow this reference in Local modules",
  );
  await expect(
    page.getByRole("option", { name: "Local client", exact: true }),
  ).toHaveCount(0);
});

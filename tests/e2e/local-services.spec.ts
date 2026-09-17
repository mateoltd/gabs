import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { localServiceJourney } from "../support/local-service-journey";
test("standalone service consent, encrypted retry and revocation preserve atomic module records", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  await localServiceJourney(page, false);
  expect(
    await page
      .locator(
        '.select-popup[data-closed]:not([aria-hidden="true"]), .select-popup[data-closed]:not([inert])',
      )
      .count(),
  ).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir("docs/verification/local-services", { recursive: true });
  await page.screenshot({ path: "docs/verification/local-services/wide.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/verification/local-services/narrow.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { migrationGrantJourney } from "../support/local-migration-grant-journey";
test("local installation reviews exact-release reference consent and rolls back denied coordinated migrations", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  await migrationGrantJourney(page, false, async () => {
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await mkdir("docs/verification/local-migration-grants", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/verification/local-migration-grants/wide.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "docs/verification/local-migration-grants/narrow.png",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});

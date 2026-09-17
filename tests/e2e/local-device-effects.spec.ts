import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, mkdir } from "node:fs/promises";
import { localDeviceEffectsJourney } from "../support/local-device-effects-journey";

test.use({ actionTimeout: 10000 });
test("offline owners download committed device requests and retry revoked consent without repeating business records", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  const { capture, grant, button } = await localDeviceEffectsJourney(
    page,
    false,
  );
  await context.setOffline(true);
  await capture("Actual browser export");
  let download = page.waitForEvent("download");
  await button("Run device request").click();
  const first = await download;
  expect(first.suggestedFilename()).toBe("notes.txt");
  expect(await readFile((await first.path())!, "utf8")).toBe(
    "Actual browser export",
  );
  await expect(
    page.getByText("Download offered", { exact: true }),
  ).toBeVisible();
  await button("Clear request").click();
  await expect(
    page.getByText("No device requests", { exact: true }),
  ).toBeVisible();
  await button("Close dialog").click();
  await expect(
    page.getByRole("cell", { name: "Actual browser export", exact: true }),
  ).toHaveCount(1);
  await capture("Revoked then recovered");
  await grant(false);
  await button("Run device request").click();
  await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Allow this device capability",
  );
  await grant(true);
  download = page.waitForEvent("download");
  await button("Retry device request").click();
  expect(await readFile((await (await download).path())!, "utf8")).toBe(
    "Revoked then recovered",
  );
  await expect(
    page.getByText("Download offered", { exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir("docs/verification/local-device-effects", { recursive: true });
  await page.screenshot({
    path: "docs/verification/local-device-effects/wide.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/verification/local-device-effects/narrow.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await button("Close dialog").click();
  await expect(
    page.getByRole("cell", { name: "Revoked then recovered", exact: true }),
  ).toHaveCount(1);
});

import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { localDeviceJourney } from "../support/local-device-journey";

test("profile owners review signed device declarations and persist keyboard consent and revocation", async ({
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
  const fixture = await localDeviceJourney(page, false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir("docs/verification/local-device-consent", { recursive: true });
  await page.screenshot({
    path: "docs/verification/local-device-consent/wide.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/verification/local-device-consent/narrow.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Simulate damaged stored package bytes while preserving real vault encryption.
  const helper = await build({
    entryPoints: ["packages/client/src/identity/local-vault.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  await page.route("**/device-vault.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: helper.outputFiles[0].text,
    }),
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Lock profile", exact: true }).click();
  await page.evaluate(async (moduleId) => {
    const path = "/device-vault.mjs";
    const vaults = (await import(
      path
    )) as typeof import("../../packages/client/src/identity/local-vault");
    const profile = (await vaults.listLocalProfiles()).find(
      (p) => p.name === "Device consent",
    )!;
    const { vault, key, data } = await vaults.unlockVault<
      import("../../packages/client/src/identity/local-profiles").LocalData
    >(profile.id, "correct horse battery staple");
    data.modules![moduleId].releases["1.0.0"].package.artifact.description =
      "Damaged artifact";
    await vaults.commitVault(
      vault,
      key,
      data,
      vault.revision ?? 0,
      undefined,
      () => true,
    );
  }, fixture.pkg.module_id);
  await page.getByRole("combobox", { name: "Profile", exact: true }).click();
  await page
    .getByRole("option", { name: "Device consent", exact: true })
    .click();
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("correct horse battery staple");
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Manage local modules", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Device access", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/checksum/i);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: `Revoke ${fixture.pkg.module_id}: export`,
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Device access revoked.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Saved device access" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const path = "/device-vault.mjs";
      const vaults = (await import(
        path
      )) as typeof import("../../packages/client/src/identity/local-vault");
      const profile = (await vaults.listLocalProfiles()).find(
        (p) => p.name === "Device consent",
      )!;
      const { data } = await vaults.unlockVault<
        import("../../packages/client/src/identity/local-profiles").LocalData
      >(profile.id, "correct horse battery staple");
      return data.capabilityGrants;
    }),
  ).toEqual([]);
});

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { selectValue } from "./controls.helpers";
const passphrase = "correct horse battery staple";
const pin = "12567890";
async function create(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Use a local profile", exact: true })
    .click();
  await page.getByLabel("Profile name", { exact: true }).fill("PIN workspace");
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "PIN workspace", exact: true }),
  ).toBeVisible();
}
async function settings(page: Page) {
  await page
    .getByRole("button", { name: "Profile unlock", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Profile unlock",
    exact: true,
  });
  await dialog
    .getByLabel("Current passphrase", { exact: true })
    .fill(passphrase);
  await dialog.getByLabel("New PIN", { exact: true }).fill(pin);
  await dialog.getByLabel("Confirm PIN", { exact: true }).fill(pin);
  return dialog;
}
async function usePin(page: Page) {
  await page
    .getByRole("button", { name: "Use PIN instead", exact: true })
    .click();
  await page.getByLabel("Profile PIN", { exact: true }).fill(pin);
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "PIN workspace", exact: true }),
  ).toBeVisible();
}
test("local PIN survives offline restart, preserves worker records and retains passphrase recovery", async ({
  page,
  context,
}) => {
  await create(page);
  await page.getByRole("button", { name: "New record", exact: true }).click();
  const editor = page.getByRole("dialog", {
    name: "Local record",
    exact: true,
  });
  await editor.getByLabel("Name", { exact: true }).fill("Private PIN contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  await editor
    .getByRole("button", { name: "Save locally", exact: true })
    .click();
  const dialog = await settings(page);
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir("docs/verification/local-profile-unlock", { recursive: true });
  await page.screenshot({
    path: "docs/verification/local-profile-unlock/settings-wide.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "docs/verification/local-profile-unlock/settings-narrow.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Save and lock", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Local profiles", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use PIN instead", exact: true })
    .click();
  await page.getByLabel("Profile PIN", { exact: true }).fill("00000000");
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("PIN was not accepted");
  await page.getByLabel("Profile PIN", { exact: true }).fill(pin);
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Private PIN contact", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Open local profiles", exact: true })
    .click();
  const profile = page.getByRole("combobox", { name: "Profile", exact: true });
  await profile.click();
  await page
    .getByRole("option", { name: "PIN workspace", exact: true })
    .click();
  await usePin(page);
  await expect(
    page.getByRole("cell", { name: "Private PIN contact", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lock profile", exact: true }).click();
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Profile unlock", exact: true })
    .click();
  await page.getByLabel("Current passphrase", { exact: true }).fill(passphrase);
  await page
    .getByRole("button", { name: "Remove quick unlock and lock", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use PIN instead", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Private PIN contact", exact: true }),
  ).toBeVisible();
});

test("saving local PIN locks an already unlocked second tab and cancelled enrollment leaves the profile unchanged", async ({
  page,
  context,
}) => {
  await create(page);
  const second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("button", { name: "Use a local profile", exact: true })
    .click();
  await second.getByRole("combobox", { name: "Profile", exact: true }).click();
  await second
    .getByRole("option", { name: "PIN workspace", exact: true })
    .click();
  await second.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await second
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await expect(
    second.getByRole("heading", { name: "PIN workspace", exact: true }),
  ).toBeVisible();
  let dialog = await settings(page);
  await page.evaluate(() => {
    const state = { entered: false, release: () => {} };
    const held = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    const wrap = crypto.subtle.wrapKey.bind(crypto.subtle);
    crypto.subtle.wrapKey = async (...args: Parameters<typeof wrap>) => {
      state.entered = true;
      await held;
      return wrap(...args);
    };
    (window as unknown as { enrollment: typeof state }).enrollment = state;
  });
  await dialog
    .getByRole("button", { name: "Save and lock", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { enrollment: { entered: boolean } }).enrollment
            .entered,
      ),
    )
    .toBe(true);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.evaluate(() =>
    (
      window as unknown as { enrollment: { release(): void } }
    ).enrollment.release(),
  );
  await expect(
    second.getByRole("heading", { name: "PIN workspace", exact: true }),
  ).toBeVisible();
  dialog = await settings(page);
  await dialog
    .getByRole("button", { name: "Save and lock", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Local profiles", exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("heading", { name: "Local profiles", exact: true }),
  ).toBeVisible();
  await usePin(page);
  await second.close();
});

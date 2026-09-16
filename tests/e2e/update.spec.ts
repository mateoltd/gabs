import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Model a waiting worker so the prompt can be verified without a second build.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const registration = Object.assign(new EventTarget(), {
      active: {},
      installing: null,
      waiting: {
        postMessage: (message: { type: string }) =>
          document.documentElement.setAttribute(
            "data-update-request",
            message.type,
          ),
      },
      update: async () => {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        controller: {},
        ready: Promise.resolve(registration),
        getRegistration: async () => registration,
        register: async () => registration,
      }),
    });
  });
});

test("sign-in keeps a pending update in the footer until explicitly requested", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page
    .locator(".login-footer")
    .getByRole("button", { name: "Update ready", exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.locator(".app-update")).toHaveCount(0);
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Update ready", exact: true });
  await expect(menu).toContainText("Save your changes");
  await expect(page.locator("html")).not.toHaveAttribute("data-update-request");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(menu).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(menu).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/update-signin-narrow.png" });
  await menu
    .getByRole("menuitem", { name: "Reload to update", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-update-request",
    "SKIP_WAITING",
  );
  await expect(
    page.getByRole("menuitem", { name: "Updating…", exact: true }),
  ).toBeDisabled();
});

test("workspace update sits above Settings and opens without shifting content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  const trigger = page
    .getByRole("navigation", { name: "Preferences", exact: true })
    .getByRole("button", { name: "Update ready", exact: true });
  await expect(trigger).toBeVisible();
  const before = await page.locator(".app-main").boundingBox();
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Update ready", exact: true });
  await expect(menu).toBeVisible();
  expect(await page.locator(".app-main").boundingBox()).toEqual(before);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: "test-results/update-sidebar.png" });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.locator("html")).not.toHaveAttribute("data-update-request");
});

import { selectValue } from "./controls.helpers";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const company = "11111111-1111-4111-8111-111111111111";

test("sign-in fills its window, renders the supplied halftone, and remains usable on a small screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in to Common" }),
  ).toBeVisible();
  await expect(
    page.locator('.login-artwork[data-ready="true"] canvas'),
  ).toBeVisible();
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => undefined),
  );
  await expect(
    page.getByRole("button", { name: "Reload to update" }),
  ).toHaveCount(0);
  expect(await page.locator(".login").boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 1440,
    height: 960,
  });
  expect(
    await page
      .locator("body")
      .evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toBe("none");
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Sign-in help" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog").and(page.locator(".dialog")),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Help", exact: true }),
  ).toBeFocused();
  // Measure final text contrast, after the sign-in entrance fades finish.
  await page.locator(".login").evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: "test-results/sign-in-wide.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".login-artwork")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open workspace" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/sign-in-narrow.png" });
});

test("halftone changes its dots without moving the canvas and restores still artwork for reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const canvas = page.locator('.login-artwork[data-ready="true"] canvas');
  await expect(canvas).toBeVisible();
  const still = await canvas.evaluate((element: HTMLCanvasElement) =>
    element.toDataURL(),
  );
  const bounds = await canvas.boundingBox();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(() =>
      canvas.evaluate(
        (element: HTMLCanvasElement, original) =>
          element.toDataURL() !== original,
        still,
      ),
    )
    .toBe(true);
  expect(await canvas.boundingBox()).toEqual(bounds);
  await expect(canvas).toHaveCSS("transform", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      canvas.evaluate(
        (element: HTMLCanvasElement, original) =>
          element.toDataURL() === original,
        still,
      ),
    )
    .toBe(true);
});

test("managed sign-in passes only the email hint and sends account creation to the hosted flow", async ({
  page,
}) => {
  // UI contract check; live Auth0 verification requires a configured tenant.
  await page.route("**/auth/config", (route) =>
    route.fulfill({ json: { mode: "oidc" } }),
  );
  await page.route("**/auth/login*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Hosted sign-in handoff</h1>",
    }),
  );
  await page.goto("/");
  await page.getByLabel("Email address").fill("alex+work@example.com");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    /\/auth\/login\?loginHint=alex%2Bwork%40example.com$/,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/auth\/login\?screenHint=signup$/);
  await page.goto("/");
  await page.getByRole("button", { name: "Use single sign-on" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
});

test("order details keep the list interactive and workspace search opens a product", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await selectValue(page, "Workspace", company);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Open order \d+/ }).first(),
  ).toBeVisible();
  const orders = page.getByRole("button", { name: /Open order \d+/ });
  const first = await orders.nth(0).getAttribute("aria-label");
  const second = await orders.nth(1).getAttribute("aria-label");
  await orders.nth(0).click();
  await expect(
    page.getByRole("complementary", {
      name: first!.replace("Open order ", "Order #"),
    }),
  ).toBeVisible();
  await orders.nth(1).click();
  await expect(
    page.getByRole("complementary", {
      name: second!.replace("Open order ", "Order #"),
    }),
  ).toBeVisible();
  expect(await page.locator(".application").boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 1440,
    height: 960,
  });
  await page
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await page.getByPlaceholder("Search this workspace").fill("Utility tote");
  await page
    .getByRole("dialog")
    .getByRole("link")
    .filter({ hasText: "Utility tote" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Inventory", exact: true }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Search products")).toHaveValue("NL-104");
  await expect(
    page.getByRole("row").filter({ hasText: "Utility tote" }),
  ).toBeVisible();
});

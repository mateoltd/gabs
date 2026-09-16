import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { selectValue } from "./controls.helpers";

test.use({ serviceWorkers: "block" });

const company = "11111111-1111-4111-8111-111111111111";

test("Base UI selects support keyboard selection, dismissal, and mobile layout", async ({
  page,
}) => {
  await page.goto("/");
  const account = page.getByRole("combobox", {
    name: "Local demonstration account",
  });
  await account.press("Space");
  await expect(page.getByRole("option")).toHaveCount(4);
  await expect(page.getByRole("option").first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option").last()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(account).toContainText("Taylor Kim");
  await expect(account).toBeFocused();
  await account.press("Space");
  await expect(page.getByRole("option").last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("option").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(account).toContainText("Alex Morgan");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  await theme.click();
  await expect(page.getByRole("listbox", { name: /Theme/ })).toBeVisible();
  await page.screenshot({ path: "test-results/controls-dark.png" });
  await page.keyboard.press("Escape");
  await expect(theme).toBeFocused();
  await selectValue(page, "Theme", "light");
  await theme.click();
  await expect(
    page.getByRole("option", { name: "Light", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: "test-results/controls-light.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await theme.click();
  await expect(page.locator(".select-popup[data-open]")).toBeVisible();
  const popup = await page.locator(".select-popup[data-open]").boundingBox();
  expect(popup!.x).toBeGreaterThanOrEqual(0);
  expect(popup!.x + popup!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
});

test("form controls work inside dialogs, and tooltips and save toasts are accessible", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByRole("button", { name: "New order", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New order draft" });
  await expect(dialog).toBeVisible();
  await page
    .getByRole("button", { name: "Save to server", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await page
    .getByLabel("Customer", { exact: true })
    .fill("Control verification");
  const product = page.getByRole("combobox", {
    name: "Product 1",
    exact: true,
  });
  await product.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option").first().click();
  await expect(product).toBeFocused();
  await expect(dialog).toBeVisible();
  const quantity = page.getByLabel("Quantity", { exact: true });
  await quantity.fill("3");
  await quantity.press("ArrowUp");
  await expect(quantity).toHaveValue("4");
  const price = page.getByLabel("Unit price (EUR)", { exact: true });
  await price.fill("12.50");
  await price.press("Tab");
  await expect(price).toHaveValue("12.5");
  await product.click();
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(product).toBeFocused();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  const lowStock = page.getByRole("checkbox", { name: /Low stock only/ });
  await lowStock.click();
  await expect(lowStock).toBeChecked();
  await lowStock.press("Space");
  await expect(lowStock).not.toBeChecked();
  const settings = page.getByRole("link", { name: "Settings", exact: true });
  await settings.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("tooltip", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await settings.click();
  await page
    .getByRole("button", { name: "Save workspace policy", exact: true })
    .click();
  const toast = page.getByRole("dialog", { name: "Workspace policy saved." });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/controls-toast.png" });
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await expect(toast).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  await theme.click();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await expect(page.locator(".select-popup[data-open]")).toHaveCSS(
    "transition-duration",
    "0s",
  );
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch workspace", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Northline Supply", exact: true })
    .click();
});

test("breadcrumb navigates and the separate rail menu switches workspaces", async ({
  page,
}) => {
  const breadcrumb = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(
    "Overview",
  );
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(
    "Orders",
  );
  await expect(breadcrumb.locator("[aria-haspopup]")).toHaveCount(0);
  const results = page.locator("#order-results");
  await expect(results).toHaveAttribute("aria-busy", "false");
  await results.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  const workspace = page.locator(".sidebar").getByRole("button", {
    name: "Switch workspace",
    exact: true,
  });
  await workspace.press("Enter");
  const menu = page.getByRole("menu", {
    name: "Switch workspace",
    exact: true,
  });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitemradio", { name: "Northline Supply" }),
  ).toHaveAttribute("aria-checked", "true");
  await menu.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  // Base UI can begin its entrance after mounting, so wait for final contrast.
  await expect(menu).toHaveCSS("opacity", "1");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(breadcrumb).toContainText("Personal workspace");
  await expect(workspace).toBeFocused();
  const account = page.getByRole("button", {
    name: "Account menu",
    exact: true,
  });
  await account.click();
  await page
    .getByRole("menuitem", { name: "New company", exact: true })
    .click();
  const companyDialog = page.getByRole("dialog", {
    name: "Create a company workspace",
  });
  await expect(
    companyDialog.getByRole("textbox", { name: "Company name" }),
  ).toBeFocused();
  await companyDialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(account).toBeFocused();
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(
    "Orders",
  );
  await workspace.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(workspace).toBeFocused();
});

test("mobile rail keeps its menu independent and restores focus after switching", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const openNavigation = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await openNavigation.click();
  const drawer = page.getByRole("dialog", {
    name: "Workspace navigation",
    exact: true,
  });
  const switcher = drawer.getByRole("button", {
    name: "Switch workspace",
    exact: true,
  });
  await expect(switcher).toBeFocused();
  await switcher.press("Enter");
  const menu = page.getByRole("menu", {
    name: "Switch workspace",
    exact: true,
  });
  await expect(menu).toBeVisible();
  await menu.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(switcher).toBeFocused();
  await switcher.press("Enter");
  await menu
    .getByRole("menuitemradio", { name: "Personal workspace", exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  await expect(openNavigation).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Workspace navigation" }),
  ).toContainText("Personal workspace");
});

test("search supports keyboard navigation, result links, clearing, and focus restoration", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "Search workspace",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Search workspace" });
  const input = dialog.getByPlaceholder("Search this workspace");
  await expect(input).toBeFocused();
  await input.press("ArrowDown");
  await expect(
    dialog.getByRole("link", { name: "Overview", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await trigger.click();
  await input.fill("Utility tote");
  await expect(
    dialog.getByRole("link").filter({ hasText: "Utility tote" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Clear search this workspace" })
    .click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(dialog.getByRole("region", { name: "Products" })).toHaveCount(0);
  await expect(
    new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze()
      .then((result) => result.violations),
  ).resolves.toEqual([]);
  await input.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("order editor keeps nested pickers in the dialog and updates totals", async ({
  page,
}, testInfo) => {
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  const trigger = page.getByRole("button", { name: "New order", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "New order draft" });
  const product = dialog.getByRole("combobox", {
    name: "Product 1",
    exact: true,
  });
  await product.click();
  await expect(product).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(product).toBeFocused();
  await product.click();
  await page.getByRole("option", { name: /Utility tote/ }).click();
  await dialog
    .getByRole("textbox", { name: "Quantity", exact: true })
    .fill("2");
  await page.keyboard.press("Tab");
  await expect(dialog.locator(".editor-total")).toContainText("€68.00");
  await dialog.getByRole("button", { name: "Add line", exact: true }).click();
  await expect(
    dialog.getByRole("combobox", { name: "Product 2", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Remove line 2" }).click();
  await expect(
    dialog.getByRole("combobox", { name: "Product 2", exact: true }),
  ).toHaveCount(0);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(
    dialog.getByRole("button", { name: "Save to server" }),
  ).toBeVisible();
  await dialog.screenshot({
    path: testInfo.outputPath("redesigned-order-mobile.png"),
  });
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(trigger).toBeFocused();
});

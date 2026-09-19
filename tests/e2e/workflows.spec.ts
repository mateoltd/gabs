import { selectValue } from "./controls.helpers";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const company = "11111111-1111-4111-8111-111111111111";
async function login(page: Page, email = "owner@demo.local") {
  await page.goto("/");
  await selectValue(page, "Local demonstration account", email);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByLabel("Switch workspace", { exact: true }),
  ).toBeVisible();
  await selectValue(page, "Workspace", company);
  await expect(
    page.getByRole("link", { name: "Inventory", exact: true }),
  ).toBeVisible();
}
test("receive stock, save an order, reserve and fulfill through the UI", async ({
  page,
}) => {
  const suffix = Date.now().toString(),
    product = `Test stock ${suffix}`,
    customer = `Browser customer ${suffix}`;
  await login(page);
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByLabel("Product name", { exact: true }).fill(product);
  await page.getByLabel("SKU", { exact: true }).fill(`E2E-${suffix}`);
  await page.getByLabel("Unit price (EUR)", { exact: true }).fill("12.50");
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add a product" })).toHaveCount(
    0,
  );
  await page.getByPlaceholder("Search products").fill(product);
  await page
    .getByRole("button", { name: `Change stock for ${product}`, exact: true })
    .click();
  await page.getByLabel("Units received").fill("5");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Browser acceptance receipt");
  await page
    .getByRole("button", { name: "Save stock change", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").and(page.locator(".dialog")),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await page.getByLabel("Customer", { exact: true }).fill(customer);
  await page
    .getByRole("searchbox", { name: "Search by name or SKU" })
    .fill(product);
  await page.getByRole("combobox", { name: "Product 1", exact: true }).click();
  await page
    .getByRole("option", { name: `${product} (5 available)`, exact: true })
    .click();
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Save to server", exact: true })
    .click();
  await expect(
    page.getByText("Saved to server", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm and reserve stock", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mark fulfilled", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mark fulfilled", exact: true })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: /Order #/ })
      .getByText("Fulfilled", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close order details" }).click();
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByPlaceholder("Search products").fill(product);
  const row = page.getByRole("row").filter({ hasText: product });
  await expect(row).toContainText("3");
  await page.screenshot({ path: "test-results/inventory.png", fullPage: true });
});
test("offline shell, explicit local draft recovery, reconnect and retained sign-out data", async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "New order", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await page
    .getByLabel("Customer", { exact: true })
    .fill("Offline recovery example");
  await page.getByRole("combobox", { name: "Product 1", exact: true }).click();
  await page.getByRole("option").first().click();
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(
    page.getByText("Saved on this device", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /On this device \(1\)/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /On this device \(1\)/ }).click();
  await expect(
    page.getByText("Offline recovery example", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open draft", exact: true }).click();
  await expect(page.getByLabel("Customer", { exact: true })).toHaveValue(
    "Offline recovery example",
  );
  await expect(
    page.getByRole("button", { name: "Save to server", exact: true }),
  ).toHaveCount(0);
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "Save to server", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save to server", exact: true })
    .click();
  await expect(
    page.getByText("Saved to server", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm and reserve stock" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close order details" }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Connect to open your workspace")).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "Open workspace", exact: true }),
  ).toBeVisible();
  const count = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("suite-offline-v1", 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise<number>((res, rej) => {
      const r = db.transaction("records").objectStore("records").count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  });
  expect(count).toBeGreaterThan(0);
});
test("viewer permissions, accessible navigation, themes and narrow layout", async ({
  page,
}) => {
  // Capture settled layouts; route motion has separate acceptance coverage.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, "viewer@demo.local");
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New order", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "People & access" })).toHaveCount(
    0,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await selectValue(page, "Theme", "dark");
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Inventory", exact: true }),
  ).toBeVisible();
  await page.getByPlaceholder("Search products or SKU").fill("Field notebook");
  await expect(page.getByText("Field notebook", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/inventory-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  const wide = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        cls: e.className,
        right: e.getBoundingClientRect().right,
      }))
      .slice(0, 25),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    JSON.stringify(wide),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  // Seed records can move beyond the first page as browser fixtures accumulate.
  await page
    .getByRole("searchbox", { name: "Search customers" })
    .fill("Form & Field");
  await expect(page.getByText("Form & Field", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        cls: e.className,
        right: e.getBoundingClientRect().right,
      }))
      .slice(0, 25),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    JSON.stringify(overflow),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/orders-narrow.png",
    fullPage: true,
  });
});
test("workspace switching does not show a previous workspace response", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(`**/workspaces/${company}/orders*`, async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page
    .getByRole("button", { name: "Switch workspace", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Personal workspace", exact: true })
    .click();
  release();
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No orders yet", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Form & Field", { exact: true })).toHaveCount(0);
});
test("storage failure reports an error instead of claiming a local save", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await page
    .getByLabel("Customer", { exact: true })
    .fill("Unsaved quota example");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (String(key).endsWith("/drafts"))
        throw new DOMException("Device storage is full", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").and(page.locator(".dialog")).getByRole("alert"),
  ).toContainText("Device storage is full");
  await expect(page.getByLabel("Customer", { exact: true })).toHaveValue(
    "Unsaved quota example",
  );
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toHaveCount(0);
});

test("overview actions, keyboard filters, dialog focus and responsive visual system", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await selectValue(page, "Theme", "light");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".metric")).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("body")).toHaveCSS(
    "font-family",
    /-apple-system|Inter Variable/,
  );
  await page.screenshot({
    path: "test-results/overview-light.png",
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: /^Ready to fulfill/ }).click();
  await page.getByRole("link", { name: "View queue", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Confirmed", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("tbody tr").first()).toContainText("Confirmed");
  await page
    .getByRole("tab", { name: "Confirmed", exact: true })
    .press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "Draft", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Draft", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("tbody tr").first()).toContainText("Draft");
  await page.screenshot({
    path: "test-results/orders-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await expect(
    page.getByRole("dialog").and(page.locator(".dialog")),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").and(page.locator(".dialog")),
  ).toHaveClass(/is-open/);
  await expect(page.getByRole("dialog").and(page.locator(".dialog"))).toHaveCSS(
    "opacity",
    "1",
  );
  await page.screenshot({ path: "test-results/order-dialog.png" });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Close dialog", exact: true })
    .press("Escape");
  await expect(
    page.getByRole("dialog").and(page.locator(".dialog")),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New order", exact: true }),
  ).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "New order", exact: true }).click();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.getByRole("dialog").and(page.locator(".dialog")),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("link", { name: /^Low-stock products/ }).click();
  await expect(
    page.getByRole("checkbox", { name: /Low stock only/ }),
  ).toBeChecked();
  await expect(page.locator("tbody tr").first()).toContainText(
    /Low stock|Out of stock/,
  );
  await page.screenshot({
    path: "test-results/inventory-light.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("tab", { name: /^Ready to fulfill/ }).click();
  await page
    .getByRole("link", { name: /^Open order \d+ for Atelier Nord$/ })
    .click();
  await expect(
    page.getByRole("complementary", { name: /Order #/ }),
  ).toContainText("Atelier Nord");
  await page
    .getByRole("button", { name: "Close order details", exact: true })
    .click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("link", { name: "New order", exact: true }).click();
  await expect(
    page.getByRole("dialog").and(page.locator(".dialog")),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Modules", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/modules-light.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "People & access", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("Alex Morgan", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/people-light.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Roles", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ has: page.getByText("Owner", { exact: true }) })
    .getByRole("button", { name: "View permissions" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "View orders", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "View orders", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await selectValue(page, "Theme", "dark");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/overview-dark.png",
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: "test-results/overview-narrow.png",
    fullPage: true,
  });
});

import { test, expect } from "@playwright/test";
import { selectValue } from "./controls.helpers";

const company = "11111111-1111-4111-8111-111111111111";

test("overview charts show exact counts, zero-height days, and proportional stock", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/workspaces/*/overview", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (data.orders) {
      data.orders.fulfilledDaily = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-09-${String(i + 9).padStart(2, "0")}`,
        count: i,
      }));
    }
    if (data.inventory) {
      Object.assign(data.inventory, {
        products: 25,
        lowStock: 20,
        available: 433,
      });
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  await expect(
    page.getByRole("region", { name: "Order activity", exact: true }),
  ).toContainText("21");
  await expect(
    page.getByRole("img", { name: "Sep 9: 0 fulfilled orders", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "20 of 25 active products have 10 or fewer available units. 5 have more than 10.",
      exact: true,
    }),
  ).toBeVisible();
  const heights = await page
    .locator(".activity-bar")
    .evaluateAll((bars) =>
      bars.map((bar) => bar.getBoundingClientRect().height),
    );
  expect(heights[0]).toBe(0);
  expect(heights[6]).toBeGreaterThan(0);
  expect(heights[3] / heights[6]).toBeCloseTo(0.5, 2);
  const distribution = await page
    .locator(".stock-waffle-cell i")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getBoundingClientRect().height),
    );
  expect(distribution.filter((height) => height > 0)).toHaveLength(20);
  expect(distribution.filter((height) => height === 0)).toHaveLength(5);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await page
        .locator(".content")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page
        .locator(".overview-insights")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1800, height: 960 });
  const [overviewWidth, routeWidth] = await Promise.all([
    page
      .locator(".overview-page")
      .evaluate((element) => element.getBoundingClientRect().width),
    page
      .locator(".route-stage")
      .evaluate((element) => element.getBoundingClientRect().width),
  ]);
  expect(overviewWidth).toBeCloseTo(routeWidth, 0);
});

test("empty and unavailable modules keep the overview truthful", async ({
  page,
}) => {
  let ordersVisible = true;
  let productCount = 0;
  await page.route("**/api/v1/workspaces/*/overview", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.orders = ordersVisible
      ? {
          draft: 0,
          confirmed: 0,
          fulfilled: 0,
          cancelled: 0,
          ready: [],
          recent: [],
          fulfilledDaily: Array.from({ length: 7 }, (_, i) => ({
            date: `2026-09-${String(i + 9).padStart(2, "0")}`,
            count: 0,
          })),
        }
      : null;
    data.inventory = {
      products: productCount,
      available: productCount * 20,
      lowStock: 0,
      lowStockItems: [],
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  await expect(
    page.getByRole("heading", { name: "No activity yet", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Order activity", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Stock health", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Recent orders", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Open inventory", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Inventory", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("link", { name: "New order", exact: true }).click();
  await expect(
    page.getByRole("dialog").and(page.locator(".dialog")),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: "test-results/overview-start.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator(".content")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "test-results/overview-start-narrow.png" });
  ordersVisible = false;
  await page.reload();
  await expect(
    page.getByRole("link", { name: "New order", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open inventory", exact: true }),
  ).toBeVisible();
  productCount = 5;
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Stock health", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Order activity", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Recent orders", exact: true }),
  ).toHaveCount(0);
});

test("the entire recent order row opens its details", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  const row = page
    .getByRole("tabpanel", { name: "Recent orders", exact: true })
    .getByRole("row")
    .nth(1);
  const label = await row.getByRole("link").getAttribute("aria-label");
  const number = label!.match(/Open order (\d+)/)![1];
  const amount = (await row.getByRole("cell").last().boundingBox())!;
  await page.mouse.move(
    amount.x + amount.width / 2,
    amount.y + amount.height / 2,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: "test-results/overview-rounded-row.png" });
  await page.mouse.click(
    amount.x + amount.width / 2,
    amount.y + amount.height / 2,
  );
  await expect(
    page.getByRole("complementary", { name: `Order #${number}`, exact: true }),
  ).toBeVisible();
});

test("overview summary and keyboard tabs switch the same order table", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  const firstRecent = await page
    .getByRole("tabpanel", { name: "Recent orders", exact: true })
    .getByRole("row")
    .nth(1)
    .getByRole("link")
    .getAttribute("aria-label");
  await page.getByRole("button", { name: /^Ready to fulfill/ }).click();
  const ready = page.getByRole("tab", { name: /^Ready to fulfill/ });
  await expect(ready).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", {
    name: "Ready to fulfill",
    exact: true,
  });
  await expect(
    panel.getByRole("link", { name: /^Open order 1004/ }),
  ).toBeVisible();
  await expect(panel.getByRole("row").nth(1)).toContainText("Confirmed");
  await ready.press("ArrowRight");
  const recent = page.getByRole("tab", { name: /^Recent orders/ });
  await expect(recent).toBeFocused();
  await expect(recent).toHaveAttribute("aria-selected", "true");
  await expect(
    page
      .getByRole("tabpanel", { name: "Recent orders", exact: true })
      .getByRole("row")
      .nth(1)
      .getByRole("link"),
  ).toHaveAttribute("aria-label", firstRecent!);
});

test("stock visualization preserves proportions when counts do not divide into 25 squares", async ({
  page,
}) => {
  await page.route("**/api/v1/workspaces/*/overview", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.inventory = {
      ...data.inventory,
      products: 27,
      lowStock: 19,
      available: 450,
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  await expect(
    page.getByRole("img", {
      name: "19 of 27 active products have 10 or fewer available units. 8 have more than 10.",
      exact: true,
    }),
  ).toBeVisible();
  const share = await page.locator(".stock-waffle").evaluate((chart) => {
    const cells = [...chart.querySelectorAll(".stock-waffle-cell")];
    return (
      cells.reduce(
        (sum, cell) =>
          sum + cell.querySelector("i")!.getBoundingClientRect().height,
        0,
      ) /
      cells.reduce((sum, cell) => sum + cell.getBoundingClientRect().height, 0)
    );
  });
  expect(share).toBeCloseTo(19 / 27, 2);
});

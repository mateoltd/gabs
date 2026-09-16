import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { selectValue } from "./controls.helpers";

const company = "11111111-1111-4111-8111-111111111111";
async function fixture(page: Page, viewer = false) {
  const orders = ["draft", "draft", "confirmed", "fulfilled"].map(
    (status, i) => ({
      id: `a1111111-1111-4111-8111-11111111111${i}`,
      number: 9001 + i,
      customerName: [
        "Atelier North",
        "Studio Fern",
        "Morrow Supply",
        "Juniper House",
      ][i],
      status,
      version: 1,
      totalMinor: 12500,
      createdAt: "2026-09-15T10:00:00Z",
      updatedAt: "2026-09-15T10:00:00Z",
      lines: [],
      activity: [],
    }),
  );
  const requests: {
    id: string;
    key: string;
    version: string;
    action: string;
  }[] = [];
  let failSecond = true;
  await page.route("**/api/v1/workspaces/*/overview", (route) =>
    route.fulfill({
      json: {
        inventory: null,
        orders: {
          draft: 2,
          confirmed: 1,
          fulfilled: 1,
          cancelled: 0,
          ready: [],
          recent: [],
          fulfilledDaily: [0, 4, 2, 8, 6, 0, 2].map((count, i) => ({
            date: `2026-09-${String(i + 9).padStart(2, "0")}`,
            count,
          })),
        },
      },
    }),
  );
  await page.route("**/api/v1/workspaces/*/orders**", async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/orders")[1].split("/").filter(Boolean);
    if (route.request().method() === "GET") {
      if (parts.length)
        return route.fulfill({
          json: orders.find((order) => order.id === parts[0]),
        });
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search")?.toLowerCase();
      const items = orders.filter(
        (order) =>
          (!status || order.status === status) &&
          (!search || order.customerName.toLowerCase().includes(search)),
      );
      return route.fulfill({
        json: {
          items,
          nextCursor: url.searchParams.has("cursor") ? null : "page-two",
        },
      });
    }
    return route.continue();
  });
  await page.route(
    "**/api/v1/module/orders/workspaces/*/operations/*",
    async (route) => {
      const input = route.request().postDataJSON() as {
        id: string;
        version: number;
      };
      const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
      const order = orders.find((order) => order.id === input.id)!;
      requests.push({
        id: order.id,
        key: route.request().headers()["idempotency-key"],
        version: JSON.stringify(String(input.version)),
        action,
      });
      if (order.number === 9002 && failSecond) {
        failSecond = false;
        return route.fulfill({
          status: 503,
          json: {
            code: "UNAVAILABLE",
            message: "Temporarily unavailable. Try again.",
          },
        });
      }
      order.status =
        action === "confirm"
          ? "confirmed"
          : action === "fulfill"
            ? "fulfilled"
            : "cancelled";
      order.version++;
      return route.fulfill({ json: order });
    },
  );
  await page.goto("/");
  if (viewer)
    await selectValue(page, "Local demonstration account", "viewer@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open order 9001", exact: true }),
  ).toBeVisible();
  return { orders, requests };
}

test("bulk review excludes ineligible orders and preserves request identity after a partial failure", async ({
  page,
}) => {
  const { orders, requests } = await fixture(page);
  await page
    .getByRole("checkbox", { name: "Select order 9001", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Select all orders on this page" }),
  ).toHaveAttribute("aria-checked", "mixed");
  await page
    .getByRole("checkbox", { name: "Select all orders on this page" })
    .check();
  expect(
    await page
      .locator('.orders-table tr[data-selected="true"] td')
      .evaluateAll((cells) =>
        cells.every((cell) => {
          const style = getComputedStyle(cell);
          return [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ].every((width) => width === "0px");
        }),
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Confirm orders (2)", exact: true })
    .click();
  const review = page.getByRole("dialog", { name: "Confirm selected orders" });
  await expect(review).toContainText(
    "2 selected orders are ineligible and will be skipped.",
  );
  expect(requests).toHaveLength(0);
  await review
    .getByRole("button", { name: "Confirm 2 orders", exact: true })
    .click();
  const results = page.getByRole("dialog", { name: "Bulk action results" });
  await expect(results).toContainText("1 of 2 orders updated.");
  await expect(results).toContainText("Temporarily unavailable");
  await results.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Select order 9001", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Select order 9002", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Confirm orders (1)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm 1 order", exact: true })
    .click();
  await expect(results).toContainText("1 of 1 orders updated.");
  expect(requests).toHaveLength(3);
  expect(requests[1].key).toBeTruthy();
  expect(requests[2]).toEqual(requests[1]);
  expect(requests[0].version).toBe('"1"');
  expect(orders.map((order) => order.status)).toEqual([
    "confirmed",
    "confirmed",
    "confirmed",
    "fulfilled",
  ]);
  await results.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Select all orders on this page" })
    .check();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Fulfill orders (3)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fulfill 3 orders", exact: true })
    .click();
  await expect(results).toContainText("3 of 3 orders updated.");
  expect(orders.every((order) => order.status === "fulfilled")).toBe(true);
});

test("selection is separate from the inspector, scoped to the page, and keyboard accessible", async ({
  page,
  context,
}) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("checkbox", { name: "Select order 9001", exact: true })
    .press("Space");
  await page
    .getByRole("button", { name: "Open order 9003", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Select order 9001", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Close order details", exact: true })
    .click();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Selected order actions" }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Select order 9001", exact: true })
    .check();
  await page.getByRole("tab", { name: "Draft", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Selected order actions" }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Select order 9001", exact: true })
    .check();
  await page.getByPlaceholder("Search customers").fill("Studio");
  await expect(
    page.getByRole("region", { name: "Selected order actions" }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Select order 9002", exact: true })
    .check();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await context.setOffline(true);
  await expect(
    page.getByRole("region", { name: "Selected order actions" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Actions", exact: true }),
  ).toHaveCount(0);
});

test("workload links filter orders, daily bars preserve exact proportions, and layouts fit", async ({
  page,
}) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const bars = await page
    .locator(".orders-activity-bar")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  expect(bars[0]).toBe(0);
  expect(bars[1] / bars[3]).toBeCloseTo(0.5, 2);
  await expect(
    page.getByRole("heading", { name: "Fulfillment activity 22 in 7 days" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Awaiting fulfillment 1", exact: true })
    .click();
  await expect(page).toHaveURL(/status=confirmed/);
  await expect(page.locator(".orders-table tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "2 drafts to review", exact: true })
    .click();
  await expect(page).toHaveURL(/status=draft/);
  await page
    .getByRole("checkbox", { name: "Select order 9001", exact: true })
    .check();
  for (const width of [1440, 1100, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await page
        .locator(".content")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/gabs-orders-redesign-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "light"),
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: "/tmp/gabs-orders-redesign-light.png" });
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Cancel orders (1)", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "This cannot be undone.",
  );
  await page
    .getByRole("button", { name: "Cancel 1 order", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Bulk action results" }),
  ).toContainText("1 of 1 orders updated.");
});

test("read-only users have no selection or bulk mutation controls", async ({
  page,
}) => {
  await fixture(page, true);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Actions", exact: true }),
  ).toHaveCount(0);
});

test("bulk confirmation and fulfillment update real orders and stock", async ({
  page,
}) => {
  const suffix = Date.now().toString();
  const product = `Bulk test stock ${suffix}`;
  const customer = `Bulk verification ${suffix}`;
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByLabel("Product name", { exact: true }).fill(product);
  await page.getByLabel("SKU", { exact: true }).fill(`BULK-${suffix}`);
  await page.getByLabel("Unit price (EUR)", { exact: true }).fill("10.00");
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add a product" })).toHaveCount(
    0,
  );
  await page.getByPlaceholder("Search products").fill(product);
  await page
    .getByRole("button", { name: `Change stock for ${product}`, exact: true })
    .click();
  await page.getByLabel("Units received").fill("4");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Bulk workflow acceptance receipt");
  await page
    .getByRole("button", { name: "Save stock change", exact: true })
    .click();
  await expect(page.locator(".dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  for (const name of ["North", "South"]) {
    await page.getByRole("button", { name: "New order", exact: true }).click();
    await page
      .getByLabel("Customer", { exact: true })
      .fill(`${customer} ${name}`);
    await page
      .getByRole("searchbox", { name: "Search by name or SKU" })
      .fill(product);
    await page
      .getByRole("combobox", { name: "Product 1", exact: true })
      .click();
    await page
      .getByRole("option", { name: `${product} (4 available)`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save to server", exact: true })
      .click();
    await expect(page.locator(".order-editor-dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Close order details", exact: true })
      .click();
  }
  await page.getByPlaceholder("Search customers").fill(customer);
  await expect(page.locator(".orders-table tbody tr")).toHaveCount(2);
  for (const action of ["Confirm", "Fulfill"]) {
    await page
      .getByRole("checkbox", { name: "Select all orders on this page" })
      .check();
    await page.getByRole("button", { name: "Actions", exact: true }).click();
    await page
      .getByRole("menuitem", { name: `${action} orders (2)`, exact: true })
      .click();
    await page
      .getByRole("button", { name: `${action} 2 orders`, exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Bulk action results" }),
    ).toContainText("2 of 2 orders updated.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }
  await page.reload();
  await page.getByPlaceholder("Search customers").fill(customer);
  await expect(page.locator(".orders-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".orders-table .status-fulfilled")).toHaveCount(2);
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByPlaceholder("Search products").fill(product);
  const row = page.getByRole("row").filter({ hasText: product });
  await expect(row).toBeVisible();
  // Both reservations were consumed exactly once, leaving two of the four units.
  await expect(row.getByRole("cell").nth(1)).toHaveText("2");
  await expect(row.getByRole("cell").nth(2)).toHaveText("0");
  await expect(row.getByRole("cell").nth(3)).toHaveText("2");
});

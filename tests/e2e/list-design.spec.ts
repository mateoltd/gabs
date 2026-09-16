import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { selectValue } from "./controls.helpers";
const company = "11111111-1111-4111-8111-111111111111";
const evidence = "docs/verification/people-inventory";
async function login(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", company);
  await page.emulateMedia({ reducedMotion: "reduce" });
}
async function borderless(page: Page) {
  await expect(page.locator("tbody td").first()).toBeVisible();
  await expect
    .poll(() =>
      page.locator("tbody td").evaluateAll(
        (cells) =>
          cells.length > 0 &&
          cells.every((cell) => {
            const style = getComputedStyle(cell);
            return [
              style.borderBottomWidth,
              style.borderTopWidth,
              style.borderLeftWidth,
              style.borderRightWidth,
            ].every((width) => width === "0px");
          }),
      ),
    )
    .toBe(true);
  expect(await page.locator("table:not(.list-table)").count()).toBe(0);
}

test("people search, protected roles, member editing, and invitation form retain their behavior", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /of .* seats used/ }),
  ).toBeVisible();
  await page.getByPlaceholder("Search members").fill("warehouse@");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Manage Jamie Chen", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Manage Jamie Chen" });
  await expect(
    dialog.getByRole("checkbox", { name: "Warehouse", exact: true }),
  ).toBeChecked();
  let saved: unknown;
  await page.route("**/api/v1/workspaces/*/members/*", async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: {} });
  });
  await dialog
    .getByRole("button", { name: "Save access", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toMatchObject({
    active: true,
    modules: expect.arrayContaining(["inventory", "orders"]),
  });
  await page.getByPlaceholder("Search members").fill("no-such-teammate");
  await expect(
    page.getByRole("heading", { name: "No matching members" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Roles", exact: true }).click();
  await page.getByPlaceholder("Search roles").fill("Owner");
  await page
    .getByRole("button", { name: "View permissions", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "View orders", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "View orders", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save role", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/role-permissions.png` });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: "View invitations", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Invitations", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Invite a member", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Invite a teammate" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Invite a member", exact: true }),
  ).toBeFocused();
});

test("list pages share geometry, accessible themes, and bounded scrolling", async ({
  page,
}) => {
  await login(page);
  for (const destination of [
    "People & access",
    "Inventory",
    "Audit history",
    "Orders",
  ]) {
    await page.getByRole("link", { name: destination, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: destination, level: 1, exact: true }),
    ).toBeVisible();
    await borderless(page);
    const name =
      destination === "People & access"
        ? "people"
        : destination === "Audit history"
          ? "audit"
          : destination.toLowerCase();
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await page.setViewportSize({ width: 1440, height: 960 });
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({ path: `${evidence}/${name}-${theme}.png` });
    }
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page
          .locator(".content")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  }
});

test("inventory stock summary filters the workspace and preserves stock and history actions", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Workspace stock summary" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View low-stock products" }).click();
  await expect(page).toHaveURL(/stock=low/);
  await expect(
    page.getByRole("checkbox", { name: "Low stock only" }),
  ).toBeChecked();
  await expect(page.locator(".inventory-table tbody tr").first()).toBeVisible();
  const stockRows = await page
    .locator(".inventory-table tbody tr")
    .allTextContents();
  expect(
    stockRows.every(
      (row) => row.includes("Low stock") || row.includes("Out of stock"),
    ),
  ).toBe(true);
  await page.getByRole("checkbox", { name: "Low stock only" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Low stock only" }),
  ).not.toBeChecked();
  await page.getByPlaceholder("Search products or SKU").fill("NL-104");
  await expect(page.locator(".inventory-table tbody tr")).toHaveCount(1);
  await expect(page.getByText("Utility tote", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Change stock for Utility tote", exact: true })
    .click();
  await expect(page.getByLabel("Units received")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("tab", { name: "Movement history", exact: true })
    .click();
  await borderless(page);
  await expect(
    page.getByRole("table", { name: "Stock movements" }),
  ).toBeVisible();
  await page.screenshot({ path: `${evidence}/inventory-history.png` });
});

test("audit pagination, outcomes, full identifiers, and empty states are truthful", async ({
  page,
}) => {
  const target = "aaaabbbb-1111-2222-3333-444455556666";
  let reads = 0;
  await page.route("**/api/v1/workspaces/*/audit**", async (route) => {
    reads++;
    await route.fulfill({
      json: new URL(route.request().url()).searchParams.has("cursor")
        ? { items: [], nextCursor: null }
        : {
            items: [
              {
                id: "1",
                actorName: "Alex Morgan",
                action: "orders.fulfilled",
                targetId: target,
                outcome: "success",
                createdAt: "2026-09-16T00:20:00Z",
              },
              {
                id: "2",
                actorName: "Taylor Kim",
                action: "modules.install",
                targetId: "inventory",
                outcome: "denied",
                createdAt: "2026-09-16T00:18:00Z",
              },
            ],
            nextCursor: "next",
          },
    });
  });
  await login(page);
  await page.getByRole("link", { name: "Audit history", exact: true }).click();
  await expect(page.getByText(target, { exact: true })).toBeVisible();
  await expect(page.getByText("Succeeded", { exact: true })).toBeVisible();
  await expect(page.getByText("Denied", { exact: true })).toBeVisible();
  await borderless(page);
  const before = reads;
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No more activity" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByText(target, { exact: true })).toBeVisible();
});

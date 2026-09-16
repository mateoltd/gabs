import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("a company created in the interface starts directly on scoped business defaults", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "New company", exact: true })
    .click();
  const name = `Current defaults ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "Company name", exact: true })
    .fill(name);
  const created = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && r.url().endsWith("/api/v1/workspaces"),
  );
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  const response = await created;
  expect(response.status(), await response.text()).toBe(200);
  const workspace = (await response.json()).id as string;
  await expect(
    page.getByRole("dialog", { name: "Create a company workspace" }),
  ).toHaveCount(0);
  const state = await page.request.get(
    `/api/v1/workspaces/${workspace}/platform`,
  );
  expect(state.status()).toBe(200);
  expect((await state.json()).storage).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        module_id: "inventory",
        schema_version: 2,
        release_version: "2.0.0",
      }),
      expect.objectContaining({
        module_id: "orders",
        schema_version: 2,
        release_version: "2.0.0",
      }),
    ]),
  );
  const sent: { module: string; version: string }[] = [];
  page.on("request", (r) => {
    if (r.url().includes(`/workspaces/${workspace}/operations/`))
      sent.push({
        module: r.url().split("/module/")[1].split("/")[0],
        version: r.headers()["x-module-version"],
      });
  });
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Upgrade business modules", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page
    .getByLabel("Product name", { exact: true })
    .fill("Default SDK stock");
  await page.getByLabel("SKU", { exact: true }).fill("DEFAULT-SDK");
  await page.getByLabel("Unit price (EUR)", { exact: true }).fill("2.50");
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add a product" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", {
      name: "Change stock for Default SDK stock",
      exact: true,
    })
    .click();
  await page.getByLabel("Units received", { exact: true }).fill("5");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Current defaults acceptance");
  await page
    .getByRole("button", { name: "Save stock change", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Update stock" })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await page
    .getByLabel("Customer", { exact: true })
    .fill("Default SDK customer");
  await page
    .getByRole("button", { name: "Save to server", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and reserve stock", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mark fulfilled", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "Default SDK customer" }),
  ).toContainText("Fulfilled");
  expect(sent.filter((r) => r.module === "orders")).toHaveLength(3);
  expect(sent.filter((r) => r.module === "inventory")).toHaveLength(2);
  expect(new Set(sent.map((r) => r.version))).toEqual(new Set(["2.0.0"]));
  await mkdir("docs/verification/business-defaults", { recursive: true });
  await page.mouse.move(0, 0);
  await expect(
    page.getByRole("button", { name: "Dismiss notification", exact: true }),
  ).toHaveCount(0, { timeout: 20000 });
  await expect(
    page
      .getByRole("complementary", { name: /Order #/ })
      .getByText("Fulfilled", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/verification/business-defaults/web.png",
    fullPage: true,
  });
});

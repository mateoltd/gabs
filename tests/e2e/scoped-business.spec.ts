import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createModuleClient, type ModuleCall } from "@suite/module-sdk";
import { moduleServers } from "@suite/module-catalog/server";
import {
  connectDatabase,
  inWorkspace,
  provisionWorkspace,
  authorize,
  type Actor,
} from "../../packages/server-core/src";
import { migrateLegacyBusinessStorage } from "../../packages/server-core/src/legacy-business-migration";
import { scopedBusinessFixture } from "../fixtures/scoped-business";
import legacyInventory from "../../modules/inventory/module";
import legacyOrders from "../../modules/orders/module";
import { selectValue } from "./controls.helpers";

test("migrated business screens use their verified release for stock, orders, conflicts and offline drafts", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const release = await scopedBusinessFixture(),
    workspace = randomUUID(),
    db = connectDatabase();
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const actor: Actor = { ...me.user, emailVerified: true, mfa: true };
    const headers = {
      origin: "http://localhost:4300",
      "x-csrf-token": me.csrfToken,
    };
    await inWorkspace(db, workspace, (tx) =>
      provisionWorkspace(tx, {
        id: workspace,
        userId: actor.id,
        name: "Scoped business acceptance",
        kind: "company",
        modules: ["inventory", "orders"],
      }),
    );
    const send = async (call: ModuleCall) => {
      const response = await page.request.post(
        `/api/v1/module/${call.moduleId}/workspaces/${workspace}/${call.kind === "query" ? "queries" : "operations"}/${call.operation}`,
        {
          headers: {
            ...headers,
            "x-module-version": call.moduleVersion!,
            ...(call.key ? { "idempotency-key": call.key } : {}),
          },
          data: call.input,
        },
      );
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    };
    const legacyStock = createModuleClient(legacyInventory, send);
    const p = await legacyStock.call("create-product", {
      sku: "RETAINED",
      name: "Retained stock",
      priceMinor: 200,
    });
    await legacyStock.call("stock", {
      id: p.id,
      kind: "receipt",
      quantity: 20,
      reason: "Before cutover",
    });
    const oldOrders = createModuleClient(legacyOrders, send);
    const original = await oldOrders.call("draft", {
      customerName: "Before cutover",
      lines: [{ productId: p.id, quantity: 2, priceMinor: 200 }],
    });
    await inWorkspace(db, workspace, async (tx) => {
      const role = await tx
        .selectFrom("suite.roles")
        .selectAll()
        .where("workspace_id", "=", workspace)
        .where("name", "=", "Owner")
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("suite.roles")
        .set({
          permissions: [
            ...new Set([
              ...role.permissions,
              ...release.inventory.permissions,
              ...release.orders.permissions,
            ]),
          ],
        })
        .where("id", "=", role.id)
        .execute();
      await tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: workspace,
          key: "grant:orders:inventory",
          value: {
            services: ["resolve-products", "reserve", "release", "consume"],
          },
          version: 1,
        })
        .execute();
      const ctx = await authorize(
        tx,
        actor,
        workspace,
        randomUUID(),
        "modules.manage",
      );
      await migrateLegacyBusinessStorage(
        tx,
        ctx,
        { inventory: release.version, orders: release.version },
        moduleServers,
      );
    });
    const sentVersions: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(`/workspaces/${workspace}/operations/`))
        sentVersions.push(request.headers()["x-module-version"]);
    });
    await page.reload();
    await selectValue(page, "Workspace", workspace);
    await page.getByRole("link", { name: "Inventory", exact: true }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "Retained stock" }),
    ).toContainText("20");
    await page
      .getByRole("button", {
        name: "Change stock for Retained stock",
        exact: true,
      })
      .click();
    await page.getByLabel("Units received").fill("5");
    await page.getByLabel("Reason", { exact: true }).fill("After SDK cutover");
    await page
      .getByRole("button", { name: "Save stock change", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Update stock" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("row").filter({ hasText: "Retained stock" }),
    ).toContainText("25");
    await page
      .getByRole("button", { name: "Edit Retained stock", exact: true })
      .click();
    await page.getByLabel("Unit price (EUR)", { exact: true }).fill("2.50");
    await page
      .getByRole("button", { name: "Save product", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Edit product" }),
    ).toHaveCount(0);
    for (const change of [
      {
        type: "adjustment",
        field: "Change in units",
        quantity: "-1",
        expected: "24",
      },
      {
        type: "count",
        field: "Units physically counted",
        quantity: "23",
        expected: "23",
      },
    ]) {
      await page
        .getByRole("button", {
          name: "Change stock for Retained stock",
          exact: true,
        })
        .click();
      await selectValue(page, "Movement type", change.type);
      await page
        .getByLabel(change.field, { exact: true })
        .fill(change.quantity);
      await page
        .getByLabel("Reason", { exact: true })
        .fill(`SDK ${change.type}`);
      await page
        .getByRole("button", { name: "Save stock change", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Update stock" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("row").filter({ hasText: "Retained stock" }),
      ).toContainText(change.expected);
    }
    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ hasText: "Before cutover" })
      .getByRole("button", { name: `#${original.number}`, exact: true })
      .click();
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
    await page.getByRole("button", { name: "New order", exact: true }).click();
    await page.getByLabel("Customer", { exact: true }).fill("After cutover");
    await page
      .getByRole("button", { name: "Save to server", exact: true })
      .click();
    await expect(
      page.getByText("Saved to server", { exact: true }),
    ).toBeVisible();
    const orders = createModuleClient(release.orders, send);
    const saved = (await orders.call("list", { search: "After cutover" }))
      .items[0];
    await page.getByRole("button", { name: "Edit draft", exact: true }).click();
    await orders.call("edit", {
      id: saved.id,
      version: saved.version,
      customerName: "Concurrent server change",
      lines: [{ productId: p.id, quantity: 1, priceMinor: 200 }],
    });
    await page
      .getByLabel("Customer", { exact: true })
      .fill("Reviewed local change");
    await page
      .getByRole("button", { name: "Save to server", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Keep my changes for review" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Keep my changes for review" })
      .click();
    await page
      .getByRole("button", { name: "Save to server", exact: true })
      .click();
    await expect(
      page.getByText("Saved to server", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close order details" }).click();
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
    await context.setOffline(true);
    await page.getByRole("button", { name: "New order", exact: true }).click();
    await page
      .getByLabel("Customer", { exact: true })
      .fill("Scoped offline draft");
    await page
      .getByRole("button", { name: "Save on this device", exact: true })
      .click();
    await expect(
      page.getByText("Scoped offline draft", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /On this device \(1\)/ }).click();
    await expect(
      page.getByText("Scoped offline draft", { exact: true }),
    ).toBeVisible();
    await context.setOffline(false);
    await page
      .getByRole("button", { name: /Open.*draft|Review.*draft/ })
      .first()
      .click();
    const attempts: { key: string; version: string }[] = [];
    await page.route(
      `**/api/v1/module/orders/workspaces/${workspace}/operations/draft`,
      async (route) => {
        attempts.push({
          key: route.request().headers()["idempotency-key"],
          version: route.request().headers()["x-module-version"],
        });
        if (attempts.length === 1) {
          const accepted = await route.fetch();
          expect(accepted.status()).toBe(200);
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await page
      .getByRole("button", { name: "Save to server", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry upload", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /On this device \(1\)/ }).click();
    await page.getByRole("button", { name: "Open draft", exact: true }).click();
    await page
      .getByRole("button", { name: "Retry upload", exact: true })
      .click();
    await expect(
      page.getByText("Saved to server", { exact: true }),
    ).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0].version).toBe(release.version);
    expect(
      (await orders.call("list", { search: "Scoped offline draft" })).items,
    ).toHaveLength(1);
    expect(sentVersions.length).toBeGreaterThanOrEqual(5);
    expect(new Set(sentVersions)).toEqual(new Set([release.version]));
    await inWorkspace(db, workspace, async (tx) => {
      const source = await tx
        .selectFrom("suite.stock")
        .select("on_hand")
        .where("workspace_id", "=", workspace)
        .where("product_id", "=", p.id)
        .executeTakeFirstOrThrow();
      expect(source.on_hand).toBe(20);
      const old = await tx
        .selectFrom("suite.orders")
        .select("status")
        .where("workspace_id", "=", workspace)
        .where("id", "=", original.id)
        .executeTakeFirstOrThrow();
      expect(old.status).toBe("draft");
    });
    await mkdir("docs/verification/business-screens", { recursive: true });
    await page.getByRole("tab", { name: "All orders", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Confirm and reserve stock",
        exact: true,
      }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({
      path: "docs/verification/business-screens/orders.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("dialog", { name: /Order #/ })).toBeVisible();
    expect(
      await page
        .locator("body")
        .evaluate((body) => body.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/business-screens/orders-narrow.png",
      fullPage: true,
    });
  } finally {
    await context.setOffline(false);
    await db.destroy();
  }
});

import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

test("hidden desktop uses installed scoped business contracts through bounded IPC", async () => {
  test.setTimeout(90000);
  const release = await scopedBusinessFixture(),
    workspace = randomUUID(),
    db = connectDatabase();
  const profile = await mkdtemp(resolve(tmpdir(), "scoped-business-desktop-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("apps/desktop/dist/main.cjs"), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUITE_DESKTOP_DEV_AUTH: "1",
    },
  });
  try {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 960),
    );
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = (await page.evaluate(
      async () =>
        (await window.suiteDesktop!.execute({ operation: "me" })).body,
    )) as { user: Actor };
    const actor = { ...me.user, emailVerified: true, mfa: true };
    await inWorkspace(db, workspace, async (tx) => {
      await provisionWorkspace(tx, {
        id: workspace,
        userId: actor.id,
        name: "Native scoped business",
        kind: "company",
        modules: ["inventory", "orders"],
      });
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
      await migrateLegacyBusinessStorage(
        tx,
        await authorize(tx, actor, workspace, randomUUID(), "modules.manage"),
        { orders: release.version, inventory: release.version },
        moduleServers,
      );
    });
    await page.reload();
    await selectValue(page, "Workspace", workspace);
    await page.getByRole("link", { name: "Inventory", exact: true }).click();
    await page
      .getByRole("button", { name: "Add product", exact: true })
      .click();
    await page
      .getByLabel("Product name", { exact: true })
      .fill("Native scoped stock");
    await page.getByLabel("SKU", { exact: true }).fill("NATIVE-SCOPED");
    await page.getByLabel("Unit price (EUR)", { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "Save product", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Add a product" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Change stock for Native scoped stock",
        exact: true,
      })
      .click();
    await page.getByLabel("Units received").fill("10");
    await page.getByLabel("Reason", { exact: true }).fill("Native acceptance");
    await page
      .getByRole("button", { name: "Save stock change", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Update stock" }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await page.getByRole("button", { name: "New order", exact: true }).click();
    await page
      .getByLabel("Customer", { exact: true })
      .fill("Native scoped customer");
    await page
      .getByRole("button", { name: "Save to server", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Confirm and reserve stock",
        exact: true,
      }),
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
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (window) => window.isMinimized() && !window.isFocused(),
          ),
        ),
      )
      .toBe(true);
    const report = await inWorkspace(db, workspace, (tx) =>
      tx
        .selectFrom("suite.module_records")
        .select("data")
        .where("workspace_id", "=", workspace)
        .where("module_id", "=", "inventory")
        .where("resource", "=", "$products")
        .executeTakeFirstOrThrow(),
    );
    expect(report.data).toMatchObject({ onHand: 9, reserved: 0 });
    await expect(
      page.getByRole("row").filter({ hasText: "Native scoped customer" }),
    ).toContainText("Fulfilled");
    await mkdir("docs/verification/business-screens", { recursive: true });
    await page.screenshot({
      path: "docs/verification/business-screens/desktop.png",
      fullPage: true,
    });
  } finally {
    await app.close();
    await db.destroy();
    await rm(profile, { recursive: true, force: true });
  }
});

import { provisionWorkspace as provisionCurrentWorkspace } from "../../composition/src/server/product";
import inventoryDefault from "../../modules/inventory/module";
import ordersDefault from "../../modules/orders/module";
import { provisionLegacyWorkspace as provisionWorkspace } from "../fixtures/legacy-workspace";
import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  connectDatabase,
  inWorkspace,
  type Actor,
} from "../../composition/src/server/product";
import { scopedBusinessFixture } from "../fixtures/scoped-business";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

for (const mode of ["upgrade", "default"] as const)
  test(`hidden desktop uses ${mode} scoped business contracts through bounded IPC`, async () => {
    test.setTimeout(90000);
    const release =
        mode === "upgrade"
          ? await scopedBusinessFixture()
          : {
              version: inventoryDefault.version,
              inventory: inventoryDefault,
              orders: ordersDefault,
            },
      workspace = randomUUID(),
      db = connectDatabase();
    const profile = await mkdtemp(
      resolve(tmpdir(), "scoped-business-desktop-"),
    );
    const app = await electron.launch({
      executablePath: require("electron"),
      args: [
        resolve("apps/desktop/dist/main.cjs"),
        `--user-data-dir=${profile}`,
      ],
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
        await (
          mode === "upgrade" ? provisionWorkspace : provisionCurrentWorkspace
        )(tx, {
          id: workspace,
          userId: actor.id,
          name: "Native scoped business",
          kind: "company",
          modules: ["inventory", "orders"],
        });
      });
      await page.reload();
      await selectValue(page, "Workspace", workspace);
      if (mode === "upgrade") {
        await page.getByRole("link", { name: "Modules", exact: true }).click();
        await page
          .getByRole("button", {
            name: "Upgrade business modules",
            exact: true,
          })
          .click();
        await selectValue(page, "Inventory upgrade release", release.version);
        await selectValue(page, "Orders upgrade release", release.version);
        await page
          .getByRole("checkbox", {
            name: "Owner: inventory.reservations.write",
            exact: true,
          })
          .check();
        await page
          .getByRole("checkbox", {
            name: "Grant Orders access to Inventory services",
            exact: true,
          })
          .check();
        await page
          .getByRole("button", { name: "Review upgrade", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Ready to upgrade" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Apply reviewed upgrade", exact: true })
          .click();
        await expect(
          page.getByText(
            "Orders and Inventory have completed their coordinated upgrade.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          page
            .locator(".module-release-meta")
            .filter({ hasText: `Version ${release.version}` }),
        ).toHaveCount(2);
        await mkdir("docs/verification/business-cutover", { recursive: true });
        await page.screenshot({
          path: "docs/verification/business-cutover/desktop.png",
        });
        await page.getByRole("button", { name: "Done", exact: true }).click();
      }
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
      await page
        .getByLabel("Reason", { exact: true })
        .fill("Native acceptance");
      await page
        .getByRole("button", { name: "Save stock change", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Update stock" }),
      ).toHaveCount(0);
      await page.getByRole("link", { name: "Orders", exact: true }).click();
      await page
        .getByRole("button", { name: "New order", exact: true })
        .click();
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
      await mkdir(
        mode === "upgrade"
          ? "docs/verification/business-screens"
          : "docs/verification/business-defaults",
        { recursive: true },
      );
      await page.screenshot({
        path:
          mode === "upgrade"
            ? "docs/verification/business-screens/desktop.png"
            : "docs/verification/business-defaults/desktop.png",
        fullPage: true,
      });
    } finally {
      await app.close();
      await db.destroy();
      await rm(profile, { recursive: true, force: true });
    }
  });

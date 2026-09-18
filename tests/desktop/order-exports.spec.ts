import "dotenv/config";
import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  connectDatabase,
  inWorkspace,
} from "../../composition/src/server/product";
import { runBatch } from "../../apps/worker/src/worker";
import { exportPermission } from "../support/host-capability-journey";
const require = createRequire(resolve("apps/desktop/package.json"));
interface DialogState {
  path: string;
  hold: boolean;
  waiting: boolean;
  finished: number;
  release(): void;
}
for (const version of ["2.0.0", "2.1.0"] as const)
  test(`hidden Orders ${version} rejects post-dialog revocation, stale views and generic CSV writes`, async () => {
    test.setTimeout(120000);
    const profile = await mkdtemp(resolve(tmpdir(), "suite-order-exports-"));
    const workspace = randomUUID();
    const pool = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const worker = connectDatabase(
      process.env.DATABASE_URL!.replace("suite_app:", "suite_worker:"),
    );
    let app: ElectronApplication | undefined;
    try {
      app = await electron.launch({
        executablePath: require("electron"),
        args: [
          resolve("apps/desktop/dist/main.cjs"),
          `--user-data-dir=${profile}`,
        ],
        env: {
          ...process.env,
          NODE_ENV: "development",
          SUITE_DESKTOP_DEV_AUTH: "1",
          SUITE_DESKTOP_TEST_MINIMIZED: "1",
        },
      });
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Open local workspace", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Switch workspace", exact: true }),
      ).toBeVisible();
      const setup = await page.evaluate(
        async ({ workspace, version }) => {
          const created = await window.suiteDesktop!.execute({
            operation: "workspaceCreate",
            body: {
              id: workspace,
              name: `Orders ${version} acceptance`,
              currency: "EUR",
            },
          });
          if (created.status !== 200 || version === "2.1.0") return created;
          return window.suiteDesktop!.execute({
            operation: "platformCommand",
            idempotencyKey: crypto.randomUUID(),
            params: { workspaceId: workspace },
            body: {
              action: "pin",
              value: { moduleId: "orders", version, mandatory: true },
              version: 0,
            },
          });
        },
        { workspace, version },
      );
      expect(setup.status, JSON.stringify(setup.body)).toBe(200);
      await page.reload();
      await page
        .getByRole("button", { name: "Switch workspace", exact: true })
        .click();
      await page
        .getByRole("menuitemradio")
        .and(page.locator(`[data-value="${workspace}"]`))
        .click();
      await page.getByRole("link", { name: "Orders", exact: true }).click();
      const created = await page.evaluate(
        (workspaceId) =>
          window.suiteDesktop!.execute({
            operation: "exportCreate",
            params: { workspaceId },
            body: {},
            idempotencyKey: crypto.randomUUID(),
          }),
        workspace,
      );
      expect(created.status).toBe(200);
      const { id } = created.body as { id: string };
      await inWorkspace(worker, workspace, (tx) =>
        tx
          .updateTable("suite.outbox")
          .set({ created_at: new Date(0) })
          .where("workspace_id", "=", workspace)
          .where("event_type", "=", "export.orders")
          .where("completed_at", "is", null)
          .execute(),
      );
      await runBatch(worker);
      await page
        .getByRole("button", { name: "Export orders", exact: true })
        .click();
      const modal = page.getByRole("dialog", {
        name: "Export orders",
        exact: true,
      });
      const download = modal
        .getByRole("button", { name: "Download export", exact: true })
        .first();
      await expect(download).toBeVisible();
      const target = resolve(profile, "accepted.csv");
      await app.evaluate(({ dialog }, path) => {
        const state = {
          path,
          hold: false,
          waiting: false,
          finished: 0,
          release: () => {},
        };
        Object.assign(globalThis, { orderExport: state });
        dialog.showSaveDialog = async () => {
          state.waiting = true;
          if (state.hold)
            await new Promise<void>((resolve) => {
              state.release = resolve;
            });
          state.waiting = false;
          state.finished++;
          return { canceled: false, filePath: state.path };
        };
      }, target);
      const audits = async () =>
        Number(
          (
            await pool.query(
              "select count(*) n from suite.audit where workspace_id=$1 and target_id=$2 and action='orders.export_downloaded'",
              [workspace, id],
            )
          ).rows[0].n,
        );
      const before = await audits();
      await download.click();
      await expect
        .poll(async () => {
          try {
            return await readFile(target, "utf8");
          } catch {
            return "";
          }
        })
        .toMatch(/^Order,Customer,Status,Total in minor units\r\n/);
      expect(await audits()).toBe(before + 1);
      const denied = resolve(profile, "denied.csv");
      await app.evaluate((_, path) => {
        const s = (globalThis as unknown as { orderExport: DialogState })
          .orderExport;
        s.path = path;
        s.hold = true;
      }, denied);
      await download.click();
      await expect
        .poll(() =>
          app!.evaluate(
            () =>
              (globalThis as unknown as { orderExport: DialogState })
                .orderExport.waiting,
          ),
        )
        .toBe(true);
      await exportPermission(pool, workspace, "orders", false);
      await app.evaluate(() =>
        (
          globalThis as unknown as { orderExport: DialogState }
        ).orderExport.release(),
      );
      await expect(modal.getByRole("alert")).toHaveText(
        version === "2.0.0"
          ? "Your role does not allow this action."
          : "Your current permissions do not allow this host action.",
      );
      expect(
        (
          await new AxeBuilder({ page })
            .setLegacyMode()
            .include('[role="dialog"]')
            .analyze()
        ).violations,
      ).toEqual([]);
      await expect(access(denied)).rejects.toThrow();
      expect(await audits()).toBe(before + (version === "2.0.0" ? 1 : 2));
      await mkdir("docs/verification/orders-capability-release", {
        recursive: true,
      });
      await page.screenshot({
        path: `docs/verification/orders-capability-release/native-${version}.png`,
      });
      await exportPermission(pool, workspace, "orders", true);
      await page.reload();
      await page
        .getByRole("button", { name: "Export orders", exact: true })
        .click();
      const abandoned = resolve(profile, "abandoned.csv");
      await app.evaluate((_, path) => {
        (
          globalThis as unknown as { orderExport: DialogState }
        ).orderExport.path = path;
      }, abandoned);
      await download.click();
      await expect
        .poll(() =>
          app!.evaluate(
            () =>
              (globalThis as unknown as { orderExport: DialogState })
                .orderExport.waiting,
          ),
        )
        .toBe(true);
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "Overview", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Export orders", exact: true }),
      ).toHaveCount(0);
      await app.evaluate(() =>
        (
          globalThis as unknown as { orderExport: DialogState }
        ).orderExport.release(),
      );
      await expect
        .poll(() =>
          app!.evaluate(
            () =>
              (globalThis as unknown as { orderExport: DialogState })
                .orderExport.finished,
          ),
        )
        .toBe(3);
      await expect(access(abandoned)).rejects.toThrow();
      expect(await audits()).toBe(before + (version === "2.0.0" ? 1 : 3));
      expect(
        await page.evaluate(async () => {
          try {
            await window.suiteDesktop!.saveFile(
              "orders-11111111-1111-4111-8111-111111111111.csv",
              "Renderer data",
            );
            return false;
          } catch {
            return true;
          }
        }),
      ).toBe(true);
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
          ),
        ),
      ).toBe(true);
    } finally {
      await exportPermission(pool, workspace, "orders", true);
      await app?.close();
      await pool.end();
      await worker.destroy();
      await rm(profile, { recursive: true, force: true });
    }
  });

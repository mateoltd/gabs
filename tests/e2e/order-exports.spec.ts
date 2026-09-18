import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { exportPermission } from "../support/host-capability-journey";
import { test, expect } from "@playwright/test";
import {
  connectDatabase,
  inWorkspace,
} from "../../composition/src/server/product";
import { runBatch } from "../../apps/worker/src/worker";
import { selectValue } from "./controls.helpers";

for (const version of ["2.0.0", "2.1.0"] as const)
  test(`Orders ${version} exports use current authority and the selected release`, async ({
    page,
  }) => {
    const workspace = randomUUID();
    const pool = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const worker = connectDatabase(
      process.env.DATABASE_URL!.replace("suite_app:", "suite_worker:"),
    );
    try {
      await page.goto("/");
      await page
        .getByRole("button", { name: "Open workspace", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Switch workspace", exact: true }),
      ).toBeVisible();
      const me = await (await page.request.get("/api/v1/me")).json();
      const headers = {
        origin: new URL(page.url()).origin,
        "x-csrf-token": me.csrfToken,
      };
      const createdWorkspace = await page.request.post("/api/v1/workspaces", {
        headers,
        data: {
          id: workspace,
          name: `Orders ${version} acceptance`,
          currency: "EUR",
        },
      });
      expect(createdWorkspace.ok(), await createdWorkspace.text()).toBe(true);
      if (version === "2.0.0") {
        const pin = await page.request.post(
          `/api/v1/workspaces/${workspace}/platform`,
          {
            headers: { ...headers, "idempotency-key": randomUUID() },
            data: {
              action: "pin",
              value: { moduleId: "orders", version, mandatory: true },
              version: 0,
            },
          },
        );
        expect(pin.ok(), await pin.text()).toBe(true);
      }
      await page.reload();
      await selectValue(page, "Workspace", workspace);
      await page.getByRole("link", { name: "Orders", exact: true }).click();
      await page
        .getByRole("button", { name: "Export orders", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Export orders",
        exact: true,
      });
      const response = page.waitForResponse(
        (res) =>
          res.url().endsWith(`/workspaces/${workspace}/exports`) &&
          res.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Create CSV export" }).click();
      const created = await response;
      expect(created.status()).toBe(200);
      const { id } = await created.json();
      await expect(dialog.locator(".list-row").first()).toContainText(
        "Pending",
      );
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
      await expect(dialog.locator(".list-row").first()).toContainText("Ready", {
        timeout: 15000,
      });
      const authorityPath =
        version === "2.1.0"
          ? `/api/v1/module/orders/workspaces/${workspace}/capabilities/authorize`
          : `/api/v1/workspaces/${workspace}/exports/${id}/authorize`;
      const authority = page.waitForResponse((res) =>
        res.url().endsWith(authorityPath),
      );
      const downloaded = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "Download export" })
        .first()
        .click();
      const file = await downloaded;
      const accepted = await authority;
      expect(accepted.status()).toBe(200);
      if (version === "2.1.0") {
        expect(accepted.request().headers()["x-module-version"]).toBe(version);
        expect(accepted.request().postDataJSON()).toEqual({
          capability: "export",
        });
        expect(await accepted.json()).toMatchObject({
          moduleId: "orders",
          moduleVersion: version,
          capability: "export",
          kind: "files.export",
        });
      }
      expect(file.suggestedFilename()).toBe(`orders-${id}.csv`);
      const content = await readFile((await file.path())!, "utf8");
      expect(content).toMatch(
        /^Order,Customer,Status,Total in minor units\r\n/,
      );
      expect(content.split("\r\n").length).toBeGreaterThan(1);
      const metadataUrl = new URL(
        `/api/v1/workspaces/${workspace}/exports/${id}/authorize`,
        page.url(),
      ).href;
      const metadata = await page.request.get(metadataUrl);
      expect(metadata.status()).toBe(200);
      expect(await metadata.json()).toEqual({ filename: `orders-${id}.csv` });
      const extraDownloads: string[] = [];
      page.on("download", (item) =>
        extraDownloads.push(item.suggestedFilename()),
      );
      await page.route(`**${authorityPath}`, async (route) => {
        await exportPermission(pool, workspace, "orders", false);
        await route.continue();
      });
      await dialog
        .getByRole("button", { name: "Download export" })
        .first()
        .click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      expect(extraDownloads).toEqual([]);
      await mkdir("docs/verification/orders-capability-release", {
        recursive: true,
      });
      await page.screenshot({
        path: `docs/verification/orders-capability-release/web-${version}.png`,
      });
    } finally {
      await exportPermission(pool, workspace, "orders", true);
      await pool.end();
      await worker.destroy();
    }
  });

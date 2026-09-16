import "dotenv/config";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { connectDatabase, inWorkspace } from "../../packages/server-core/src";
import { runBatch } from "../../apps/worker/src/worker";
import { selectValue } from "./controls.helpers";

test("orders exports run in the background and download through the existing interface", async ({
  page,
}) => {
  const workspace = "11111111-1111-4111-8111-111111111111";
  const worker = connectDatabase(
    process.env.DATABASE_URL!.replace("suite_app:", "suite_worker:"),
  );
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
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
    await expect(dialog.locator(".list-row").first()).toContainText("Pending");
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
    const downloaded = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download export" })
      .first()
      .click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe(`orders-${id}.csv`);
    const content = await readFile((await file.path())!, "utf8");
    expect(content).toMatch(/^Order,Customer,Status,Total in minor units\r\n/);
    expect(content.split("\r\n").length).toBeGreaterThan(1);
  } finally {
    await worker.destroy();
  }
});

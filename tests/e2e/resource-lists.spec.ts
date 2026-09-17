import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import {
  publishResourceListFixture,
  assignResourceListFixture,
  resourceListId,
  resourceListData,
  exerciseResourceList,
} from "../support/resource-list-journey";
test("generated resource filters and paging work through the authoritative API and offline cache", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await publishResourceListFixture();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspaceId = randomUUID();
    const headers = {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    };
    const created = await page.request.post("/api/v1/workspaces", {
      headers,
      data: {
        id: workspaceId,
        name: "Generated list acceptance",
        currency: "EUR",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    await assignResourceListFixture(pool, workspaceId);
    for (const input of resourceListData) {
      const saved = await page.request.post(
        `/api/v1/module/${resourceListId}/workspaces/${workspaceId}/records`,
        {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: { resource: "records", action: "create", input },
        },
      );
      expect(saved.ok(), await saved.text()).toBeTruthy();
    }
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Resource lists", exact: true })
      .click();
    const { content, records, status } = await exerciseResourceList(page);
    expect(
      (
        await new AxeBuilder({ page })
          .include("#module-resource-content")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/resource-lists", { recursive: true });
    await page.screenshot({
      path: "docs/verification/resource-lists/web-wide.png",
    });
    await context.setOffline(true);
    await expect(content.getByText(/Offline copy/)).toBeVisible();
    await expect(records.getByText("Office 01", { exact: true })).toBeVisible();
    await content
      .getByRole("textbox", { name: "Search", exact: true })
      .fill("Undownloaded filter");
    await expect(
      content.getByText(
        "No matching records have been downloaded on this device.",
      ),
    ).toBeVisible();
    await content
      .getByRole("textbox", { name: "Search", exact: true })
      .fill("Office 01");
    await expect(status).toHaveText("Page 1. 1 record.");
    // Rebuild an already-downloaded AND filter in the opposite order.
    await content
      .getByRole("textbox", { name: "Search", exact: true })
      .fill("");
    await content.getByRole("button", { name: /^Filters/ }).click();
    await selectValue(page, "Filter by", "choice");
    await selectValue(page, "Choice", "choice:1");
    await content.getByRole("button", { name: "Apply filter" }).click();
    await content.getByRole("button", { name: /^Filters/ }).click();
    await selectValue(page, "Filter by", "approved");
    await content.getByRole("button", { name: "Apply filter" }).click();
    await expect(status).toHaveText("Page 1. 4 records.");
    await content.getByRole("button", { name: "Clear filters" }).click();
    await content
      .getByRole("textbox", { name: "Search", exact: true })
      .fill("Office 01");
    await expect(status).toHaveText("Page 1. 1 record.");
    await context.setOffline(false);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(content.getByText(/Offline copy/)).toHaveCount(0);
    await content.getByRole("button", { name: /^Filters/ }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/resource-lists/web-narrow.png",
      fullPage: true,
    });
    await content
      .getByRole("button", { name: "Apply filter", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/resource-lists/web-narrow-filter-actions.png",
    });
    await content.getByRole("button", { name: "Cancel", exact: true }).click();
    await content
      .getByRole("combobox", { name: "Records per page", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/resource-lists/web-narrow-pagination.png",
    });
  } finally {
    await context.setOffline(false);
    await pool.end();
  }
});

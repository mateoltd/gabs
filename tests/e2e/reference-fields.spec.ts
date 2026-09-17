import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import {
  publishReferenceFixture,
  assignReferenceFixture,
  referenceModuleId,
  referenceTargets,
  exerciseReferencePicker,
} from "../support/reference-journey";
test("nested reference choices search beyond the first page and preserve selections offline", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await publishReferenceFixture();
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
    await assignReferenceFixture(pool, workspaceId);
    for (const input of referenceTargets) {
      const saved = await page.request.post(
        `/api/v1/module/${referenceModuleId}/workspaces/${workspaceId}/records`,
        {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: { resource: "targets", action: "create", input },
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
      .getByRole("link", { name: "Reference forms", exact: true })
      .click();
    const { dialog, picker } = await exerciseReferencePicker(page);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/reference-fields", { recursive: true });
    await page.screenshot({
      path: "docs/verification/reference-fields/web-picker.png",
    });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const recordRow = page.getByRole("row").filter({
      has: page.getByRole("cell", {
        name: "Nested reference acceptance",
        exact: true,
      }),
    });
    await expect(recordRow).toContainText("Target 105");
    for (const details of await recordRow.locator("details").all())
      await details.locator(":scope > summary").click();
    await mkdir("docs/verification/table-labels", { recursive: true });
    await page.screenshot({
      path: "docs/verification/table-labels/generated.png",
    });
    await page.getByRole("button", { name: /^Filters/ }).click();
    await selectValue(page, "Filter by", "links");
    const filter = page.getByRole("form", { name: "Filter records" });
    await filter.getByRole("button", { name: "Add links item" }).click();
    await filter.locator(".reference-picker summary").click();
    await filter
      .getByRole("textbox", { name: "Search contact choices" })
      .fill("Target 105");
    await expect(filter.getByRole("status")).toHaveText("1 choice on page 1.");
    await filter
      .getByRole("combobox", { name: "Contact", exact: true })
      .click();
    await page.getByRole("option", { name: "Target 105", exact: true }).click();
    await filter.getByRole("button", { name: "Apply filter" }).click();
    await expect(recordRow).toBeVisible();
    await recordRow.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(
      dialog.getByRole("combobox", { name: "Contact", exact: true }),
    ).toContainText("Target 105");
    const saved = await page.request.post(
      `/api/v1/module/${referenceModuleId}/workspaces/${workspaceId}/records`,
      {
        headers,
        data: { resource: "records", action: "list", input: {} },
      },
    );
    expect(saved.ok()).toBe(true);
    expect((await saved.json()).items[0].data.links).toEqual([
      { contactId: referenceTargets[104].id },
    ]);
    await context.setOffline(true);
    await picker.locator("summary").click();
    await picker.getByRole("textbox").fill("Target 105");
    await expect(picker.getByRole("status")).toContainText("downloaded choice");
    await expect(picker.getByRole("combobox")).toContainText("Target 105");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "docs/verification/reference-fields/web-offline-narrow.png",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await context.setOffline(false);
    let interrupted = false;
    await page.route("**/references/records?**", (route) => {
      if (
        !interrupted &&
        new URL(route.request().url()).searchParams.get("search") ===
          "Retry target"
      ) {
        interrupted = true;
        return route.abort();
      }
      return route.continue();
    });
    await picker.getByRole("textbox").fill("Retry target");
    await expect(
      picker.getByRole("button", { name: "Retry choices" }),
    ).toBeVisible();
    await picker.getByRole("button", { name: "Retry choices" }).click();
    await expect(picker.getByRole("status")).toHaveText("0 choices on page 1.");
    await expect(picker.getByRole("combobox")).toContainText("Target 105");
    // A connected authorization rejection removes retained labels for this target.
    await page.unroute("**/references/records?**");
    await page.route("**/references/records?**", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          code: "GRANT_REQUIRED",
          message: "Reference grant revoked",
        }),
      }),
    );
    await picker.getByRole("textbox").fill("Revoked lookup");
    await expect(picker.getByRole("alert")).toContainText(
      "Reference grant revoked",
    );
    await context.setOffline(true);
    await picker.getByRole("textbox").fill("Target 105");
    await expect(
      picker.getByText(
        "This value's label is not downloaded. Your saved selection is retained.",
      ),
    ).toBeVisible();
    await expect(picker.getByRole("combobox")).toContainText(
      referenceTargets[104].id,
    );
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(recordRow).toContainText("Label not downloaded");
    await expect(recordRow).not.toContainText("Target 105");
  } finally {
    await pool.end();
  }
});

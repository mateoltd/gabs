import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { selectValue } from "./controls.helpers";
import {
  publishClientReferenceFixture,
  assignClientReferenceFixture,
  clientReferenceId,
  clientReferenceName,
  clientReferenceRows,
} from "../support/reference-client-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";

test("custom reference downloads survive restart and clearing labels preserves pending work", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const artifact = await publishClientReferenceFixture();
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await selectValue(page, "Local demonstration account", "owner@demo.local");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspace = crypto.randomUUID();
    const headers = {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
    };
    const created = await page.request.post("/api/v1/workspaces", {
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      data: {
        id: workspace,
        name: "Reference cache acceptance",
        currency: "EUR",
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    await assignClientReferenceFixture(pool, workspace);
    for (const input of clientReferenceRows.slice(0, 3)) {
      const response = await page.request.post(
        `/api/v1/module/${clientReferenceId}/workspaces/${workspace}/records`,
        {
          headers: {
            ...headers,
            "idempotency-key": crypto.randomUUID(),
            "x-module-version": artifact.version,
          },
          data: { resource: "targets", action: "create", input },
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
    }
    const contact = await page.request.post(
      `/api/v1/module/contacts/workspaces/${workspace}/records`,
      {
        headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        data: {
          resource: "contacts",
          action: "create",
          input: {
            data: {
              name: "Pending contact",
              kind: "person",
              relationship: "customer",
              phone: "111",
            },
          },
        },
      },
    );
    expect(contact.ok(), await contact.text()).toBe(true);
    const stored = () =>
      page.evaluate(async (key) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("suite-offline-v1");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<ModuleStorage>((resolve, reject) => {
            const request = db
              .transaction("records")
              .objectStore("records")
              .get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      }, `${me.user.id}/${workspace}/module-state`);
    await page.reload();
    await selectValue(page, "Workspace", workspace);
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
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(page.getByRole("table")).toContainText("Pending contact");
    const navigate = () =>
      page
        .getByRole("link", { name: clientReferenceName, exact: true })
        .click();
    const picker = page.locator(".reference-picker");
    await navigate();
    await picker.locator("summary").click();
    await expect(picker.getByRole("status")).toHaveText("3 choices on page 1.");
    await expect
      .poll(
        async () =>
          Object.keys((await stored()).referenceMetadata ?? {}).length,
      )
      .toBe(1);
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Linked note", exact: true }),
    ).toBeVisible();
    await picker.locator("summary").click();
    await expect(picker.getByRole("status")).toContainText("3 offline choices");
    await expect(picker.getByText(/^Downloaded labels from /)).toBeVisible();
    await selectValue(page, "Target", clientReferenceRows[1].id);
    await expect(picker.getByRole("combobox")).toContainText("Target 002");
    expect(
      (
        await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/reference-cache", { recursive: true });
    await page.screenshot({
      path: "docs/verification/reference-cache/web-wide.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/reference-cache/web-narrow.png",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ hasText: "Pending contact" })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page
      .getByLabel("Phone", { exact: true })
      .fill("Saved while disconnected");
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const before = await stored();
    expect(before.journal).toHaveLength(1);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Clear downloaded reference labels",
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Downloaded reference labels cleared." }),
    ).toBeVisible();
    const after = await stored();
    expect(after.referenceOptions).toEqual({});
    expect(after.referenceMetadata).toEqual({});
    expect(after.journal).toEqual(before.journal);
    expect(after.drafts).toEqual(before.drafts);
    expect(after.pages).toEqual(before.pages);
    await page.screenshot({
      path: "docs/verification/reference-cache/web-settings.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", {
        name: "Clear downloaded reference labels",
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/reference-cache/web-settings-narrow.png",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate();
    await picker.locator("summary").click();
    await expect(picker.getByRole("status")).toContainText("0 offline choices");
    await context.setOffline(false);
    await expect
      .poll(async () => (await stored()).journal[0]?.state)
      .toBe("accepted");
    await page.reload();
    await picker.locator("summary").click();
    await expect(picker.getByRole("status")).toHaveText("3 choices on page 1.");
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [workspace, `${clientReferenceId}.targets.read`],
    );
    await expect(picker.getByRole("alert")).toContainText(
      "no longer have access to the referenced resource",
    );
    await context.setOffline(true);
    await page.reload();
    await expect(picker.getByRole("alert")).toContainText(
      "no longer have access to the referenced resource",
    );
    await expect(picker.getByRole("combobox")).not.toContainText("Target 002");
    expect((await stored()).journal[0].state).toBe("accepted");
  } finally {
    await pool.end();
  }
});

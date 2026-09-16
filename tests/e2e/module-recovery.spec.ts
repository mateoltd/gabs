import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";

test("reload resumes an uncertain installation receipt and uninstall preserves real contact records", async ({
  page,
}) => {
  test.setTimeout(90000);
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await selectValue(page, "Local demonstration account", "owner@demo.local");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspaceId = randomUUID();
    const created = await page.request.post("/api/v1/workspaces", {
      headers: {
        origin: new URL(page.url()).origin,
        "x-csrf-token": me.csrfToken,
        "idempotency-key": randomUUID(),
      },
      data: { id: workspaceId, name: "Installation recovery", currency: "EUR" },
    });
    expect(created.ok()).toBe(true);
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    const readState = () =>
      page.evaluate(
        async ({ userId, workspaceId }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("suite-offline-v1");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            return await new Promise<{
              lifecycle?: Record<
                string,
                { requestId: string; phase: string; action: string }
              >;
            }>((resolve, reject) => {
              const request = db
                .transaction("records")
                .objectStore("records")
                .get(`${userId}/${workspaceId}/module-state`);
              request.onsuccess = () => resolve(request.result ?? {});
              request.onerror = () => reject(request.error);
            });
          } finally {
            db.close();
          }
        },
        { userId: me.user.id, workspaceId },
      );
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Preserved installation contact");
    await selectValue(page, "Kind", "organization");
    await selectValue(page, "Relationship", "customer");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page.getByRole("cell", {
        name: "Preserved installation contact",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Modules", exact: true }).click();
    const card = page.locator(".module-install-card").filter({
      has: page.getByRole("heading", { name: "Contacts", exact: true }),
    });
    const projects = page.locator(".module-install-card").filter({
      has: page.getByRole("heading", { name: "Projects", exact: true }),
    });
    await expect(
      projects.getByRole("button", { name: "Uninstall", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => Object.keys((await readState()).lifecycle ?? {}).length)
      .toBe(0);
    const count = async () =>
      Number(
        (
          await admin.query(
            "select count(*) from suite.audit where workspace_id=$1 and target_id='contacts' and action='modules.install'",
            [workspaceId],
          )
        ).rows[0].count,
      );
    const baseline = await count();
    let first = true,
      interrupted = true;
    const keys = new Set<string>();
    await page.route(
      `**/api/v1/workspaces/${workspaceId}/platform`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const body = route.request().postDataJSON();
        if (body.action !== "install" || body.value.moduleId !== "contacts")
          return route.continue();
        keys.add(route.request().headers()["idempotency-key"]);
        if (interrupted) {
          if (first) {
            first = false;
            const accepted = await route.fetch();
            expect(accepted.ok()).toBe(true);
          }
          return route.abort("failed");
        }
        return route.continue();
      },
    );
    await card
      .getByRole("button", { name: "Verify and repair", exact: true })
      .click();
    await expect(
      card.getByText("Installation awaiting confirmation.", { exact: false }),
    ).toBeVisible();
    const key = (await readState()).lifecycle!.contacts.requestId;
    await page.reload();
    await expect(
      card.getByRole("button", { name: "Resume installation", exact: true }),
    ).toBeVisible();
    expect((await readState()).lifecycle!.contacts.requestId).toBe(key);
    await mkdir("docs/verification/module-recovery", { recursive: true });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/module-recovery/pending.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/module-recovery/pending-narrow.png",
    });
    expect(
      (
        await new AxeBuilder({ page })
          .include(".module-install-card")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    interrupted = false;
    await card
      .getByRole("button", { name: "Resume installation", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Verify and repair", exact: true }),
    ).toBeVisible();
    expect(keys.size).toBe(1);
    expect(await count()).toBe(baseline + 1);
    await page.setViewportSize({ width: 1280, height: 720 });
    await card.getByRole("button", { name: "Uninstall", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Uninstall projects" }),
    ).toBeVisible();
    await projects
      .getByRole("button", { name: "Uninstall", exact: true })
      .click();
    await expect(
      projects.getByText("Not installed on this device", { exact: true }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Uninstall", exact: true }).click();
    await expect(
      card.getByText("Not installed on this device", { exact: true }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Install", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "Verify and repair", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(
      page.getByRole("cell", {
        name: "Preserved installation contact",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({
      path: "docs/verification/module-recovery/recovered.png",
    });
  } finally {
    await admin.end();
  }
});

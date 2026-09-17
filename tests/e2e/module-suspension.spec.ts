import type { Snapshot } from "../../packages/client/src";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { selectValue } from "./controls.helpers";

test("connected suspension preserves an open editor and disconnected work locks at lease expiry", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  expect(
    (
      await page.request.post("/api/v1/workspaces", {
        headers: {
          origin: new URL(page.url()).origin,
          "x-csrf-token": me.csrfToken,
          "idempotency-key": randomUUID(),
        },
        data: {
          id: workspaceId,
          name: "Suspension acceptance",
          currency: "EUR",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  const adminContext = await browser.newContext({
    storageState: await context.storageState(),
    baseURL: new URL(page.url()).origin,
    reducedMotion: "reduce",
  });
  let releaseDelayedPlatform = () => {};
  try {
    const admin = await adminContext.newPage();
    await admin.goto("/modules");
    await selectValue(admin, "Workspace", workspaceId);
    const card = admin.locator(".module-install-card").filter({
      has: admin.getByRole("heading", { name: "Contacts", exact: true }),
    });
    const setState = async (state: string) => {
      await card
        .getByRole("button", { name: "Configure access", exact: true })
        .click();
      const dialog = admin.getByRole("dialog", {
        name: "Configure contacts",
        exact: true,
      });
      await selectValue(admin, "Module state", state);
      await dialog
        .getByRole("button", { name: "Save configuration", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
    };
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "New record",
      exact: true,
    });
    await editor
      .getByLabel("Name", { exact: true })
      .fill("Input kept during suspension");
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "other");
    await setState("suspended");
    await expect(
      page.getByRole("heading", { name: "Module access paused", exact: true }),
    ).toBeVisible({ timeout: 8000 });
    await expect(editor).not.toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation", exact: true })
        .getByRole("link", { name: "Contacts", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Projects", exact: true }),
    ).toHaveCount(0);
    await mkdir("docs/verification/module-suspension", { recursive: true });
    await page.screenshot({
      path: "docs/verification/module-suspension/connected.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "docs/verification/module-suspension/narrow.png",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await setState("enabled");
    await expect(editor).toBeVisible({ timeout: 8000 });
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
      "Input kept during suspension",
    );
    await editor
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
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
    await expect(
      page.getByRole("button", { name: "New contacts", exact: true }),
    ).toBeVisible();
    const local = () =>
      page.evaluate(
        async ({ userId, workspaceId }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open("suite-offline-v1");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          const get = <T>(key: string) =>
            new Promise<T>((resolve, reject) => {
              const r = db
                .transaction("records")
                .objectStore("records")
                .get(`${userId}/${workspaceId}/${key}`);
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
          try {
            return {
              snapshot: await get<Snapshot | undefined>("snapshot"),
              modules: await get<ModuleStorage>("module-state"),
            };
          } finally {
            db.close();
          }
        },
        { userId: me.user.id, workspaceId },
      );
    await expect
      .poll(
        async () =>
          (await local()).snapshot?.bootstrap.modules.find(
            (m: { moduleId: string }) => m.moduleId === "contacts",
          )?.state,
      )
      .toBe("enabled");
    await page.clock.install();
    await context.setOffline(true);
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    await editor
      .getByLabel("Name", { exact: true })
      .fill("Pending through suspension");
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "other");
    await editor
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Pending changes", exact: true }),
    ).toBeVisible();
    const pending = (await local()).modules.journal.find(
      (e: { state: string }) => e.state === "pending",
    )!;
    expect(pending).toBeTruthy();
    await setState("suspended");
    // The disconnected client cannot receive a new policy; its prior lease is explicit.
    await expect(
      page.getByRole("button", { name: "New contacts", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    await editor
      .getByLabel("Name", { exact: true })
      .fill("Unsent input at expiry");
    await page.clock.fastForward(25 * 3600000);
    await expect(
      page.getByRole("heading", {
        name: "Online authorization required",
        exact: true,
      }),
    ).toBeVisible();
    await expect(editor).not.toBeVisible();
    expect(
      (await local()).modules.journal.find(
        (e: { id: string }) => e.id === pending.id,
      )!.state,
    ).toBe("pending");
    await page.screenshot({
      path: "docs/verification/module-suspension/expired.png",
    });
    await page.clock.setSystemTime(new Date());
    let markPlatformCaptured!: () => void;
    const capturedPlatform = new Promise<void>((resolve) => {
      markPlatformCaptured = resolve;
    });
    const delayedPlatform = new Promise<void>((resolve) => {
      releaseDelayedPlatform = resolve;
    });
    let delayFirst = true;
    await page.route(
      `**/api/v1/workspaces/${workspaceId}/platform`,
      async (route) => {
        if (!delayFirst || route.request().method() !== "GET")
          return route.continue();
        delayFirst = false;
        const response = await route.fetch();
        markPlatformCaptured();
        await delayedPlatform;
        await route.fulfill({ response });
      },
    );
    await context.setOffline(false);
    await expect(
      page.getByRole("heading", { name: "Module access paused", exact: true }),
    ).toBeVisible({ timeout: 8000 });
    expect(
      (await local()).modules.journal.find(
        (e: { id: string }) => e.id === pending.id,
      )!.state,
    ).toBe("pending");
    await capturedPlatform;
    await setState("enabled");
    await expect(
      page
        .getByRole("navigation", {
          name: "Main navigation",
          exact: true,
          includeHidden: true,
        })
        .getByRole("link", {
          name: "Contacts",
          exact: true,
          includeHidden: true,
        }),
    ).toHaveCount(1, { timeout: 8000 });
    // A pre-restoration installation reply must not override the new policy's check.
    releaseDelayedPlatform();
    await expect(editor).toBeVisible({ timeout: 8000 });
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
      "Unsent input at expiry",
    );
    await editor
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(
      page.getByRole("cell", {
        name: "Pending through suspension",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await local()).modules.journal.find(
        (e: { id: string }) => e.id === pending.id,
      )!.state,
    ).toBe("accepted");
    await page.screenshot({
      path: "docs/verification/module-suspension/recovered.png",
    });
  } finally {
    releaseDelayedPlatform();
    await adminContext.close();
  }
});

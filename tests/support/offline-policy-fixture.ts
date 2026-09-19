import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { selectValue } from "../e2e/controls.helpers";
import type { Snapshot } from "../../packages/client/src";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";

export async function setupOfflinePolicy(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await selectValue(page, "Local demonstration account", "owner@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken as string,
  };
  const created = await page.request.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: scope.workspaceId,
      name: "Offline policy acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const records = `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`;
  const artifact = await (
    await page.request.get(
      `/api/v1/module/contacts/workspaces/${scope.workspaceId}/artifact`,
    )
  ).json();
  const record = await page.request.post(records, {
    headers: {
      ...headers,
      "idempotency-key": randomUUID(),
      "x-module-version": artifact.version,
    },
    data: {
      resource: "contacts",
      action: "create",
      input: {
        data: {
          name: "Policy contact",
          kind: "person",
          relationship: "customer",
          phone: "111",
        },
      },
    },
  });
  expect(record.ok(), await record.text()).toBe(true);
  const stored = () =>
    page.evaluate(async ({ userId, workspaceId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("suite-offline-v1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const read = <T>(key: string) =>
          new Promise<T>((resolve, reject) => {
            const request = db
              .transaction("records")
              .objectStore("records")
              .get(`${userId}/${workspaceId}/${key}`);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        return {
          snapshot: await read<Snapshot>("snapshot"),
          state: await read<ModuleStorage>("module-state"),
        };
      } finally {
        db.close();
      }
    }, scope);
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  const contacts = () =>
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await settings();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect
    .poll(async () => (await stored()).snapshot?.bootstrap.offlineHours)
    .toBe(24);
  await contacts();
  await expect(
    page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: "Policy contact" }),
  ).toBeVisible();
  await expect
    .poll(async () => Object.keys((await stored()).state?.pages ?? {}).length)
    .toBeGreaterThan(0);
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => undefined),
  );
  const capture = async () => {
    await contacts();
    await page
      .getByRole("row")
      .filter({ hasText: "Policy contact" })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page.getByLabel("Phone", { exact: true }).fill("Saved offline");
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return (await stored()).state.journal[0]!;
  };
  return { scope, headers, records, stored, settings, contacts, capture };
}

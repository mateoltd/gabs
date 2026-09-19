import "dotenv/config";
import { test, expect } from "@playwright/test";
import { selectValue } from "./controls.helpers";
import { offlineListsJourney } from "../support/offline-lists-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";

test("selected offline lists survive restart, refresh explicitly and preserve pending work on removal", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
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
  await offlineListsJourney({
    page,
    api: page.request,
    kind: "web",
    offline: (value) => context.setOffline(value),
    restartOffline: async () => {
      await page.reload();
      return page;
    },
    resize: (width, height) => page.setViewportSize({ width, height }),
    storage: (page, scope) =>
      page.evaluate(async ({ userId, workspaceId }) => {
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
              .get(`${userId}/${workspaceId}/module-state`);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      }, scope),
  });
});

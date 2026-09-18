import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import { journalDeliveryJourney } from "../support/journal-delivery-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
test("lost reply and later denial retain the original journal identity across browser restart", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const api = await request.newContext({ baseURL: "http://localhost:4310" });
  try {
    expect(
      (
        await api.post("/auth/development", {
          headers: { origin: "http://localhost:4300" },
          data: { email: "owner@demo.local" },
        })
      ).ok(),
    ).toBe(true);
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
    await journalDeliveryJourney({
      page,
      api,
      pool,
      kind: "web",
      loseReply: async (key, revoke) => {
        let resolve!: () => void, reject!: (error: unknown) => void;
        const done = new Promise<void>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        let lost = false;
        await page.route(
          "**/api/v1/module/contacts/workspaces/*/records",
          async (route) => {
            if (lost || route.request().headers()["idempotency-key"] !== key)
              return route.continue();
            try {
              const response = await route.fetch();
              expect(response.ok(), await response.text()).toBe(true);
              lost = true;
              await revoke();
              await route.abort("connectionreset");
              resolve();
            } catch (error) {
              reject(error);
              await route.abort();
            }
          },
        );
        return { done };
      },
      offline: (value) => context.setOffline(value),
      restart: async () => {
        await page.reload();
        return page;
      },
      narrow: () => page.setViewportSize({ width: 390, height: 844 }),
      storage: (page, scope) =>
        page.evaluate(async (scope) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open("suite-offline-v1");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          try {
            return await new Promise<ModuleStorage>((resolve, reject) => {
              const r = db
                .transaction("records")
                .objectStore("records")
                .get(`${scope.userId}/${scope.workspaceId}/module-state`);
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
          } finally {
            db.close();
          }
        }, scope),
    });
  } finally {
    await context.setOffline(false);
    await api.dispose();
    await pool.end();
  }
});

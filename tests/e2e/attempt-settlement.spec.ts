import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import { attemptSettlementJourney } from "../support/attempt-settlement-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
test("uncertain uncommitted work is fenced, resumed and corrected after a lost settlement reply", async ({
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
    await attemptSettlementJourney({
      page,
      api,
      pool,
      kind: "web",
      blockOriginalAndLoseSettlement: async (key, loseSettlement = true) => {
        let lost = false;
        await page.route(
          "**/api/v1/module/contacts/workspaces/**",
          async (route) => {
            if (route.request().headers()["idempotency-key"] === key)
              return route.abort("connectionreset");
            if (
              loseSettlement &&
              !lost &&
              route.request().url().endsWith("/attempts/settle")
            ) {
              const response = await route.fetch();
              expect(response.ok(), await response.text()).toBe(true);
              lost = true;
              return route.abort("connectionreset");
            }
            return route.continue();
          },
        );
      },
      offline: (value) => context.setOffline(value),
      restart: async () => {
        await page.reload();
        return page;
      },
      wide: () => page.setViewportSize({ width: 1440, height: 1000 }),
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

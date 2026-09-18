import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import { createCollisionJourney } from "../support/create-collision-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
for (const scenario of ["linked", "edits", "archived", "drafts"])
  test(`colliding creates recover separate records and linked work after a lost reply and reload ${scenario}`, async ({
    page,
    context,
  }) => {
    const sameRecord = scenario === "edits" || scenario === "archived";
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
      await selectValue(
        page,
        "Local demonstration account",
        "owner@demo.local",
      );
      await page
        .getByRole("button", { name: "Open workspace", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Switch workspace", exact: true }),
      ).toBeVisible();
      await createCollisionJourney({
        page,
        api,
        pool,
        kind: "web",
        sameRecord,
        archiveChosen: scenario === "archived",
        ordinaryDrafts: scenario === "drafts",
        offline: (value) => context.setOffline(value),
        loseSettlementReply: async () => {
          let lost = false;
          await page.route("**/attempts/settle", async (route) => {
            if (lost) return route.continue();
            const response = await route.fetch();
            expect(response.ok(), await response.text()).toBe(true);
            lost = true;
            return route.abort("connectionreset");
          });
        },
        restart: async (offline = false) => {
          await context.setOffline(offline);
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

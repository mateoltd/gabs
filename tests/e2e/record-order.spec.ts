import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import { recordOrderJourney } from "../support/record-order-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
test.use({ actionTimeout: 15000 });
for (const legacy of [false, true])
  test(`${legacy ? "legacy" : "new"} same-record edits preserve order and explicit conflict recovery after reload`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    const pool = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    const dispatched: string[] = [];
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
      await recordOrderJourney({
        page,
        api,
        pool,
        kind: "web",
        legacy,
        writeStorage: (page, scope, state) =>
          page.evaluate(
            async ({ scope, state }) => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const r = indexedDB.open("suite-offline-v1");
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
              });
              try {
                await new Promise<void>((resolve, reject) => {
                  const tx = db.transaction("records", "readwrite");
                  tx.objectStore("records").put(
                    state,
                    `${scope.userId}/${scope.workspaceId}/module-state`,
                  );
                  tx.oncomplete = () => resolve();
                  tx.onerror = () => reject(tx.error);
                  tx.onabort = () => reject(tx.error);
                });
              } finally {
                db.close();
              }
            },
            { scope, state },
          ),
        offline: (value) => context.setOffline(value),
        restartOffline: async () => {
          await page.reload();
          return page;
        },
        reconnect: async () => {
          await context.setOffline(false);
        },
        loseReply: async (key) => {
          let lost = false;
          await page.route("**/records", async (route) => {
            const req = route.request();
            if (
              req.method() !== "POST" ||
              req.postDataJSON()?.action !== "update"
            )
              return route.continue();
            dispatched.push(req.headers()["idempotency-key"]);
            const response = await route.fetch();
            if (
              req.headers()["idempotency-key"] === key &&
              !lost &&
              response.ok()
            ) {
              lost = true;
              return route.abort("connectionreset");
            }
            return route.fulfill({ response });
          });
        },
        dispatched: async () => dispatched,
        narrow: () => page.setViewportSize({ width: 390, height: 844 }),
        wide: () => page.setViewportSize({ width: 1440, height: 1000 }),
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

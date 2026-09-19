import { readFile } from "node:fs/promises";
import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import { commandCorrectionJourney } from "../support/command-correction-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
test.use({ actionTimeout: 15000 });
for (const mode of [
  "submitted-command-accepted",
  "submitted-command-cancelled",
  "submitted-create-accepted",
  "submitted-create-cancelled",
  "submitted-update-accepted",
  "submitted-update-cancelled",
  "submitted-archive-accepted",
  "submitted-archive-cancelled",
  "collision-command-accepted",
  "collision-command-cancelled",
  "collision-command-separate",
  "collision-command-existing",
  "collision-archive-cancelled",
  "collision-archive-separate",
  "collision-archive-existing",
  "archive-review",
  "archive-review-archived",
  "cross-module",
  "command-resource",
  "command-update",
  "command-archive",
  "rejected",
  "uncertain",
  "late-accepted",
  "lease-expired",
  "permission-revoked",
  "upgrade",
  "schema-review",
  "removed",
  "service-only",
  "viewless",
  "uninstalled",
  "resource-viewless",
  "resource-uninstalled",
] as const)
  test(`command correction preserves review and dependencies after ${mode} original`, async ({
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
      await commandCorrectionJourney({
        page,
        api,
        pool,
        kind: "web",
        rejectExport: async (button, moduleId, during) => {
          let downloads = 0;
          const observed = () => {
            downloads++;
          };
          page.on("download", observed);
          const pattern = `**/module/${moduleId}/workspaces/*/artifact`;
          await page.route(pattern, async (route) => {
            await during();
            await route.fulfill({ response: await route.fetch() });
          });
          try {
            await button.click();
            await expect(button).toHaveCount(0);
            expect(downloads).toBe(0);
          } finally {
            await page.unroute(pattern);
            page.off("download", observed);
          }
          const preparation = `**/module/${moduleId}/workspaces/*/receipt-artifact?*`;
          await page.route(preparation, (route) =>
            route.fulfill({
              status: 401,
              contentType: "application/json",
              body: JSON.stringify({
                code: "UNAUTHENTICATED",
                message: "Sign in to continue.",
              }),
            }),
          );
          try {
            const denied = page.waitForResponse(
              (response) =>
                response.url().includes(`/module/${moduleId}/`) &&
                response.url().includes("receipt-artifact") &&
                response.status() === 401,
            );
            await page.reload();
            await denied;
            await expect(
              page.getByRole("heading", {
                name: "Saved work recovery",
                exact: true,
              }),
            ).toHaveCount(0);
          } finally {
            await page.unroute(preparation);
          }
        },
        exportWork: async (button) => {
          const download = button.page().waitForEvent("download");
          await button.click();
          return JSON.parse(
            await readFile((await (await download).path())!, "utf8"),
          );
        },
        mode,
        offline: (value) => context.setOffline(value),
        restartOffline: async () => {
          await page.reload();
          return page;
        },
        reconnect: async () => {
          await context.setOffline(false);
        },
        interruptCall: async (key, outcome) => {
          await page.route("**/api/v1/module/**", async (route) => {
            const request = route.request();
            const write = /\/(records|operations\/capture)$/.test(
              new URL(request.url()).pathname,
            );
            if (!write || request.headers()["idempotency-key"] !== key)
              return route.fallback();
            if (outcome === "accepted") {
              const result = await route.fetch();
              expect(result.ok(), await result.text()).toBe(true);
            }
            await route.abort("connectionreset");
          });
        },
        blockOriginal: async (key) => {
          await page.route("**/operations/capture", async (route) => {
            if (route.request().headers()["idempotency-key"] === key)
              return route.abort("connectionreset");
            return route.continue();
          });
        },
        holdSettlement: async () => {
          let signal!: () => void, release!: () => void;
          const arrived = new Promise<void>((resolve) => {
            signal = resolve;
          });
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          let once = true;
          await page.route("**/attempts/settle", async (route) => {
            const response = await route.fetch();
            if (once && response.ok()) {
              once = false;
              signal();
              await held;
            }
            await route.fulfill({ response });
          });
          return { arrived: () => arrived, release: async () => release() };
        },
        loseSettlementReply: async () => {
          let lost = false;
          await page.route("**/attempts/settle", async (route) => {
            const response = await route.fetch();
            if (!lost && response.ok()) {
              lost = true;
              return route.abort("connectionreset");
            }
            return route.fulfill({ response });
          });
        },
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

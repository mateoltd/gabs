import "dotenv/config";
import {
  test,
  expect,
  request,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createCollisionJourney } from "../support/create-collision-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
const require = createRequire(resolve("apps/desktop/package.json"));
for (const sameRecord of [false, true])
  test(`native colliding creates recover linked work after a lost reply and process restart ${sameRecord ? "with later record edits" : "with linked records"}`, async () => {
    test.setTimeout(120000);
    const pool = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    const profile = await mkdtemp(
      resolve(tmpdir(), "suite-create-collisions-"),
    );
    let app!: ElectronApplication, page!: Page;
    const launch = async () => {
      app = await electron.launch({
        executablePath: require("electron"),
        args: [
          resolve("apps/desktop/dist/main.cjs"),
          `--user-data-dir=${profile}`,
        ],
        env: {
          ...process.env,
          NODE_ENV: "development",
          SUITE_DESKTOP_DEV_AUTH: "1",
          SUITE_DESKTOP_TEST_MINIMIZED: "1",
        },
      });
      page = await app.firstWindow();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page
        .getByRole("button", { name: "Open local workspace", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Switch workspace", exact: true }),
      ).toBeVisible();
      return page;
    };
    try {
      expect(
        (
          await api.post("/auth/development", {
            headers: { origin: "http://localhost:4300" },
            data: { email: "owner@demo.local" },
          })
        ).ok(),
      ).toBe(true);
      await launch();
      await createCollisionJourney({
        page,
        api,
        pool,
        kind: "native",
        sameRecord,
        offline: async (offline) => {
          await app.evaluate((_, offline) => {
            const state = globalThis as typeof globalThis & {
              savedFetch?: typeof fetch;
            };
            state.savedFetch ??= globalThis.fetch;
            globalThis.fetch = offline
              ? async () => {
                  throw new TypeError("fetch failed", {
                    cause: { code: "ECONNREFUSED" },
                  });
                }
              : state.savedFetch;
          }, offline);
          await page.evaluate((offline) => {
            Object.defineProperty(navigator, "onLine", {
              configurable: true,
              get: () => !offline,
            });
            window.dispatchEvent(new Event(offline ? "offline" : "online"));
          }, offline);
        },
        loseSettlementReply: async () => {
          await app.evaluate(() => {
            const original = globalThis.fetch;
            let lost = false;
            globalThis.fetch = async (url, init) => {
              const response = await original(url, init);
              if (
                !lost &&
                String(url).endsWith("/attempts/settle") &&
                response.ok
              ) {
                lost = true;
                throw new TypeError("Settlement reply lost", {
                  cause: { code: "ECONNRESET" },
                });
              }
              return response;
            };
          });
        },
        restart: async () => {
          await app.close();
          return launch();
        },
        wide: () =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
          ),
        narrow: () =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].setSize(390, 844),
          ),
        storage: (page, scope) =>
          page.evaluate(
            async (scope) =>
              (await window.suiteDesktop!.cacheRead(
                scope,
                "module-state",
              )) as ModuleStorage,
            scope,
          ),
      });
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
          ),
        ),
      ).toBe(true);
    } finally {
      await app?.close();
      await api.dispose();
      await pool.end();
      await rm(profile, { recursive: true, force: true });
    }
  });

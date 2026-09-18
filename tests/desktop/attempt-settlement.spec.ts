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
import { attemptSettlementJourney } from "../support/attempt-settlement-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
const require = createRequire(resolve("apps/desktop/package.json"));
test("native settlement fences late retries and preserves corrected dependent work after restart", async () => {
  test.setTimeout(120000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const api = await request.newContext({ baseURL: "http://localhost:4310" });
  const profile = await mkdtemp(resolve(tmpdir(), "suite-attempt-settlement-"));
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
    await attemptSettlementJourney({
      page,
      api,
      pool,
      kind: "native",
      offline: async (offline) => {
        await app.evaluate((_, offline) => {
          const state = globalThis as typeof globalThis & {
            savedFetch?: typeof fetch;
            deliveryFetch?: typeof fetch;
          };
          state.savedFetch ??= globalThis.fetch;
          globalThis.fetch = offline
            ? async () => {
                throw new TypeError("fetch failed", {
                  cause: { code: "ECONNREFUSED" },
                });
              }
            : (state.deliveryFetch ?? state.savedFetch);
        }, offline);
        await page.evaluate((offline) => {
          Object.defineProperty(navigator, "onLine", {
            configurable: true,
            get: () => !offline,
          });
          window.dispatchEvent(new Event(offline ? "offline" : "online"));
        }, offline);
      },
      blockOriginalAndLoseSettlement: async (key, loseSettlement = true) => {
        await app.evaluate(
          (_, { key, loseSettlement }) => {
            const state = globalThis as typeof globalThis & {
              savedFetch?: typeof fetch;
              deliveryFetch?: typeof fetch;
            };
            const original = state.savedFetch ?? globalThis.fetch;
            let lost = false;
            state.deliveryFetch = async (url, init) => {
              if (new Headers(init?.headers).get("idempotency-key") === key)
                throw new TypeError("Request interrupted", {
                  cause: { code: "ECONNRESET" },
                });
              const response = await original(url, init);
              if (
                loseSettlement &&
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
          },
          { key, loseSettlement },
        );
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

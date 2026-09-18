import "dotenv/config";
import {
  test,
  expect,
  request,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { Pool } from "pg";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  directCreateCollisionJourney,
  type CapturedWrite,
} from "../support/direct-create-collision-journey";
const require = createRequire(resolve("apps/desktop/package.json"));
type CaptureState = typeof globalThis & {
  directWrites: CapturedWrite[];
  directOffline?: boolean;
  directSettleLoss?: boolean;
  directLoss?: { action: string; commit: boolean };
  directCaptured?: CapturedWrite;
  beforeAction?: string;
  beforeWaiting?: boolean;
  resumeBefore?: () => void;
};
test("native direct create collisions recover without enabling offline storage", async () => {
  test.setTimeout(180000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const api = await request.newContext({ baseURL: "http://localhost:4310" });
  const profile = await mkdtemp(
    resolve(tmpdir(), "suite-direct-create-collisions-"),
  );
  let app!: ElectronApplication;
  try {
    expect(
      (
        await api.post("/auth/development", {
          headers: { origin: "http://localhost:4300" },
          data: { email: "owner@demo.local" },
        })
      ).ok(),
    ).toBe(true);
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
    const page = await app.firstWindow();
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
    await app.evaluate(() => {
      const state = globalThis as CaptureState;
      state.directWrites = [];
      const original = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (state.directOffline)
          throw new TypeError("Offline", { cause: { code: "ECONNREFUSED" } });
        if (
          state.directSettleLoss &&
          String(url).endsWith("/attempts/settle")
        ) {
          const response = await original(url, init);
          if (response.ok) {
            state.directSettleLoss = false;
            throw new TypeError("Settlement reply lost", {
              cause: { code: "ECONNRESET" },
            });
          }
          return response;
        }
        if (
          !String(url).includes("/module/contacts/") ||
          !String(url).endsWith("/records") ||
          typeof init?.body !== "string"
        )
          return original(url, init);
        const body = JSON.parse(init.body) as CapturedWrite["body"];
        if (!["create", "update", "archive"].includes(body.action))
          return original(url, init);
        const headers = new Headers(init.headers);
        const call = {
          key: headers.get("idempotency-key")!,
          version: headers.get("x-module-version")!,
          body,
        };
        state.directWrites.push(call);
        if (state.beforeAction === body.action) {
          state.beforeAction = undefined;
          state.beforeWaiting = true;
          await new Promise<void>((resolve) => {
            state.resumeBefore = resolve;
          });
          state.beforeWaiting = false;
        }
        if (state.directLoss?.action !== body.action)
          return original(url, init);
        const loss = state.directLoss;
        state.directLoss = undefined;
        if (loss.commit) {
          const response = await original(url, init);
          if (!response.ok)
            throw Error(`Fixture could not commit: ${response.status}`);
        }
        state.directCaptured = call;
        throw new TypeError("Request interrupted", {
          cause: { code: "ECONNRESET" },
        });
      };
    });
    await directCreateCollisionJourney({
      page,
      api,
      pool,
      kind: "native",
      loseNext: async (action, commit) => {
        await app.evaluate(
          (_, loss) => {
            const state = globalThis as CaptureState;
            state.directCaptured = undefined;
            state.directLoss = loss;
          },
          { action, commit },
        );
        return async () => {
          await expect
            .poll(() =>
              app.evaluate(() => (globalThis as CaptureState).directCaptured),
            )
            .toBeTruthy();
          return (await app.evaluate(
            () => (globalThis as CaptureState).directCaptured,
          ))!;
        };
      },
      beforeNext: async (action, run) => {
        await app.evaluate((_, action) => {
          (globalThis as CaptureState).beforeAction = action;
        }, action);
        const done = (async () => {
          await expect
            .poll(() =>
              app.evaluate(() => (globalThis as CaptureState).beforeWaiting),
            )
            .toBe(true);
          await run();
          await app.evaluate(() => {
            (globalThis as CaptureState).resumeBefore!();
          });
        })();
        return () => done;
      },
      loseSettlementReply: async () => {
        await app.evaluate(() => {
          (globalThis as CaptureState).directSettleLoss = true;
        });
      },
      offline: async (value) => {
        await app.evaluate((_, value) => {
          (globalThis as CaptureState).directOffline = value;
        }, value);
        await page.evaluate((offline) => {
          Object.defineProperty(navigator, "onLine", {
            configurable: true,
            get: () => !offline,
          });
          window.dispatchEvent(new Event(offline ? "offline" : "online"));
        }, value);
      },
      writes: () =>
        app.evaluate(() => (globalThis as CaptureState).directWrites),
      wide: () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
        ),
      narrow: () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(390, 844),
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

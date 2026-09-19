import "dotenv/config";
import {
  test,
  expect,
  request,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { offlineListsJourney } from "../support/offline-lists-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
const require = createRequire(resolve("apps/desktop/package.json"));
test.use({ actionTimeout: 15000 });
test("native offline lists survive process restart, refresh and removal without losing pending work", async () => {
  test.setTimeout(180000);
  const api = await request.newContext({ baseURL: "http://localhost:4310" });
  const profile = await mkdtemp(resolve(tmpdir(), "suite-offline-lists-"));
  let app: ElectronApplication | undefined;
  let page: Page;
  const launch = async (offline: boolean) => {
    const entry = resolve(profile, "offline-entry.cjs");
    await writeFile(
      entry,
      `const original=globalThis.fetch;globalThis.offlineFlag=${offline};
globalThis.fetch=(...args)=>globalThis.offlineFlag?Promise.reject(new TypeError('Offline',{cause:{code:'ECONNREFUSED'}})):original(...args);
require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});`,
    );
    app = await electron.launch({
      executablePath: require("electron"),
      args: [entry, `--user-data-dir=${profile}`],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
      },
    });
    page = await app.firstWindow();
    expect(
      await app.evaluate(
        ({ safeStorage }) =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== "linux" ||
            safeStorage.getSelectedStorageBackend() !== "basic_text"),
      ),
      "Native offline acceptance requires unlocked OS-protected credential storage.",
    ).toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (!offline) {
      await page
        .getByRole("button", { name: "Open local workspace", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Switch workspace", exact: true }),
      ).toBeVisible();
    }
    return page;
  };
  const offline = async (value: boolean) => {
    await app!.evaluate((_, value) => {
      (globalThis as typeof globalThis & { offlineFlag: boolean }).offlineFlag =
        value;
    }, value);
    await page.evaluate((value) => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => !value,
      });
      window.dispatchEvent(new Event(value ? "offline" : "online"));
    }, value);
    if (!value) {
      await page.evaluate(() => window.suiteDesktop!.login());
      await page.reload();
    }
  };
  try {
    const response = await api.post("/auth/development", {
      headers: { origin: "http://localhost:4300" },
      data: { email: "owner@demo.local" },
    });
    expect(
      response.ok(),
      `Development authentication returned ${response.status()}`,
    ).toBe(true);
    await launch(false);
    await offlineListsJourney({
      page: page!,
      api,
      kind: "native",
      offline,
      restartOffline: async () => {
        await app!.close();
        await launch(true);
        await offline(true);
        return page;
      },
      resize: (width, height) =>
        app!.evaluate(
          ({ BrowserWindow }, { width, height }) =>
            BrowserWindow.getAllWindows()[0].setSize(width, height),
          { width, height },
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
      await app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) =>
            !window.isFocused() &&
            (!window.isVisible() || window.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    await api.dispose();
    await rm(profile, { recursive: true, force: true });
  }
});

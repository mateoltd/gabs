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
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { archivedInputJourney } from "../support/archived-input-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
const require = createRequire(resolve("apps/desktop/package.json"));
type CaptureState = typeof globalThis & {
  offlineFlag: boolean;
  lossKey?: string;
  dispatched: string[];
  failures: string[];
};
test.use({ actionTimeout: 15000 });
test("native archived input survives restart and exports exact saved data", async () => {
  test.setTimeout(180000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const api = await request.newContext({ baseURL: "http://localhost:4310" });
  const profile = await mkdtemp(resolve(tmpdir(), "suite-archived-input-"));
  let app!: ElectronApplication, page!: Page;
  const launch = async (offline: boolean) => {
    const entry = resolve(profile, "capture-entry.cjs");
    await writeFile(
      entry,
      `const original=globalThis.fetch;
globalThis.offlineFlag=${offline};globalThis.dispatched=[];globalThis.failures=[];
globalThis.fetch=async(...args)=>{try{
 if(globalThis.offlineFlag)throw new TypeError('Offline',{cause:{code:'ECONNREFUSED'}});
 const body=typeof args[1]?.body==='string'?JSON.parse(args[1].body):undefined;
 const create=String(args[0]).endsWith('/records')&&body?.action==='update';
 const key=new Headers(args[1]?.headers).get('idempotency-key');
 if(create)globalThis.dispatched.push(key);
 const result=await original(...args);
 if(create&&(key===globalThis.lossKey||globalThis.lossKey==='next')&&result.ok){globalThis.lossKey=undefined;throw new TypeError('Lost reply',{cause:{code:'ECONNRESET'}})}
 return result;
}catch(error){globalThis.failures.push(String(args[0])+' offline='+globalThis.offlineFlag+' '+error.stack);throw error}
};require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});`,
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
    await app.evaluate((_, value) => {
      (globalThis as CaptureState).offlineFlag = value;
    }, value);
    await page.evaluate((value) => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => !value,
      });
      window.dispatchEvent(new Event(value ? "offline" : "online"));
    }, value);
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
    await launch(false);
    await archivedInputJourney({
      page,
      api,
      pool,
      kind: "native",
      offline,
      restartOffline: async () => {
        await app.close();
        await launch(true);
        await offline(true);
        return page;
      },
      reconnect: async () => {
        await offline(false);
        try {
          await page.evaluate(() => window.suiteDesktop!.login());
        } catch (error) {
          throw new Error(
            String(error) +
              JSON.stringify(
                await app.evaluate(() => (globalThis as CaptureState).failures),
              ),
          );
        }
        await page.reload();
      },
      loseReply: async (key) => {
        await app.evaluate((_, key) => {
          (globalThis as CaptureState).lossKey = key;
        }, key);
      },
      exportInput: async (name) => {
        const filePath = resolve(profile, "recovery.json");
        await app.evaluate(({ dialog }, filePath) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        }, filePath);
        await page.getByRole("button", { name, exact: true }).click();
        await expect
          .poll(async () => {
            try {
              return JSON.parse(await readFile(filePath, "utf8"));
            } catch {
              return undefined;
            }
          })
          .not.toBeUndefined();
        const result = JSON.parse(await readFile(filePath, "utf8"));
        await rm(filePath);
        return result;
      },
      dispatched: () =>
        app.evaluate(() => (globalThis as CaptureState).dispatched),
      narrow: () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(390, 844),
        ),
      wide: () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
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

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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { commandCorrectionJourney } from "../support/command-correction-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
const require = createRequire(resolve("apps/desktop/package.json"));
type CaptureState = typeof globalThis & {
  offlineFlag: boolean;
  lossKey?: string;
  blockedKey?: string;
  lossSettlement?: boolean;
  dispatched: string[];
};
test.use({ actionTimeout: 15000 });
for (const mode of ["rejected", "uncertain", "late-accepted"] as const)
  test(`native command correction preserves review after ${mode} original`, async () => {
    test.setTimeout(180000);
    const pool = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    const profile = await mkdtemp(resolve(tmpdir(), "suite-cross-capture-"));
    let app!: ElectronApplication, page!: Page;
    const launch = async (offline: boolean) => {
      const entry = resolve(profile, "capture-entry.cjs");
      await writeFile(
        entry,
        `const original=globalThis.fetch;
globalThis.offlineFlag=${offline};globalThis.dispatched=[];
globalThis.fetch=async(...args)=>{
 if(globalThis.offlineFlag)throw new TypeError('Offline',{cause:{code:'ECONNREFUSED'}});
 const body=typeof args[1]?.body==='string'?JSON.parse(args[1].body):undefined;
 const create=String(args[0]).endsWith('/operations/capture');
 const key=new Headers(args[1]?.headers).get('idempotency-key');
 if(create&&key===globalThis.blockedKey)throw new TypeError("Interrupted original",{cause:{code:"ECONNRESET"}});
 if(create)globalThis.dispatched.push(key);
 const result=await original(...args);
 if(create&&key===globalThis.lossKey&&result.ok){globalThis.lossKey=undefined;throw new TypeError('Lost reply',{cause:{code:'ECONNRESET'}})}
 if(globalThis.lossSettlement&&String(args[0]).endsWith("/attempts/settle")&&result.ok){globalThis.lossSettlement=false;throw new TypeError("Lost settlement reply",{cause:{code:"ECONNRESET"}})}
 return result;
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
      await commandCorrectionJourney({
        page,
        api,
        pool,
        kind: "native",
        mode,
        offline,
        restartOffline: async () => {
          await app.close();
          await launch(true);
          await offline(true);
          return page;
        },
        reconnect: async () => {
          await offline(false);
          await page.evaluate(() => window.suiteDesktop!.login());
          await page.reload();
        },
        blockOriginal: async (key) => {
          await app.evaluate((_, key) => {
            (globalThis as CaptureState).blockedKey = key;
          }, key);
        },
        loseSettlementReply: async () => {
          await app.evaluate(() => {
            (globalThis as CaptureState).lossSettlement = true;
          });
        },
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

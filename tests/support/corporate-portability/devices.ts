import {
  expect,
  _electron as electron,
  type Browser,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { selectValue } from "../../e2e/controls.helpers";
import type { Scope } from "../../../packages/client/src";
import type { ModuleStorage } from "../../../packages/client/src/modules/storage";
const require = createRequire(resolve("apps/desktop/package.json"));

export async function browserPortabilityDevice(browser: Browser) {
  const context = await browser.newContext({
    baseURL: "http://localhost:4300",
  });
  try {
    let page = await context.newPage();
    await page.goto("/");
    await selectValue(page, "Local demonstration account", "owner@demo.local");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    return {
      get page() {
        return page;
      },
      restart: async () => {
        await page.close();
        page = await context.newPage();
        await page.goto("/");
        await expect(
          page.getByRole("button", { name: "Switch workspace", exact: true }),
        ).toBeVisible();
        return page;
      },
      offline: (value: boolean) => context.setOffline(value),
      exportFile: async (button: Locator, path: string) => {
        await expect(button).toBeEnabled();
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          button.click(),
        ]);
        await download.saveAs(path);
      },
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Actual main/utility storage with an independent controlled OS key before startup. */
export async function nativePortabilityDevice(
  profile: string,
  options: {
    reuse?: boolean;
    storageWorker?: string;
    protectionKey?: string;
    beforeSignIn?(app: ElectronApplication, page: Page): Promise<void>;
  } = {},
) {
  if (!options.reuse) await mkdir(profile);
  const entry = resolve(profile, "entry.cjs");
  if (options.reuse) await readFile(entry);
  else
    await writeFile(
      entry,
      `
    const {safeStorage,utilityProcess}=require('electron');
    if(process.env.SUITE_TEST_ARCHIVE_STORAGE_WORKER){
      const fork=utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork=(entry,...args)=>fork(
        entry.endsWith('cache-worker.cjs') ? process.env.SUITE_TEST_ARCHIVE_STORAGE_WORKER : entry,
        ...args
      );
    }
    const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
    const key=Buffer.from(process.env.SUITE_TEST_ARCHIVE_OS_KEY || ${JSON.stringify(randomBytes(32).toString("hex"))},'hex');
    safeStorage.isEncryptionAvailable=()=>true;
    safeStorage.isAsyncEncryptionAvailable=async()=>true;
    safeStorage.encryptStringAsync=async(text)=>{
      const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);
      return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]);
    };
    safeStorage.decryptStringAsync=async(bytes)=>{
      const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
      c.setAuthTag(bytes.subarray(-16));
      return {result:Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString(),shouldReEncrypt:false};
    };
    const original=globalThis.fetch;
    globalThis.portableOffline=false;
    globalThis.fetch=(...args)=>globalThis.portableOffline
      ? Promise.reject(new TypeError('fetch failed',{cause:{code:'ECONNREFUSED'}})) : original(...args);
    require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});
  `,
    );
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [entry, `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUITE_DESKTOP_DEV_AUTH: "1",
      SUITE_DESKTOP_TEST_MINIMIZED: "1",
      SUITE_TEST_ARCHIVE_STORAGE_WORKER: options.storageWorker ?? "",
      SUITE_TEST_ARCHIVE_OS_KEY: options.protectionKey ?? "",
    },
  });
  const child = app.process();
  try {
    const page = await app.firstWindow();
    const signIn = page.getByRole("button", {
      name: "Open local workspace",
      exact: true,
    });
    // Development credentials are process-local. Cached startup UI is not authenticated readiness.
    await expect(signIn).toBeVisible();
    await options.beforeSignIn?.(app, page);
    await signIn.click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    let closed = false;
    return {
      app,
      page,
      offline: async (value: boolean) => {
        await app.evaluate((_, value) => {
          (
            globalThis as typeof globalThis & { portableOffline: boolean }
          ).portableOffline = value;
        }, value);
        await page.evaluate((value) => {
          Object.defineProperty(navigator, "onLine", {
            configurable: true,
            get: () => !value,
          });
          window.dispatchEvent(new Event(value ? "offline" : "online"));
        }, value);
      },
      exportFile: async (button: Locator, path: string) => {
        await app.evaluate(({ dialog }, path) => {
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: path,
          });
        }, path);
        await button.click();
        await expect
          .poll(async () => {
            try {
              return JSON.parse(await readFile(path, "utf8"));
            } catch {
              const errors = await button
                .locator("..")
                .getByRole("alert")
                .allTextContents();
              if (errors.length) throw Error(errors.join("; "));
              return null;
            }
          })
          .not.toBeNull();
      },
      close: async () => {
        if (closed) return;
        closed = true;
        // A crash journey already observed this process terminate.
        if (child.exitCode !== null || child.signalCode !== null) return;
        try {
          expect(
            await app.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows().every(
                (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
              ),
            ),
          ).toBe(true);
        } finally {
          await app.close();
        }
      },
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
export type PortabilityDevice = Pick<
  Awaited<ReturnType<typeof browserPortabilityDevice>>,
  "page" | "offline" | "exportFile" | "close"
>;

/** Observe durable installation and recovery state through each platform's actual store. */
export async function portabilityStorage(page: Page, scope: Scope) {
  return page.evaluate(async (scope) => {
    if (window.suiteDesktop)
      return (await window.suiteDesktop.cacheRead(
        scope,
        "module-state",
      )) as ModuleStorage;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("suite-offline-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<ModuleStorage>((resolve, reject) => {
        const request = db
          .transaction("records")
          .objectStore("records")
          .get(`${scope.userId}/${scope.workspaceId}/module-state`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, scope);
}

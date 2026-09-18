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
import { commandCorrectionJourney } from "../support/command-correction-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
const require = createRequire(resolve("apps/desktop/package.json"));
type CaptureState = typeof globalThis & {
  offlineFlag: boolean;
  lossKey?: string;
  blockedKey?: string;
  lossSettlement?: boolean;
  dispatched: string[];
  holdSettlement?: boolean;
  settlementArrived?: boolean;
  releaseSettlement?: () => void;
  holdRecoveryMetadata?: string;
  recoveryMetadataArrived?: boolean;
  releaseRecoveryMetadata?: () => void;
};
test.use({ actionTimeout: 15000 });
for (const mode of [
  "cross-module",
  "command-resource",
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
  "resource-stale-metadata",
] as const)
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
 if(globalThis.offlineFlag)throw new TypeError('fetch failed',{cause:{code:'ECONNREFUSED'}});
 const body=typeof args[1]?.body==='string'?JSON.parse(args[1].body):undefined;
 const create=String(args[0]).endsWith('/operations/capture');
 const key=new Headers(args[1]?.headers).get('idempotency-key');
 if(create&&key===globalThis.blockedKey)throw new TypeError("Interrupted original",{cause:{code:"ECONNRESET"}});
 if(create)globalThis.dispatched.push(key);
 const result=await original(...args);
 if(globalThis.holdRecoveryMetadata===key&&new URL(String(args[0])).pathname.endsWith("/platform")&&args[1]?.method==="GET"&&result.ok){globalThis.holdRecoveryMetadata=undefined;globalThis.recoveryMetadataArrived=true;await new Promise(resolve=>{globalThis.releaseRecoveryMetadata=resolve})}
 if(globalThis.holdSettlement&&String(args[0]).endsWith("/attempts/settle")&&result.ok){globalThis.holdSettlement=false;globalThis.settlementArrived=true;await new Promise(resolve=>{globalThis.releaseSettlement=resolve})}
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
        rejectExport: async (button, _moduleId, during) => {
          const file = resolve(
            profile,
            `denied-work-${crypto.randomUUID()}.json`,
          );
          await app.evaluate(({ dialog }, file) => {
            const held = globalThis as typeof globalThis & {
              pickerArrived?: boolean;
              releasePicker?: () => void;
            };
            held.pickerArrived = false;
            dialog.showSaveDialog = async () => {
              held.pickerArrived = true;
              await new Promise<void>((resolve) => {
                held.releasePicker = resolve;
              });
              return { canceled: false, filePath: file };
            };
          }, file);
          await button.click();
          await expect
            .poll(() =>
              app.evaluate(
                () =>
                  (
                    globalThis as typeof globalThis & {
                      pickerArrived?: boolean;
                    }
                  ).pickerArrived,
              ),
            )
            .toBe(true);
          await during();
          await app.evaluate(() =>
            (
              globalThis as typeof globalThis & { releasePicker?: () => void }
            ).releasePicker?.(),
          );
          await expect
            .poll(
              async () =>
                (await button.count()) === 0 ||
                (await page.getByRole("alert").allTextContents()).some(
                  (message) =>
                    message.includes("does not allow exporting this command"),
                ),
            )
            .toBe(true);
          await expect(readFile(file)).rejects.toMatchObject({
            code: "ENOENT",
          });
        },
        exportWork: async (button) => {
          const file = resolve(
            profile,
            `saved-work-${crypto.randomUUID()}.json`,
          );
          await app.evaluate(({ dialog }, file) => {
            dialog.showSaveDialog = async () => ({
              canceled: false,
              filePath: file,
            });
          }, file);
          await button.click();
          await expect
            .poll(async () => {
              try {
                return JSON.parse(await readFile(file, "utf8"));
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
          return JSON.parse(await readFile(file, "utf8"));
        },
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
        holdRecoveryMetadata:
          mode !== "resource-stale-metadata"
            ? undefined
            : async (scope) => {
                const marker = crypto.randomUUID();
                await app.evaluate((_, marker) => {
                  (globalThis as CaptureState).holdRecoveryMetadata = marker;
                }, marker);
                await page.evaluate(
                  ({ scope, marker }) => {
                    const state = window as typeof window & {
                      recoveryMetadataDone?: boolean;
                    };
                    state.recoveryMetadataDone = false;
                    void window
                      .suiteDesktop!.execute({
                        operation: "platformState",
                        params: { workspaceId: scope.workspaceId },
                        idempotencyKey: marker,
                      })
                      .finally(() => {
                        state.recoveryMetadataDone = true;
                      });
                  },
                  { scope, marker },
                );
                await expect
                  .poll(() =>
                    app.evaluate(
                      () =>
                        (globalThis as CaptureState).recoveryMetadataArrived,
                    ),
                  )
                  .toBe(true);
                return {
                  release: async () => {
                    await app.evaluate(() => {
                      (globalThis as CaptureState).releaseRecoveryMetadata!();
                    });
                    await page.waitForFunction(
                      () =>
                        (
                          window as typeof window & {
                            recoveryMetadataDone?: boolean;
                          }
                        ).recoveryMetadataDone,
                    );
                  },
                };
              },
        holdSettlement: async () => {
          await app.evaluate(() => {
            (globalThis as CaptureState).holdSettlement = true;
          });
          return {
            arrived: async () => {
              await expect
                .poll(() =>
                  app.evaluate(
                    () => (globalThis as CaptureState).settlementArrived,
                  ),
                )
                .toBe(true);
            },
            release: async () => {
              await app.evaluate(() => {
                (globalThis as CaptureState).releaseSettlement!();
              });
            },
          };
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

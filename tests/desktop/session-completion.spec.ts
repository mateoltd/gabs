import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { operations } from "../../packages/client/src/api";
import { selectValue } from "../e2e/controls.helpers";

const require = createRequire(resolve("apps/desktop/package.json"));
type Identity =
  operations["me"]["responses"][200]["content"]["application/json"];
interface LogoutGate {
  arrived: boolean;
  release(): void;
}

test("a late logout acknowledgement preserves the new session's workspace", async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-session-completion-"));
  const entry = resolve(profile, "entry.cjs");
  let device: ElectronApplication | undefined;
  try {
    await writeFile(
      entry,
      `
    const {ipcMain,safeStorage}=require('electron');
    // This session-only test never asks the OS to unlock protected storage.
    safeStorage.isEncryptionAvailable=()=>false;
    safeStorage.isAsyncEncryptionAvailable=async()=>false;
    const handle=ipcMain.handle.bind(ipcMain);
    let release;
    const pending=new Promise(resolve=>{release=resolve;});
    const gate=globalThis.logoutGate={arrived:false,release};
    ipcMain.handle=(channel,listener)=>handle(channel,channel!=='suite:logout'
      ? listener : async(...args)=>{
        const result=await listener(...args);
        gate.arrived=true;
        await pending;
        return result;
      });
    require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});
    `,
    );
    const app = (device = await electron.launch({
      executablePath: require("electron"),
      args: [entry, `--user-data-dir=${profile}`],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
      },
    }));
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const signIn = () =>
      page
        .getByRole("button", { name: "Open local workspace", exact: true })
        .click();
    await signIn();
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Switch profile", exact: true })
      .click();
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as typeof globalThis & { logoutGate: LogoutGate })
              .logoutGate.arrived,
        ),
      )
      .toBe(true);
    await page
      .getByRole("dialog", { name: "Saved online profiles", exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await signIn();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const response = await page.evaluate(() =>
      window.suiteDesktop!.execute({ operation: "me" }),
    );
    expect(response.status).toBe(200);
    const identity = response.body as Identity;
    const company = identity.workspaces.find(
      (workspace) => workspace.kind === "company",
    );
    expect(company).toBeDefined();
    await selectValue(page, "Workspace", company!.id);
    expect(
      await page.evaluate(() => localStorage.getItem("suite-workspace")),
    ).toBe(company!.id);

    // AcknowledgeSignOut reads this marker synchronously before the finally block.
    // Observe that real continuation without replacing its result or mutations.
    await page.evaluate(() => {
      const root = window as typeof window & { completedSignOut?: boolean };
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        const value = get.call(this, key);
        if (this === localStorage && key === "suite-logout-pending") {
          Storage.prototype.getItem = get;
          queueMicrotask(() => {
            root.completedSignOut = true;
          });
        }
        return value;
      };
    });
    await app.evaluate(() =>
      (
        globalThis as typeof globalThis & { logoutGate: LogoutGate }
      ).logoutGate.release(),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { completedSignOut?: boolean })
              .completedSignOut,
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => localStorage.getItem("suite-workspace")),
    ).toBe(company!.id);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toContainText(company!.name);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) =>
            !window.isFocused() &&
            (!window.isVisible() || window.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    try {
      await device?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
});

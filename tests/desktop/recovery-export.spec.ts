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
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { ModuleInputRecovery } from "@suite/module-sdk/platform";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));
type Capture = typeof globalThis & {
  recoveryOffline: boolean;
  recoveryDialog: boolean;
  releaseRecovery: () => void;
  realNow: typeof Date.now;
};
test("native recovery export enforces current scope, delayed-dialog authority and protected offline restart", async () => {
  test.setTimeout(180000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-recovery-authority-")),
    path = resolve(profile, "recovery.json");
  const api = await request.newContext({ baseURL: "http://localhost:4310" });
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let app!: ElectronApplication, page!: Page;
  const launch = async (offline = false) => {
    const entry = resolve(profile, "entry.cjs");
    await writeFile(
      entry,
      `const fetch=globalThis.fetch;globalThis.recoveryOffline=${offline};globalThis.realNow=Date.now;globalThis.fetch=async(...args)=>{if(globalThis.recoveryOffline)throw new TypeError('fetch failed',{cause:{code:'ECONNREFUSED'}});return fetch(...args)};require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});`,
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
    if (!offline)
      await page
        .getByRole("button", { name: "Open local workspace", exact: true })
        .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
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
    const me = await (await api.get("/api/v1/me")).json();
    const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
    expect(
      (
        await api.post("/api/v1/workspaces", {
          headers: {
            origin: "http://localhost:4300",
            "x-csrf-token": me.csrfToken,
            "idempotency-key": randomUUID(),
          },
          data: {
            id: scope.workspaceId,
            name: "Recovery authority",
            currency: "EUR",
          },
        })
      ).ok(),
    ).toBe(true);
    const pkg = await (
      await api.get(
        `/api/v1/module/contacts/workspaces/${scope.workspaceId}/artifact`,
      )
    ).json();
    const input: ModuleInputRecovery = {
      kind: "module-input-recovery",
      ...scope,
      moduleId: "contacts",
      moduleVersion: pkg.version,
      resource: "contacts",
      status: "unsaved",
      input: { data: { name: "Preserved input", phone: "222" } },
    };
    await launch();
    await selectValue(page, "Workspace", scope.workspaceId);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Contacts", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (scope) => window.suiteDesktop!.cacheRead(scope, "snapshot"),
          scope,
        ),
      )
      .toMatchObject({ bootstrap: { workspace: { id: scope.workspaceId } } });
    const open = () =>
      page.evaluate(
        (input) =>
          window.suiteDesktop!.openModuleHost(
            { userId: input.userId, workspaceId: input.workspaceId },
            input.moduleId,
            input.moduleVersion,
          ),
        input,
      );
    const save = (handle: string, value: unknown = input) =>
      page.evaluate(
        async ({ handle, value }) => {
          try {
            await window.suiteDesktop!.exportInput(
              handle,
              value as ModuleInputRecovery,
            );
            return { ok: true, error: "" };
          } catch (error) {
            return { ok: false, error: String(error) };
          }
        },
        { handle, value },
      );
    const picker = async (delayed = false) => {
      await rm(path, { force: true });
      await app.evaluate(
        ({ dialog }, { path, delayed }) => {
          (globalThis as Capture).recoveryDialog = false;
          dialog.showSaveDialog = async () => {
            (globalThis as Capture).recoveryDialog = true;
            if (delayed)
              await new Promise<void>((resolve) => {
                (globalThis as Capture).releaseRecovery = resolve;
              });
            return { canceled: false, filePath: path };
          };
        },
        { path, delayed },
      );
    };
    const finish = () =>
      app.evaluate(() => {
        (globalThis as Capture).releaseRecovery();
      });
    const deny = async (denied: boolean) => {
      await pool.query(
        denied
          ? "update suite.roles set permissions=array_remove(permissions,'contacts.contacts.read') where workspace_id=$1"
          : "update suite.roles set permissions=array_append(permissions,'contacts.contacts.read') where workspace_id=$1 and not ('contacts.contacts.read'=any(permissions))",
        [scope.workspaceId],
      );
    };
    const noFile = () =>
      expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    let handle = await open();
    await picker();
    for (const bad of [
      { ...input, userId: randomUUID() },
      { ...input, workspaceId: randomUUID() },
      { ...input, moduleId: "inventory" },
      {
        ...input,
        resource: "notes",
        status: "unconfirmed",
        pendingRequest: {},
      },
    ])
      expect((await save(handle, bad)).ok).toBe(false);
    expect(
      await app.evaluate(() => (globalThis as Capture).recoveryDialog),
    ).toBe(false);
    {
      const result = await save(handle);
      expect(result.ok, result.error).toBe(true);
    }
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(input);
    await picker(true);
    let pending = save(handle);
    await expect
      .poll(() => app.evaluate(() => (globalThis as Capture).recoveryDialog))
      .toBe(true);
    await deny(true);
    await finish();
    expect((await pending).ok).toBe(false);
    await noFile();
    await deny(false);
    await picker(true);
    pending = save(handle);
    await expect
      .poll(() => app.evaluate(() => (globalThis as Capture).recoveryDialog))
      .toBe(true);
    await page.evaluate(
      (handle) => window.suiteDesktop!.closeModuleHost(handle),
      handle,
    );
    await finish();
    expect((await pending).ok).toBe(false);
    await noFile();
    handle = await open();
    await picker();
    {
      const result = await save(handle);
      expect(result.ok, result.error).toBe(true);
    }
    // Renderer cache contents cannot grant resource read permission to the host.
    await deny(true);
    await picker();
    expect((await save(handle)).ok).toBe(false);
    await page.evaluate(
      async ({ scope }) => {
        const old = (await window.suiteDesktop!.cacheRead(
          scope,
          "snapshot",
        )) as { bootstrap: { permissions: string[] } };
        old.bootstrap.permissions.push("contacts.contacts.read");
        await window.suiteDesktop!.cacheWrite(scope, "snapshot", old);
      },
      { scope },
    );
    await app.evaluate(() => {
      (globalThis as Capture).recoveryOffline = true;
    });
    expect((await save(handle)).ok).toBe(false);
    await noFile();
    await app.evaluate(() => {
      (globalThis as Capture).recoveryOffline = false;
    });
    await deny(false);
    {
      const result = await save(handle);
      expect(result.ok, result.error).toBe(true);
    }
    await app.close();
    await launch(true);
    handle = await open();
    await picker();
    {
      const result = await save(handle);
      expect(result.ok, result.error).toBe(true);
    }
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(input);
    await picker(true);
    pending = save(handle);
    await expect
      .poll(() => app.evaluate(() => (globalThis as Capture).recoveryDialog))
      .toBe(true);
    await app.evaluate(() => {
      const real = (globalThis as Capture).realNow;
      Date.now = () => real() + 25 * 3600000;
    });
    await finish();
    expect((await pending).ok).toBe(false);
    await noFile();
    await app.evaluate(() => {
      Date.now = (globalThis as Capture).realNow;
    });
    await picker(true);
    pending = save(handle);
    await expect
      .poll(() => app.evaluate(() => (globalThis as Capture).recoveryDialog))
      .toBe(true);
    await page.evaluate(() => window.suiteDesktop!.logout());
    await finish();
    expect((await pending).ok).toBe(false);
    await noFile();
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (win) => !win.isFocused() && (!win.isVisible() || win.isMinimized()),
        ),
      ),
    ).toBe(true);
  } catch (error) {
    throw new Error(
      `${String(error)}\n${await page
        .locator("body")
        .innerText()
        .catch(() => "Page unavailable")}`,
      { cause: error },
    );
  } finally {
    if (app) await app.close().catch(() => {});
    await api.dispose();
    await pool.end();
    await rm(profile, { recursive: true, force: true });
  }
});

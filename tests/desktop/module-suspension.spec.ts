import { Pool } from "pg";
import type { Snapshot } from "../../packages/client/src";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

test("native policy delivery hides an open editor and restores its input after suspension", async () => {
  test.setTimeout(120000);
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const profile = await mkdtemp(resolve(tmpdir(), "suite-native-suspension-"));
  let app: ElectronApplication | undefined;
  try {
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
      },
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
        ),
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const workspaceId = randomUUID();
    expect(
      await page.evaluate(
        async (id) =>
          (
            await window.suiteDesktop!.execute({
              operation: "workspaceCreate",
              body: { id, name: "Native suspension", currency: "EUR" },
              idempotencyKey: crypto.randomUUID(),
            })
          ).status,
        workspaceId,
      ),
    ).toBe(200);
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "New record",
      exact: true,
    });
    await editor
      .getByLabel("Name", { exact: true })
      .fill("Native input preserved");
    await selectValue(page, "Kind", "person");
    const change = (state: string) =>
      page.evaluate(
        async ({ workspaceId, state }) =>
          (
            await window.suiteDesktop!.execute({
              operation: "moduleEdit",
              params: { workspaceId, moduleId: "contacts" },
              body: { state, accessPolicy: "admin" },
            })
          ).status,
        { workspaceId, state },
      );
    expect(await change("suspended")).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Module access paused", exact: true }),
    ).toBeVisible({ timeout: 8000 });
    await expect(editor).not.toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation", exact: true })
        .getByRole("link", { name: "Contacts", exact: true }),
    ).toHaveCount(0);
    await mkdir("docs/verification/module-suspension", { recursive: true });
    await page.screenshot({
      path: "docs/verification/module-suspension/native-paused.png",
    });
    expect(await change("enabled")).toBe(200);
    await expect(editor).toBeVisible({ timeout: 8000 });
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
      "Native input preserved",
    );
    await page.screenshot({
      path: "docs/verification/module-suspension/native-restored.png",
    });
    await editor
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
    const scope = await page.evaluate(async (workspaceId) => {
      const me = await window.suiteDesktop!.execute({ operation: "me" });
      return {
        workspaceId,
        userId: (me.body as { user: { id: string } }).user.id,
      };
    }, workspaceId);
    const snapshot = () =>
      page.evaluate(
        async (scope) =>
          (await window.suiteDesktop!.cacheRead(scope, "snapshot")) as
            Snapshot | undefined,
        scope,
      );
    const journal = () =>
      page.evaluate(
        async (scope) =>
          (
            (await window.suiteDesktop!.cacheRead(
              scope,
              "module-state",
            )) as ModuleStorage
          ).journal,
        scope,
      );
    await expect
      .poll(
        async () =>
          (await snapshot())?.bootstrap.modules.find(
            (m) => m.moduleId === "contacts",
          )?.state,
      )
      .toBe("enabled");
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "New contacts", exact: true }),
    ).toBeVisible();
    await page.clock.install();
    await app.evaluate(() => {
      const original = globalThis.fetch;
      (
        globalThis as unknown as { suspensionOffline: boolean }
      ).suspensionOffline = true;
      globalThis.fetch = async (input, init) => {
        if (
          (globalThis as unknown as { suspensionOffline: boolean })
            .suspensionOffline
        )
          throw Error("Acceptance transport offline");
        return original(input, init);
      };
    });
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    await editor
      .getByLabel("Name", { exact: true })
      .fill("Native pending through suspension");
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "other");
    await editor
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Pending changes", exact: true }),
    ).toBeVisible();
    const pending = (await journal()).find((e) => e.state === "pending")!;
    expect(pending).toBeTruthy();
    await admin.query(
      "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id='contacts'",
      [workspaceId],
    );
    await expect(
      page.getByRole("button", { name: "New contacts", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    await editor
      .getByLabel("Name", { exact: true })
      .fill("Native input at expiry");
    await page.clock.fastForward(25 * 3600000);
    await expect(
      page.getByRole("heading", {
        name: "Online authorization required",
        exact: true,
      }),
    ).toBeVisible();
    await expect(editor).not.toBeVisible();
    expect((await journal()).find((e) => e.id === pending.id)?.state).toBe(
      "pending",
    );
    await page.screenshot({
      path: "docs/verification/module-suspension/native-expired.png",
    });
    await page.clock.setSystemTime(new Date());
    await app.evaluate(() => {
      (
        globalThis as unknown as { suspensionOffline: boolean }
      ).suspensionOffline = false;
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(
      page.getByRole("heading", { name: "Module access paused", exact: true }),
    ).toBeVisible({ timeout: 8000 });
    expect((await journal()).find((e) => e.id === pending.id)?.state).toBe(
      "pending",
    );
    expect(await change("enabled")).toBe(200);
    await expect(editor).toBeVisible({ timeout: 8000 });
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
      "Native input at expiry",
    );
    await editor
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(
      page.getByRole("cell", {
        name: "Native pending through suspension",
        exact: true,
      }),
    ).toBeVisible();
    expect((await journal()).find((e) => e.id === pending.id)?.state).toBe(
      "accepted",
    );
    expect(
      await page.evaluate(async (workspaceId) => {
        try {
          await window.suiteDesktop!.execute({
            operation: "workspacePolicy",
            params: { workspaceId },
            query: { since: "invalid" },
          });
          return false;
        } catch {
          return true;
        }
      }, workspaceId),
    ).toBe(true);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    await admin.end();
    await rm(profile, { recursive: true, force: true });
  }
});

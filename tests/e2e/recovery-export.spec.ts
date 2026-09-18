import "dotenv/config";
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { selectValue } from "./controls.helpers";
test.use({ actionTimeout: 15000 });
test("browser recovery exports honor current policy, view changes and offline lease expiry", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Delay background policy delivery so the export must perform its own current check.
    await page.route("**/api/v1/workspaces/*/policy**", (route) =>
      route.abort(),
    );
    await page.goto("/");
    await selectValue(page, "Local demonstration account", "owner@demo.local");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspaceId = randomUUID(),
      headers = {
        origin: "http://localhost:4300",
        "x-csrf-token": me.csrfToken,
      };
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: {
            id: workspaceId,
            name: "Browser recovery authority",
            currency: "EUR",
          },
        })
      ).ok(),
    ).toBe(true);
    const pkg = await (
      await page.request.get(
        `/api/v1/module/contacts/workspaces/${workspaceId}/artifact`,
      )
    ).json();
    const command = async (action: string, input: unknown) => {
      const result = await page.request.post(
        `/api/v1/module/contacts/workspaces/${workspaceId}/records`,
        {
          headers: {
            ...headers,
            "idempotency-key": randomUUID(),
            "x-module-version": pkg.version,
          },
          data: { resource: "contacts", action, input },
        },
      );
      expect(result.ok(), await result.text()).toBe(true);
      return result.json();
    };
    const record = await command("create", {
      data: {
        name: "Recover archived input",
        kind: "person",
        relationship: "customer",
        phone: "111",
      },
    });
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    const nav = () =>
      page
        .getByRole("navigation", { name: "Main navigation", exact: true })
        .getByRole("link", { name: "Contacts", exact: true })
        .click();
    await nav();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Phone", { exact: true }).fill("222");
    await command("archive", { id: record.id, baseVersion: 1 });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("group", {
        name: "Pending update: Recover archived input",
        exact: true,
      })
      .getByRole("button", { name: "Review", exact: true })
      .click();
    const dialog = () =>
      page.getByRole("dialog", { name: "Recover input", exact: true });
    const exportInput = () =>
      dialog()
        .getByRole("button", { name: "Export input", exact: true })
        .click();
    const downloaded: string[] = [];
    page.on("download", (file) => downloaded.push(file.suggestedFilename()));
    const download = page.waitForEvent("download");
    await exportInput();
    expect(
      JSON.parse(await readFile((await (await download).path())!, "utf8")),
    ).toMatchObject({
      workspaceId,
      input: { baseVersion: 1, data: { phone: "222" } },
    });
    // Cancelling the live view while an identity check is outstanding cannot offer a file.
    let release!: () => void, arrived!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve)),
      waiting = new Promise<void>((resolve) => (arrived = resolve));
    await page.route("**/api/v1/me", async (route) => {
      const response = await route.fetch();
      arrived();
      await held;
      await route.fulfill({ response }).catch(() => {});
    });
    await exportInput();
    await waiting;
    await dialog()
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    release();
    await page.unroute("**/api/v1/me");
    await nav();
    await page.getByRole("button", { name: /Resume review/ }).click();
    await expect(dialog()).toBeVisible();
    expect(downloaded).toHaveLength(1);
    await expect(
      page.getByRole("alert").filter({ hasText: /abort/i }),
    ).toHaveCount(0);
    // Current server read denial is persisted before any offline retry.
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,'contacts.contacts.read') where workspace_id=$1",
      [workspaceId],
    );
    await exportInput();
    await expect(dialog()).toHaveCount(0);
    expect(downloaded).toHaveLength(1);
    const cached = () =>
      page.evaluate(
        async ({ userId, workspaceId }) => {
          const request = indexedDB.open("suite-offline-v1");
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return new Promise<unknown>((resolve, reject) => {
            const read = db
              .transaction("records")
              .objectStore("records")
              .get(`${userId}/${workspaceId}/snapshot`);
            read.onsuccess = () => {
              resolve(read.result);
              db.close();
            };
            read.onerror = () => reject(read.error);
          });
        },
        { userId: me.user.id, workspaceId },
      );
    await expect
      .poll(async () => JSON.stringify(await cached()))
      .not.toContain('"contacts.contacts.read"');
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Resume review", exact: true }),
    ).toHaveCount(0);
    expect(downloaded).toHaveLength(1);
    await context.setOffline(false);
    await pool.query(
      "update suite.roles set permissions=array_append(permissions,'contacts.contacts.read') where workspace_id=$1 and not ('contacts.contacts.read'=any(permissions))",
      [workspaceId],
    );
    await page.reload();
    await nav();
    await page.getByRole("button", { name: /Resume review/ }).click();
    await expect(dialog()).toBeVisible();
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
    await context.setOffline(true);
    const offlineDownload = page.waitForEvent("download");
    await exportInput();
    await offlineDownload;
    expect(downloaded).toHaveLength(2);
    await page.clock.install();
    await page.clock.setSystemTime(new Date(Date.now() + 25 * 3600000));
    await exportInput();
    await expect(dialog().getByRole("alert")).toContainText("expired");
    expect(downloaded).toHaveLength(2);
  } finally {
    await context.setOffline(false).catch(() => {});
    await pool.end();
  }
});

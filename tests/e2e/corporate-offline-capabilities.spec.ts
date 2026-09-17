import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { publishExecutableFixture } from "../support/executable-fixture";
import {
  assignHostFixture,
  exportPermission,
} from "../support/host-capability-journey";
import { selectValue } from "./controls.helpers";
import type { CapabilityLease } from "@suite/module-sdk/capability-leases";

test("real corporate leases enable cached browser exports and reject revoked, tampered and expired offline access", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const id = `offline-host-${randomUUID().slice(0, 8)}`;
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await publishExecutableFixture({
      id,
      name: "Offline capability notes",
      sourceDirectory: "tests/fixtures/host-capabilities",
      transform: (filename, source) =>
        filename === "module.ts"
          ? source.replace(
              'kind: "files.export",',
              'kind: "files.export", offline: "lease",',
            )
          : source,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    expect(
      (await page.request.get("/api/v1/capabilities/key")).status(),
      "The E2E API needs a lease signer. Use Playwright's managed API or configure the reused test API.",
    ).toBe(200);
    const workspaceId = randomUUID();
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers: {
            origin: new URL(page.url()).origin,
            "x-csrf-token": me.csrfToken,
            "idempotency-key": randomUUID(),
          },
          data: {
            id: workspaceId,
            name: "Offline device acceptance",
            currency: "EUR",
          },
        })
      ).ok(),
    ).toBe(true);
    await assignHostFixture(pool, workspaceId, id);
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
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
    await page
      .getByRole("link", { name: "Offline capability notes", exact: true })
      .click();
    const ready = page.getByText(/^Offline access for file exports until/);
    await expect(ready).toBeVisible({ timeout: 15000 });
    const area = page.getByRole("region", {
      name: "Module host actions",
      exact: true,
    });
    const exportButton = area.getByRole("button", {
      name: "Export notes",
      exact: true,
    });
    const downloads: string[] = [];
    page.on("download", (download) =>
      downloads.push(download.suggestedFilename()),
    );
    const stored = (tamper = false) =>
      page.evaluate(
        async ({ userId, workspaceId, tamper }) => {
          return navigator.locks.request(
            "suite-capability-leases",
            async () => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open("suite-offline-v1");
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              try {
                const key = `${userId}/${workspaceId}/capability-leases`;
                const value = await new Promise<
                  { leases: CapabilityLease[]; revision: string } | undefined
                >((resolve, reject) => {
                  const request = db
                    .transaction("records")
                    .objectStore("records")
                    .get(key);
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });
                if (tamper && value?.leases[0]) {
                  value.leases[0].signature = "A".repeat(86) + "==";
                  await new Promise<void>((resolve, reject) => {
                    const tx = db.transaction("records", "readwrite");
                    tx.objectStore("records").put(value, key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                  });
                }
                return value;
              } finally {
                db.close();
              }
            },
          );
        },
        { userId: me.user.id as string, workspaceId, tamper },
      );
    expect((await stored())?.leases[0].payload).toMatchObject({
      moduleId: id,
      userId: me.user.id,
      workspaceId,
      capability: "export",
    });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.reload();
    await expect(ready).toBeVisible();
    const download = page.waitForEvent("download");
    await exportButton.click();
    expect(await readFile((await (await download).path())!, "utf8")).toBe(
      "Exported through the typed module host\n",
    );
    await expect(area.getByRole("status")).toHaveText("Download offered");
    await area
      .getByRole("button", { name: "Show notification", exact: true })
      .click();
    await expect(area.getByRole("alert")).toContainText("Reconnect");
    await mkdir("docs/verification/browser-capability-leases", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/verification/browser-capability-leases/offline-wide.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: "docs/verification/browser-capability-leases/offline-narrow.png",
    });
    await page.setViewportSize({ width: 1280, height: 720 });

    await context.setOffline(false);
    await page.reload();
    await expect(ready).toBeVisible();
    await exportPermission(pool, workspaceId, id, false);
    await expect
      .poll(async () => (await stored())?.leases.length, { timeout: 10000 })
      .toBe(0);
    await context.setOffline(true);
    await exportButton.click();
    await expect(area.getByRole("alert")).toContainText("current permissions");
    expect(downloads).toHaveLength(1);

    await exportPermission(pool, workspaceId, id, true);
    await context.setOffline(false);
    await page.reload();
    await expect(ready).toBeVisible();
    const authorizeRoute = `**/module/${id}/workspaces/${workspaceId}/capabilities/authorize`;
    await page.route(authorizeRoute, (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          code: "FORBIDDEN",
          message: "Current server authority denied this action.",
        }),
      }),
    );
    await exportButton.click();
    await expect(area.getByRole("alert")).toContainText(
      "Current server authority denied",
    );
    await expect(ready).toHaveCount(0);
    await context.setOffline(true);
    await exportButton.click();
    await expect(area.getByRole("alert")).toContainText("revoked");
    expect(downloads).toHaveLength(1);
    await page.unroute(authorizeRoute);

    await context.setOffline(false);
    await page.reload();
    await expect(ready).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/^Offline copy from/)).toBeVisible();
    await stored(true);
    await exportButton.click();
    await expect(area.getByRole("alert")).toContainText(
      "signature verification failed",
    );
    expect(downloads).toHaveLength(1);

    await context.setOffline(false);
    await page.reload();
    await expect(ready).toBeVisible();
    await context.setOffline(true);
    await page.clock.install();
    await page.clock.fastForward(24 * 3600000 + 2000);
    await expect(
      page.getByRole("heading", {
        name: "Online authorization required",
        exact: true,
      }),
    ).toBeVisible();
    await expect(exportButton).toHaveCount(0);
    expect(downloads).toHaveLength(1);
    expect((await stored())?.leases.length).toBe(1);
  } finally {
    await pool.end();
  }
});

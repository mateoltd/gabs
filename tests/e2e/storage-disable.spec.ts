import "dotenv/config";
import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { setupOfflinePolicy } from "../support/offline-policy-fixture";

test.use({ actionTimeout: 10000 });
test("a concurrent saved change prevents disable; successful disable locks other tabs until explicit re-enabling", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const f = await setupOfflinePolicy(page);
  const second = await context.newPage();
  await second.goto("/settings");
  const disable = second.getByRole("button", {
    name: "Disable offline storage",
    exact: true,
  });
  await expect(disable).toBeVisible();
  await expect
    .poll(
      async () => {
        const state = (await f.stored()).state;
        return (
          Object.keys(state.installed).length === 4 &&
          Object.keys(state.lifecycle ?? {}).length === 0
        );
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await context.setOffline(true);
  await expect(second.getByText(/Offline copy from/)).toBeVisible();
  await second.evaluate((scope) => {
    const state = { entered: false, finished: false, release: () => {} };
    const held = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    const request = navigator.locks.request.bind(navigator.locks);
    navigator.locks.request = ((name: string, ...args: unknown[]) => {
      const invoke = () =>
        Reflect.apply(request, navigator.locks, [name, ...args]);
      if (
        name === `suite-snapshot:${scope.userId}:${scope.workspaceId}` &&
        !state.entered
      ) {
        state.entered = true;
        return held.then(invoke).finally(() => {
          state.finished = true;
        });
      }
      return invoke();
    }) as typeof navigator.locks.request;
    (window as unknown as { disabling: typeof state }).disabling = state;
  }, f.scope);
  await disable.click();
  await expect
    .poll(() =>
      second.evaluate(
        () =>
          (window as unknown as { disabling: { entered: boolean } }).disabling
            .entered,
      ),
    )
    .toBe(true);
  await expect(disable).toBeDisabled();
  const original = await f.capture();
  await second.evaluate(() =>
    (
      window as unknown as { disabling: { release(): void } }
    ).disabling.release(),
  );
  await expect(second.getByRole("alert")).toContainText(
    "Resolve pending changes and saved drafts",
  );
  await mkdir("docs/verification/storage-disable", { recursive: true });
  await second.screenshot({
    path: "docs/verification/storage-disable/retained-work.png",
    fullPage: true,
    animations: "disabled",
  });
  expect((await f.stored()).state.journal).toEqual([original]);
  expect((await f.stored()).snapshot.expiresAt).toBeGreaterThan(Date.now());
  await context.setOffline(false);
  await expect
    .poll(async () => (await f.stored()).state.journal[0]?.state, {
      timeout: 30000,
    })
    .toBe("accepted");
  // Reconnection may also resume module installation; it owns retained work too.
  await expect
    .poll(
      async () => Object.keys((await f.stored()).state.lifecycle ?? {}).length,
    )
    .toBe(0);
  await disable.click();
  await expect.poll(async () => (await f.stored()).snapshot).toBeUndefined();
  await expect(
    second.getByRole("button", { name: "Enable on this device", exact: true }),
  ).toBeVisible();
  await expect(second.getByRole("alert")).toHaveCount(0);
  await second.screenshot({
    path: "docs/verification/storage-disable/disabled-storage.png",
    fullPage: true,
    animations: "disabled",
  });
  await f.settings();
  await expect(
    page.getByRole("button", { name: "Enable on this device", exact: true }),
  ).toBeVisible();
  // Authenticated refresh must preserve the device's explicit opt-out.
  await second.reload();
  await expect(
    second.getByRole("button", { name: "Enable on this device", exact: true }),
  ).toBeVisible();
  expect((await f.stored()).snapshot).toBeUndefined();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("Online authorization required", { exact: true }),
  ).toBeVisible();
  expect((await f.stored()).snapshot).toBeUndefined();
  await context.setOffline(false);
  await page.reload();
  await f.settings();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect
    .poll(async () => (await f.stored()).snapshot?.expiresAt)
    .toBeGreaterThan(Date.now());
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Offline copy from/)).toBeVisible();
  await second.close();
});

test("IndexedDB deletion guards late writes, legacy attempts and retained reviews in the same transaction", async ({
  page,
  context,
}) => {
  const helper = await build({
    entryPoints: ["packages/client/src/adapters/browser.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  await context.route("**/storage-disable.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: helper.outputFiles[0].text,
    }),
  );
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/storage-disable.mjs";
    const { browserPlatform: storage } = (await import(
      path
    )) as typeof import("../../packages/client/src/adapters/browser");
    const scope = {
      userId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
    };
    const rejects = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return false;
      } catch {
        return true;
      }
    };
    await storage.save(scope, "snapshot", { expiresAt: 123 });
    await storage.save(scope, "pending", [{ key: "original-online-attempt" }]);
    const pending = await rejects(() => storage.purgeWorkspace(scope));
    const original = await storage.load(scope, "pending");
    await storage.save(scope, "pending", []);
    await storage.save(scope, "module-state", {
      journal: [],
      drafts: {},
      commandReviews: { original: { input: "saved correction" } },
    });
    const review = await rejects(() => storage.purgeWorkspace(scope));
    const retained = await storage.load(scope, "module-state");
    await storage.save(scope, "module-state", {
      journal: [],
      drafts: {},
      pages: {},
      installed: {},
    });
    await storage.purgeWorkspace(scope);
    const snapshot = await storage.load(scope, "snapshot");
    const authority = await storage.load(scope, "workspace-authority");
    const lateSnapshot = await rejects(() =>
      storage.save(scope, "snapshot", { expiresAt: 456 }),
    );
    const lateDraft = await rejects(() =>
      storage.save(scope, "module-state", {
        journal: [],
        drafts: { late: { input: "stale" } },
      }),
    );
    return {
      pending,
      original,
      review,
      retained,
      snapshot,
      authority,
      lateSnapshot,
      lateDraft,
    };
  });
  expect(result).toMatchObject({
    pending: true,
    original: [{ key: "original-online-attempt" }],
    review: true,
    retained: { commandReviews: { original: { input: "saved correction" } } },
    authority: { denied: true, storageDisabled: true },
    lateSnapshot: true,
    lateDraft: true,
  });
  expect(result.snapshot).toBeUndefined();
});

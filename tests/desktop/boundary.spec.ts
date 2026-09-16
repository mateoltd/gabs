import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/desktop/package.json"));
test("native UI keeps tokens and arbitrary capabilities out of its renderer", async () => {
  const profile = await mkdtemp(resolve(tmpdir(), "common-electron-test-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("apps/desktop/dist/main.cjs"), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUITE_DESKTOP_DEV_AUTH: "1",
    },
  });
  try {
    const page = await app.firstWindow();
    expect(
      await page.evaluate(() => window.suiteDesktop!.authStatus()),
    ).toEqual({
      mode: "development",
    });
    await expect(
      page.getByRole("button", { name: "Open local workspace" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open local workspace" }).click();
    await expect(
      page.getByRole("link", { name: "Orders", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Orders", exact: true }),
    ).toBeVisible();
    const boundary = await page.evaluate(() => ({
      node: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      keys: Object.keys(window.suiteDesktop!),
      storage: Object.keys(localStorage),
    }));
    expect(boundary.node).toBe("undefined");
    expect(boundary.process).toBe("undefined");
    expect(boundary.keys).not.toContain("token");
    expect(boundary.storage.every((k) => !/(token|secret)/i.test(k))).toBe(
      true,
    );
    const rejected = await page.evaluate(async () => {
      try {
        await window.suiteDesktop!.execute({
          operation: "shell" as never,
          body: { command: "echo bad" },
        });
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected).toBe(true);

    const artifactBoundary = await page.evaluate(async () => {
      const me = (await window.suiteDesktop!.execute({ operation: "me" }))
        .body as { user: { id: string }; workspaces: { id: string }[] };
      const scope = { userId: me.user.id, workspaceId: me.workspaces[0].id };
      const denied = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return false;
        } catch {
          return true;
        }
      };
      return Promise.all([
        denied(() =>
          window.suiteDesktop!.cacheWrite(
            scope,
            "module-artifact/../../credentials" as never,
            "bad",
          ),
        ),
        denied(() =>
          window.suiteDesktop!.cachePruneArtifacts(scope, ["drafts" as never]),
        ),
        denied(() =>
          window.suiteDesktop!.cachePruneArtifacts(
            { ...scope, userId: "another-user" },
            [],
          ),
        ),
        denied(() =>
          window.suiteDesktop!.cacheWrite(
            scope,
            `module-artifact/${"a".repeat(64)}/0`,
            "x".repeat(2 * 1024 * 1024),
          ),
        ),
      ]);
    });
    expect(artifactBoundary).toEqual([true, true, true, true]);
    const moduleRelease = await page.evaluate(async () => {
      // Use an isolated, provisioned company instead of shared mutable seed data.
      const workspaceId = crypto.randomUUID();
      const created = await window.suiteDesktop!.execute({
        operation: "workspaceCreate",
        body: {
          id: workspaceId,
          name: "Native contract acceptance",
          currency: "EUR",
        },
        idempotencyKey: crypto.randomUUID(),
      });
      if (created.status !== 200)
        throw Error("Could not provision contract fixture");
      const params = { workspaceId, moduleId: "contacts" };
      const stale = await window.suiteDesktop!.execute({
        operation: "moduleRequest",
        params,
        moduleVersion: "0.0.1",
        body: { action: "list", resource: "contacts", input: {} },
      });
      const current = await window.suiteDesktop!.execute({
        operation: "moduleRequest",
        params,
        moduleVersion: "1.1.0",
        body: { action: "list", resource: "contacts", input: {} },
      });
      const policy = async (mandatory: boolean, version: number) =>
        window.suiteDesktop!.execute({
          operation: "platformCommand",
          params: { workspaceId },
          body: {
            action: "rollout",
            version,
            value: {
              moduleId: "inventory",
              version: "1.2.0",
              mandatory,
              acceptedVersions: mandatory ? [] : ["1.1.0"],
            },
          },
          idempotencyKey: crypto.randomUUID(),
        });
      if ((await policy(false, 0)).status !== 200)
        throw Error("Could not accept the native older contract");
      const key = crypto.randomUUID();
      const create = (idempotencyKey: string) =>
        window.suiteDesktop!.execute({
          operation: "moduleOperation",
          params: {
            workspaceId,
            moduleId: "inventory",
            operationName: "create-product",
          },
          moduleVersion: "1.1.0",
          idempotencyKey,
          body: {
            sku: `NATIVE-${key.slice(0, 8)}`,
            name: "Native receipt recovery",
            priceMinor: 100,
          },
        });
      const first = await create(key);
      if ((await policy(true, 1)).status !== 200)
        throw Error("Could not require the native current contract");
      const recovered = await create(key);
      const refused = await create(crypto.randomUUID());
      return {
        stale,
        current,
        first,
        recovered,
        refused,
        security: await window.suiteDesktop!.securityStatus(),
      };
    });
    expect(moduleRelease.stale).toMatchObject({
      status: 409,
      body: { code: "MODULE_UPDATE_REQUIRED" },
    });
    expect(moduleRelease.current.status).toBe(200);
    expect(moduleRelease.first.status).toBe(200);
    expect(moduleRelease.recovered).toMatchObject({
      status: 200,
      body: moduleRelease.first.body,
    });
    expect(moduleRelease.refused).toMatchObject({
      status: 409,
      body: { code: "MODULE_UPDATE_REQUIRED" },
    });
    expect(moduleRelease.security.updateRequired).toBe(false);
    const persisted = await page.evaluate(async () => {
      const me = (await window.suiteDesktop!.execute({ operation: "me" }))
        .body as { user: { id: string }; workspaces: { id: string }[] };
      const scope = { userId: me.user.id, workspaceId: me.workspaces[0].id };
      await window.suiteDesktop!.cacheWrite(scope, "module-state", {
        test: "durable encrypted record",
      });
      const value = await window.suiteDesktop!.cacheRead(scope, "module-state");
      await window.suiteDesktop!.cachePurge(scope);
      return {
        value,
        after: await window.suiteDesktop!.cacheRead(scope, "module-state"),
      };
    });
    expect(persisted.value).toEqual({ test: "durable encrypted record" });
    expect(persisted.after).toBeUndefined();
    await page.evaluate(() => window.open("https://example.org"));
    expect(app.windows()).toHaveLength(1);
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => false;
    });
    expect(
      (await page.evaluate(() => window.suiteDesktop!.securityStatus()))
        .persistentStorage,
    ).toBe(false);
    const storageDenied = await page.evaluate(async () => {
      const result = await window.suiteDesktop!.execute({ operation: "me" });
      const me = result.body as {
        user: { id: string };
        workspaces: { id: string }[];
      };
      try {
        await window.suiteDesktop!.cacheWrite(
          { userId: me.user.id, workspaceId: me.workspaces[0].id },
          "drafts",
          [],
        );
        return false;
      } catch {
        return true;
      }
    });
    expect(storageDenied).toBe(true);
    await page.screenshot({
      path: "test-results/desktop/orders.png",
      fullPage: true,
    });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("an unconfigured desktop explains sign-in setup and cannot enable development auth in production", async () => {
  const profile = await mkdtemp(
    resolve(tmpdir(), "common-electron-unconfigured-"),
  );
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("apps/desktop/dist/main.cjs"), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: "production",
      SUITE_DESKTOP_DEV_AUTH: "1",
    },
  });
  try {
    const page = await app.firstWindow();
    expect(
      await page.evaluate(() => window.suiteDesktop!.authStatus()),
    ).toEqual({
      mode: "unconfigured",
    });
    await expect(
      page.getByText("Desktop sign-in is not configured", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Sign in securely|Open local workspace/,
      }),
    ).toHaveCount(0);
    const loginRejected = await page.evaluate(async () => {
      try {
        await window.suiteDesktop!.login();
        return false;
      } catch {
        return true;
      }
    });
    expect(loginRejected).toBe(true);
    await page.screenshot({
      path: "test-results/desktop/unconfigured.png",
      fullPage: true,
    });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

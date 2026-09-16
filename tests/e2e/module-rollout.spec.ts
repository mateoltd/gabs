import type { ModuleStorage } from "../../packages/platform/src/module-storage";
import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { defineModule, resource, field, Type } from "@suite/module-sdk";
import { signPackage } from "../../packages/module-sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  publishRelease,
} from "../../tooling/registry-review";
import { selectValue } from "./controls.helpers";

test("optional rollout retains an installed contract and mandatory rollout preserves old queued work", async ({
  page,
  context,
}) => {
  const id = `rollout-ui-${randomUUID().slice(0, 8)}`,
    name = `Rollout notes ${id.slice(-8)}`,
    workspace = randomUUID();
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const registry = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    options: "-c role=suite_registry",
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
    const privateKey = await readFile(`${keys}/private.pem`, "utf8"),
      publicKey = await readFile(`${keys}/public.pem`, "utf8");
    for (const version of ["1.0.0", "1.1.0"]) {
      const module = defineModule({
        id,
        name,
        version,
        description: "Rollout acceptance",
        host: "^1.0.0",
        backend: "^1.0.0",
        publisher: "suite",
        dependencies: {},
        permissions: [`${id}.notes.read`, `${id}.notes.write`],
        configuration: Type.Object({}),
        operations: {},
        navigation: { path: `/${id}`, permission: `${id}.notes.read` },
        resources: {
          notes: resource(
            {
              name: field.text(),
              ...(version === "1.1.0"
                ? { category: Type.Optional(field.text()) }
                : {}),
            },
            { title: "Notes" },
          ),
        },
      });
      const submission = await submitRelease(
        registry,
        signPackage(module, privateKey),
        null,
        publicKey,
      );
      await reviewRelease(
        registry,
        submission,
        "approved",
        "Reviewed rollout fixture",
        publicKey,
      );
      await publishRelease(registry, submission, publicKey);
    }
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const headers = {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    };
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers,
          data: {
            id: workspace,
            name: "Client rollout acceptance",
            currency: "EUR",
          },
        })
      ).ok(),
    ).toBeTruthy();
    await admin.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true) on conflict(workspace_id,module_id) do update set active=true",
      [workspace, id],
    );
    await admin.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}') on conflict(workspace_id,module_id) do update set state='enabled'",
      [workspace, id],
    );
    await admin.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1 on conflict do nothing",
      [workspace, id],
    );
    await admin.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and name='Owner'",
      [workspace, [`${id}.notes.read`, `${id}.notes.write`]],
    );
    const initialPin = await page.request.post(
      `/api/v1/workspaces/${workspace}/platform`,
      {
        headers,
        data: {
          action: "pin",
          value: { moduleId: id, version: "1.0.0", mandatory: true },
          version: 0,
        },
      },
    );
    expect(initialPin.ok(), await initialPin.text()).toBeTruthy();
    await page.reload();
    await selectValue(page, "Workspace", workspace);
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
    await expect
      .poll(() =>
        page.evaluate(
          async ({ userId, workspaceId }) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open("suite-offline-v1");
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              return await new Promise<boolean>((resolve, reject) => {
                const request = db
                  .transaction("records")
                  .objectStore("records")
                  .get(`${userId}/${workspaceId}/snapshot`);
                request.onsuccess = () =>
                  resolve(request.result?.expiresAt > Date.now());
                request.onerror = () => reject(request.error);
              });
            } finally {
              db.close();
            }
          },
          { userId: me.user.id, workspaceId: workspace },
        ),
      )
      .toBe(true);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.getByRole("link", { name, exact: true }).click();
    await page.getByRole("button", { name: "New notes", exact: true }).click();
    await expect(page.getByLabel("Category", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/modules");
    const card = page
      .locator(".module-install-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card.getByRole("button", { name: "Configure", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Configure ${name}` });
    await dialog
      .getByLabel("Pinned version (empty follows current release)")
      .fill("1.1.0");
    await dialog
      .getByRole("checkbox", { name: "Require selected release" })
      .uncheck();
    await dialog.getByRole("checkbox", { name: "Accept 1.0.0" }).check();
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/workspaces/${workspace}/platform`) &&
        r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Save update policy" }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(
      dialog.getByRole("button", { name: "Save update policy" }),
    ).toBeEnabled();
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/module-rollout", { recursive: true });
    await page.screenshot({
      path: "docs/verification/module-rollout/optional-policy.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/module-rollout/narrow-policy.png",
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name, exact: true }).click();
    await page.getByRole("button", { name: "New notes", exact: true }).click();
    await expect(page.getByLabel("Category", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await context.setOffline(true);
    await page.getByRole("button", { name: "New notes", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Captured with the old release");
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Pending changes" }),
    ).toBeVisible();
    const journal = () =>
      page.evaluate(
        async ({ userId, workspaceId, moduleId }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("suite-offline-v1");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const state = await new Promise<ModuleStorage>(
              (resolve, reject) => {
                const request = db
                  .transaction("records")
                  .objectStore("records")
                  .get(`${userId}/${workspaceId}/module-state`);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              },
            );
            return state.journal.filter(
              (entry) => entry.call.moduleId === moduleId,
            );
          } finally {
            db.close();
          }
        },
        { userId: me.user.id, workspaceId: workspace, moduleId: id },
      );
    const pending = (await journal())[0];
    expect(pending.state).toBe("pending");
    expect(pending.call.moduleVersion).toBe("1.0.0");
    expect(pending.call.input).toMatchObject({
      data: { name: "Captured with the old release" },
    });
    // Another authorized device makes the update mandatory while this one is disconnected.
    expect(
      (
        await page.request.post(`/api/v1/workspaces/${workspace}/platform`, {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: {
            action: "rollout",
            value: {
              moduleId: id,
              version: "1.1.0",
              mandatory: true,
              acceptedVersions: [],
            },
            version: 2,
          },
        })
      ).ok(),
    ).toBeTruthy();
    await context.setOffline(false);
    await expect(
      page.locator(".module-pending").getByText(/no longer accepted/),
    ).toBeVisible();
    const upgraded = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(`/module/${id}/workspaces/${workspace}/records`) &&
        response.request().headers()["x-module-version"] === "1.1.0" &&
        response.request().postDataJSON()?.action === "list" &&
        response.ok(),
    );
    await page.reload();
    await upgraded;
    await page.getByRole("button", { name: "New notes", exact: true }).click();
    await expect(page.getByLabel("Category", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.locator(".module-pending").getByText(/no longer accepted/),
    ).toBeVisible();
    expect(
      (
        await admin.query(
          "select id from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspace, id],
        )
      ).rows,
    ).toEqual([]);
    await page.locator(".module-pending").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/module-rollout/preserved-conflict.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".module-pending").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/module-rollout/narrow-conflict.png",
    });
    expect((await journal())[0]).toMatchObject({
      id: pending.id,
      state: "conflict",
      call: pending.call,
    });
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Captured with the old release",
    );
    await expect(page.getByLabel("Category", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("cell", {
        name: "Captured with the old release",
        exact: true,
      }),
    ).toBeVisible();
    const recovered = (await journal()).find(
      (entry) => entry.id === pending.id,
    )!;
    expect(recovered.call).toEqual(pending.call);
    expect(recovered.supersededBy).toBeTruthy();
    expect(
      (
        await admin.query(
          "select id from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspace, id],
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    await context.setOffline(false);
    await registry.end();
    await admin.end();
  }
});

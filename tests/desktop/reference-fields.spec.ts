import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  publishReferenceFixture,
  assignReferenceFixture,
  referenceModuleId,
  referenceTargets,
  exerciseReferencePicker,
} from "../support/reference-journey";
const require = createRequire(resolve("apps/desktop/package.json"));

test("native nested reference choices search and page without focusing the desktop", async () => {
  test.setTimeout(120000);
  await publishReferenceFixture();
  const profile = await mkdtemp(resolve(tmpdir(), "common-schema-review-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
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
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 960),
    );
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const workspaceId = randomUUID();
    const created = await page.evaluate(
      (workspaceId) =>
        window.suiteDesktop!.execute({
          operation: "workspaceCreate",
          body: {
            id: workspaceId,
            name: "Native schema acceptance",
            currency: "EUR",
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      workspaceId,
    );
    expect(created.status).toBe(200);
    await assignReferenceFixture(pool, workspaceId);
    for (const input of referenceTargets) {
      const saved = await page.evaluate(
        ({ workspaceId, moduleId, input }) =>
          window.suiteDesktop!.execute({
            operation: "moduleRequest",
            params: { workspaceId, moduleId },
            body: { resource: "targets", action: "create", input },
            idempotencyKey: crypto.randomUUID(),
          }),
        { workspaceId, moduleId: referenceModuleId, input },
      );
      expect(saved.status, JSON.stringify(saved)).toBe(200);
    }
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspaceId}"]`))
      .click();
    await page
      .getByRole("link", { name: "Reference forms", exact: true })
      .click();
    await mkdir("docs/verification/reference-fields", { recursive: true });
    const { dialog } = await exerciseReferencePicker(page);
    await page.screenshot({
      path: "docs/verification/reference-fields/electron-picker.png",
    });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("cell", {
        name: "Nested reference acceptance",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return (
          !window.isFocused() && (!window.isVisible() || window.isMinimized())
        );
      }),
    ).toBe(true);
    await mkdir("docs/verification/reference-fields", { recursive: true });
    await page
      .getByRole("heading", { name: "Reference forms", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/reference-fields/electron.png",
    });
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { require?: unknown }).require,
      ),
    ).toBe("undefined");
  } finally {
    await app.close();
    await pool.end();
    await rm(profile, { recursive: true, force: true });
  }
});

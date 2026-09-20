import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import type { RestorationContext } from "./journey";
import { nativePortabilityDevice, portabilityStorage } from "./devices";
import { storageReplyWorker } from "./storage-reply";
import { selectValue } from "../../e2e/controls.helpers";
import { captureArchive } from "./archives";

export async function promotionLock(
  context: RestorationContext,
  options: {
    device: Awaited<ReturnType<typeof nativePortabilityDevice>>;
    worker: Awaited<ReturnType<typeof storageReplyWorker>>;
    release: "locked" | "unlocked";
  },
) {
  const { page, scope, input } = context;
  if (input.selection !== "request")
    throw Error("Expected the original request.");
  const dialog = () =>
    page.getByRole("dialog", { name: "Imported saved work", exact: true });
  const imported = await portabilityStorage(page, scope);
  const digest = Object.keys(imported.recoveryImports!).find(
    (key) => imported.recoveryImports![key].input.selection === "request",
  )!;
  const bytes = await readFile(context.path);
  await dialog()
    .getByRole("button", { name: "Back to imported copies", exact: true })
    .click();
  await dialog()
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New projects", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Preserved across profile lock");
  await selectValue(page, "Status", "planned");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Preferences", exact: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await page.getByLabel("Device PIN", { exact: true }).fill("12567890");
  await page.getByLabel("Confirm device PIN", { exact: true }).fill("12567890");
  await page
    .getByRole("button", { name: "Enable device unlock", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Update device unlock", exact: true }),
  ).toBeVisible();
  const before = await portabilityStorage(page, scope);
  expect(Object.values(before.drafts)).toContainEqual(
    expect.objectContaining({ name: "Preserved across profile lock" }),
  );
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  const section = () => dialog().locator(`[data-recovery-copy="${digest}"]`);
  await section()
    .getByRole("button", { name: "Restore for review", exact: true })
    .click();
  const pid = await options.device.app.evaluate(() => process.pid);
  await options.worker.arm(
    `${scope.userId}/${scope.workspaceId}/module-state`,
    digest,
    pid,
  );
  await dialog()
    .getByRole("button", { name: "Confirm restoration", exact: true })
    .click();
  await options.worker.arrived(pid);
  // A direct scoped read observes the real committed state despite its held write reply.
  const committed = await portabilityStorage(page, scope);
  const receipt = committed.recoveryImports![digest].promotion;
  expect(receipt).toMatchObject({
    requestId: input.entry.id,
    outcome: "cancelled",
  });
  expect(committed.recoveryImports![digest].input).toEqual(input);
  for (const [key, value] of Object.entries(before.recoveryImports!))
    if (key !== digest) expect(committed.recoveryImports![key]).toEqual(value);
  expect(committed.drafts).toEqual(before.drafts);
  expect(
    committed.journal.filter((entry) => entry.id === input.entry.id),
  ).toHaveLength(1);
  expect(
    committed.journal.find((entry) => entry.id === input.entry.id),
  ).toMatchObject({
    call: input.entry.call,
    state: "rejected",
    settlement: "cancelled",
  });
  await page.evaluate(() => window.suiteDesktop!.lockProfile());
  await expect(
    page.getByRole("heading", { name: "Unlock your profile", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(async (scope) => {
      try {
        await window.suiteDesktop!.cacheRead(scope, "module-state");
        return true;
      } catch {
        return false;
      }
    }, scope),
  ).toBe(false);
  await expect(dialog()).not.toBeVisible();
  const releaseReply = async () => {
    await options.worker.release();
    // Wait for the original promotion to leave its real scoped synchronization lock.
    await expect
      .poll(() =>
        page.evaluate(
          async (name) =>
            (await navigator.locks.query()).held?.some(
              (lock) => lock.name === name,
            ) ?? false,
          `suite-sync:${scope.userId}:${scope.workspaceId}`,
        ),
      )
      .toBe(false);
  };
  if (options.release === "locked") await releaseReply();
  await page
    .getByRole("main")
    .getByLabel("Device PIN", { exact: true })
    .fill("12567890");
  await page
    .getByRole("button", { name: "Unlock with PIN", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unlock your profile", exact: true }),
  ).toHaveCount(0);
  if (options.release === "unlocked") await releaseReply();
  await expect(dialog()).toBeVisible();
  const refresh = dialog().getByRole("button", {
    name: "Refresh imported copies",
    exact: true,
  });
  await expect(refresh).toBeEnabled();
  await expect(dialog()).not.toContainText("Saved work restored for review.");
  await refresh.click();
  await expect(section()).toContainText(
    "Restored. The imported copy is retained separately.",
  );
  await expect(refresh).toBeEnabled();
  const after = await portabilityStorage(page, scope);
  expect(after.recoveryImports).toEqual(committed.recoveryImports);
  expect(after.journal).toEqual(committed.journal);
  expect(after.drafts).toEqual(committed.drafts);
  expect(await readFile(context.path)).toEqual(bytes);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    expect(
      (
        await pool.query(
          "select action from suite.audit where workspace_id=$1 and target_id=$2",
          [scope.workspaceId, input.entry.id],
        )
      ).rows,
    ).toEqual([{ action: "module.attempt.cancel" }]);
  } finally {
    await pool.end();
  }
  await captureArchive(page, `native-promotion-lock-${options.release}`, false);
  return page;
}

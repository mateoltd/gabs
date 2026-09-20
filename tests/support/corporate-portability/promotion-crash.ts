import { expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { selectValue } from "../../e2e/controls.helpers";
import type { RestorationContext } from "./journey";
import type { StorageCrash, storageCrashWorker } from "./storage-crash";
import { nativePortabilityDevice, portabilityStorage } from "./devices";
import { captureArchive } from "./archives";
type NativeDevice = Awaited<ReturnType<typeof nativePortabilityDevice>>;

export async function promotionCrash(
  context: RestorationContext,
  options: {
    crash: StorageCrash;
    worker: Awaited<ReturnType<typeof storageCrashWorker>>;
    device: NativeDevice;
    restart(): Promise<NativeDevice>;
  },
) {
  let page = context.page;
  const { scope, input } = context;
  const dialog = () =>
    page.getByRole("dialog", { name: "Imported saved work", exact: true });
  const confirm = () =>
    dialog().getByRole("button", { name: "Confirm restoration", exact: true });
  const settings = async () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  const copy = Object.entries(
    (await portabilityStorage(page, scope)).recoveryImports ?? {},
  ).find(([, copy]) => copy.input.selection === input.selection);
  expect(copy).toBeDefined();
  const digest = copy![0];
  expect(copy![1].input).toEqual(input);
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
    .fill("Unrelated destination draft");
  await selectValue(page, "Status", "planned");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await settings();
  await expect
    .poll(async () =>
      Object.values((await portabilityStorage(page, scope)).drafts),
    )
    .toContainEqual(
      expect.objectContaining({ name: "Unrelated destination draft" }),
    );
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  const section = () => dialog().locator(`[data-recovery-copy="${digest}"]`);
  await section()
    .getByRole("button", { name: "Restore for review", exact: true })
    .click();
  const before = await portabilityStorage(page, scope);
  const child = options.device.app.process();
  const mainPid = await options.device.app.evaluate(() => process.pid);
  await writeFile(
    options.worker.arm,
    JSON.stringify({
      key: `${scope.userId}/${scope.workspaceId}/module-state`,
      mainPid,
      promotion: digest,
    }),
  );
  await confirm()
    .click()
    .catch(() => {});
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await readFile(options.worker.marker, "utf8"));
      } catch {
        return undefined;
      }
    })
    .toMatchObject({ ...options.crash, parent: mainPid });
  const marker = JSON.parse(await readFile(options.worker.marker, "utf8")) as {
    pid: number;
  };
  await expect
    .poll(() => {
      try {
        process.kill(marker.pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        return false;
      }
    })
    .toBe(false);
  if (options.crash.target === "main")
    await expect.poll(() => child.signalCode).toBe("SIGKILL");
  else {
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    await expect(dialog().getByRole("alert")).toContainText(
      "Protected storage",
    );
    await expect(dialog()).not.toContainText("Saved work restored for review.");
  }
  const audit = async () => {
    if (!input.entry) return;
    const pool = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    try {
      const result = await pool.query(
        "select action from suite.audit where workspace_id=$1 and target_id=$2",
        [scope.workspaceId, input.entry.id],
      );
      expect(result.rows).toEqual([{ action: "module.attempt.cancel" }]);
    } finally {
      await pool.end();
    }
  };
  await audit(); // Server cancellation is durable even when no local promotion was acknowledged.
  const restarted = await options.restart();
  page = restarted.page;
  await selectValue(page, "Workspace", scope.workspaceId);
  await settings();
  const enable = page.getByRole("button", {
    name: "Enable on this device",
    exact: true,
  });
  const disable = page.getByRole("button", {
    name: "Disable offline storage",
    exact: true,
  });
  await expect(enable.or(disable)).toBeVisible();
  if (await enable.isVisible()) await enable.click();
  await expect(disable).toBeVisible();
  const after = await portabilityStorage(page, scope);
  expect(after.recoveryImports![digest].input).toEqual(input);
  for (const [key, value] of Object.entries(before.recoveryImports!))
    if (key !== digest) expect(after.recoveryImports![key]).toEqual(value);
  for (const [key, value] of Object.entries(before.drafts))
    expect(after.drafts[key]).toEqual(value);
  for (const entry of before.journal)
    expect(after.journal.find((item) => item.id === entry.id)).toEqual(entry);
  const receipt = after.recoveryImports![digest].promotion;
  if (options.crash.phase === "before") {
    expect(receipt).toBeUndefined();
    expect(after.drafts).toEqual(before.drafts);
    expect(after.journal).toEqual(before.journal);
  } else {
    expect(receipt).toBeDefined();
    if (input.selection === "request") {
      expect(receipt).toMatchObject({
        requestId: input.entry.id,
        outcome: "cancelled",
      });
      const restored = after.journal.filter(
        (entry) => entry.id === input.entry.id,
      );
      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({
        call: input.entry.call,
        dependencies: input.entry.dependencies,
        state: "rejected",
        settlement: "cancelled",
      });
    } else {
      expect(receipt!.draftKey).toBeTruthy();
      expect(after.drafts[receipt!.draftKey!]).toEqual(input.data);
      expect(after.draftReviews![receipt!.draftKey!]).toBeDefined();
    }
  }
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  if (options.crash.phase === "before") {
    await section()
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    await confirm().click();
  }
  await expect(section()).toContainText(
    "Restored. The imported copy is retained separately.",
  );
  await expect(
    dialog().getByRole("button", {
      name: "Refresh imported copies",
      exact: true,
    }),
  ).toBeEnabled();
  const restored = await portabilityStorage(page, scope);
  if (receipt)
    expect(restored.recoveryImports![digest].promotion).toEqual(receipt);
  await dialog()
    .getByLabel("Saved-work recovery file", { exact: true })
    .setInputFiles(context.path);
  await expect(dialog()).toContainText(
    "This copy is already saved. Existing work was preserved.",
  );
  const repeated = await portabilityStorage(page, scope);
  expect(repeated.recoveryImports).toEqual(restored.recoveryImports);
  expect(repeated.journal).toEqual(restored.journal);
  expect(repeated.drafts).toEqual(restored.drafts);
  expect(await readFile(context.path)).toEqual(bytes);
  await audit();
  await captureArchive(
    page,
    `native-promotion-${input.selection}-${options.crash.target}-${options.crash.phase}`,
    false,
  );
  return page;
}

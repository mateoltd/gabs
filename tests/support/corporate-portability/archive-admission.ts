import { expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { openSavedWorkArchive } from "../../../packages/client/src/recovery/archive";
import { selectValue } from "../../e2e/controls.helpers";
import type { ArchiveReviewContext } from "./archive-lifecycle";
import type { StorageCrash, storageCrashWorker } from "./storage-crash";
import { captureArchive } from "./archives";
import { nativePortabilityDevice, portabilityStorage } from "./devices";

type NativeDevice = Awaited<ReturnType<typeof nativePortabilityDevice>>;

export async function archiveAdmission(
  context: ArchiveReviewContext,
  options: {
    crash: StorageCrash;
    worker: Awaited<ReturnType<typeof storageCrashWorker>>;
    device: NativeDevice;
    restart(): Promise<NativeDevice>;
  },
) {
  const { scope, file, passphrase } = context;
  let page = context.page;
  const decoded = await openSavedWorkArchive(
    file.bytes.toString(),
    passphrase,
    scope,
    () => {},
  );
  const archive = () =>
    page.getByRole("dialog", { name: "Saved-work archives", exact: true });
  const button = () =>
    archive().getByRole("button", {
      name: "Import selected copies",
      exact: true,
    });
  const select = async () => {
    await expect(archive().getByRole("checkbox")).toHaveCount(2);
    for (const checkbox of await archive().getByRole("checkbox").all())
      await checkbox.check();
  };
  const close = async () => {
    await archive()
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  };
  const open = async () => {
    await page
      .getByRole("button", { name: "Saved-work archives", exact: true })
      .click();
    await expect(archive().getByRole("checkbox")).toHaveCount(0);
    await expect(
      archive().getByLabel("Archive passphrase", { exact: true }),
    ).toHaveValue("");
    await archive()
      .getByRole("button", { name: "Open archive", exact: true })
      .click();
    await archive()
      .getByLabel("Encrypted saved-work archive", { exact: true })
      .setInputFiles(file.path);
    await archive()
      .getByLabel("Archive passphrase", { exact: true })
      .fill(passphrase);
    await archive()
      .getByRole("button", { name: "Unlock archive", exact: true })
      .click();
    await expect(archive().getByRole("checkbox")).toHaveCount(2);
  };
  await close();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New projects", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Existing destination project draft");
  await selectValue(page, "Status", "planned");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Preferences", exact: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect
    .poll(async () =>
      Object.values((await portabilityStorage(page, scope)).drafts),
    )
    .toContainEqual(
      expect.objectContaining({ name: "Existing destination project draft" }),
    );
  const before = await portabilityStorage(page, scope);
  await open();
  const child = options.device.app.process();
  const mainPid = await options.device.app.evaluate(() => process.pid);
  expect(
    await options.device.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(
        (window) =>
          !window.isFocused() && (!window.isVisible() || window.isMinimized()),
      ),
    ),
  ).toBe(true);
  await writeFile(
    options.worker.arm,
    JSON.stringify({
      key: `${scope.userId}/${scope.workspaceId}/module-state`,
      mainPid,
    }),
  );
  await select();
  await button()
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
  if (options.crash.target === "main") {
    await expect.poll(() => child.signalCode).toBe("SIGKILL");
  } else {
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    await expect(archive().getByRole("alert")).toContainText(
      "Protected storage",
    );
    await expect(archive()).not.toContainText("copies imported for review");
    await captureArchive(
      page,
      `native-admission-utility-${options.crash.phase}-failed`,
    );
  }
  expect(await readFile(file.path)).toEqual(file.bytes);

  const restarted = await options.restart();
  page = restarted.page;
  await selectValue(page, "Workspace", scope.workspaceId);
  await page
    .getByRole("navigation", { name: "Preferences", exact: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
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
  expect(after.journal).toEqual(before.journal);
  expect(after.drafts).toEqual(before.drafts);
  expect(after.draftVersions).toEqual(before.draftVersions);
  const retained = after.recoveryImports ?? {};
  expect(Object.keys(retained)).toHaveLength(
    options.crash.phase === "committed" ? 2 : 0,
  );
  if (options.crash.phase === "committed") {
    expect(Object.values(retained).map((copy) => copy.input)).toEqual(
      expect.arrayContaining(decoded.copies),
    );
    for (const copy of Object.values(retained))
      expect(copy).toEqual({
        input: copy.input,
        receivedAt: expect.any(Number),
      });
  }
  await open();
  await select();
  await button().click();
  await expect(archive()).toContainText(
    `${options.crash.phase === "committed" ? 0 : 2} copies imported for review.`,
  );
  const imported = (await portabilityStorage(page, scope)).recoveryImports;
  expect(Object.keys(imported ?? {})).toHaveLength(2);
  if (options.crash.phase === "committed") expect(imported).toEqual(retained);
  await select();
  await button().click();
  await expect(archive()).toContainText("0 copies imported for review.");
  expect((await portabilityStorage(page, scope)).recoveryImports).toEqual(
    imported,
  );
  await captureArchive(
    page,
    `native-admission-${options.crash.target}-${options.crash.phase}-recovered`,
  );
  await close();

  // Explicitly remove only the inert copies, then continue the shared restoration journey.
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Imported saved work",
    exact: true,
  });
  for (let count = 2; count > 0; count--) {
    const remove = review.getByRole("button", {
      name: "Remove imported copy",
      exact: true,
    });
    await expect(remove).toHaveCount(count);
    await remove.first().click();
    await review
      .getByRole("button", { name: "Confirm removal", exact: true })
      .click();
    await expect(
      review.getByRole("button", {
        name: "Refresh imported copies",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(remove).toHaveCount(count - 1);
  }
  await review
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const cleared = await portabilityStorage(page, scope);
  expect(cleared.recoveryImports ?? {}).toEqual({});
  expect(cleared.journal).toEqual(before.journal);
  expect(cleared.drafts).toEqual(before.drafts);
  expect(await readFile(file.path)).toEqual(file.bytes);
  await open();
  return page;
}

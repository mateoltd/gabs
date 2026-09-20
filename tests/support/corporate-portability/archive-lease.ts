import { expect, type ElectronApplication } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { ArchiveReviewContext } from "./archive-lifecycle";
import { portabilityStorage } from "./devices";
import { openSavedWorkArchive } from "../../../packages/client/src/recovery/archive";

/** Advance the real corporate lease guards, preserving the actual captured work. */
export async function archiveLease(
  context: ArchiveReviewContext,
  options: { surface: string; app?: ElectronApplication },
) {
  const { page, scope, file, passphrase } = context;
  const before = await portabilityStorage(page, scope);
  const decoded = await openSavedWorkArchive(
    file.bytes.toString(),
    passphrase,
    scope,
    () => {},
  );
  const first = decoded.copies[0];
  const handle = options.app
    ? await page.evaluate(
        ({ scope, first }) =>
          window.suiteDesktop!.openModuleHost(
            scope,
            first.moduleId,
            first.moduleVersion,
          ),
        { scope, first },
      )
    : undefined;
  const archive = page.getByRole("dialog", {
    name: "Saved-work archives",
    exact: true,
  });
  await expect(archive.getByRole("checkbox")).toHaveCount(2);
  await archive
    .getByLabel("Archive passphrase", { exact: true })
    .fill(passphrase);
  await archive
    .getByLabel("Confirm archive passphrase", { exact: true })
    .fill(passphrase);
  await expect(
    archive.getByRole("button", {
      name: "Save encrypted archive",
      exact: true,
    }),
  ).toBeEnabled();

  await page.clock.install();
  if (options.app)
    await options.app.evaluate(() => {
      const real = Date.now;
      Date.now = () => real() + 25 * 3600000;
    });
  // Main must reject an expired lease even while the renderer still shows its old access.
  if (options.app && handle) {
    await expect(archive).toBeVisible();
    const rejectedPath = `${file.path}.expired`;
    await options.app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, rejectedPath);
    const result = await page.evaluate(
      async ({ handle, decoded, passphrase }) => {
        try {
          await window.suiteDesktop!.exportWorkArchive(
            handle,
            JSON.stringify(decoded),
            passphrase,
          );
          return { accepted: true, error: "" };
        } catch (error) {
          return { accepted: false, error: String(error) };
        }
      },
      { handle, decoded, passphrase },
    );
    expect(result.accepted, result.error).toBe(false);
    await expect(readFile(rejectedPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
  await page.clock.fastForward(25 * 3600000);
  await expect(
    page.getByRole("heading", {
      name: "Online authorization required",
      exact: true,
    }),
  ).toBeVisible();
  await expect(archive).toHaveCount(0);
  await expect(
    page.getByText("Portable queued contact", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Archive passphrase", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save encrypted archive", exact: true }),
  ).toHaveCount(0);

  const after = await portabilityStorage(page, scope);
  expect(after.journal).toEqual(before.journal);
  expect(after.drafts).toEqual(before.drafts);
  expect(after.draftVersions).toEqual(before.draftVersions);
  expect(await readFile(file.path)).toEqual(file.bytes);
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(!!options.app)
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const path = resolve(
    "docs/verification/corporate-work-archives",
    `${options.surface}-lease-expired`,
  );
  await page.screenshot({ path: `${path}.png`, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${path}-narrow.png`, animations: "disabled" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

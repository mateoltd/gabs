import "dotenv/config";
import { expect, type Page, type Locator } from "@playwright/test";
import { Pool } from "pg";
import { portabilityStorage } from "./devices";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openSavedWorkArchive } from "../../../packages/client/src/recovery/archive";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";

const passphrase = "portable archive acceptance passphrase";
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Saved-work archives", exact: true });
async function capture(page: Page, name: string) {
  const directory = resolve("docs/verification/corporate-work-archives");
  await mkdir(directory, { recursive: true });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(await page.evaluate(() => !!window.suiteDesktop))
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: resolve(directory, `${name}.png`),
    animations: "disabled",
  });
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog(page).getByRole("checkbox").first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(directory, `${name}-narrow.png`),
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize(viewport);
}

export async function exportArchive(options: {
  page: Page;
  directory: string;
  evidenceName: string;
  expected: SavedWorkRecovery[];
  exportFile(button: Locator, path: string): Promise<void>;
}) {
  const { page } = options;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Saved-work archives", exact: true })
    .click();
  const archive = dialog(page);
  await archive
    .getByRole("button", { name: "Load saved work", exact: true })
    .click();
  await expect(archive.getByRole("checkbox")).toHaveCount(2);
  for (const checkbox of await archive.getByRole("checkbox").all())
    await checkbox.check();
  await archive
    .getByLabel("Archive passphrase", { exact: true })
    .fill(passphrase);
  await archive
    .getByLabel("Confirm archive passphrase", { exact: true })
    .fill(passphrase);
  await capture(page, `${options.evidenceName}-export`);
  const path = resolve(options.directory, "corporate-archive.json");
  await options.exportFile(
    archive.getByRole("button", {
      name: "Save encrypted archive",
      exact: true,
    }),
    path,
  );
  const bytes = await readFile(path);
  const decoded = await openSavedWorkArchive(
    bytes.toString(),
    passphrase,
    options.expected[0],
    () => {},
  );
  expect(decoded.copies).toEqual(options.expected);
  expect(bytes.toString()).not.toContain("Portable queued contact");
  expect(bytes.toString()).not.toContain(options.expected[0].userId);
  await expect(
    archive.getByLabel("Archive passphrase", { exact: true }),
  ).toHaveValue("");
  return { path, bytes };
}

export async function importArchive(options: {
  page: Page;
  file: { path: string; bytes: Buffer };
  evidenceName: string;
  scope: { userId: string; workspaceId: string };
}) {
  const { page } = options;
  await page
    .getByRole("button", { name: "Saved-work archives", exact: true })
    .click();
  const archive = dialog(page);
  await archive
    .getByRole("button", { name: "Open archive", exact: true })
    .click();
  const picker = archive.getByLabel("Encrypted saved-work archive", {
    exact: true,
  });
  const secret = archive.getByLabel("Archive passphrase", { exact: true });
  const unlock = archive.getByRole("button", {
    name: "Unlock archive",
    exact: true,
  });
  await picker.setInputFiles(options.file.path);
  await secret.fill("wrong but sufficiently long passphrase");
  await unlock.click();
  await expect(archive.getByRole("alert")).toContainText(
    "could not be unlocked",
  );
  await expect(archive.getByRole("checkbox")).toHaveCount(0);
  const corrupted = JSON.parse(options.file.bytes.toString());
  corrupted.ciphertext =
    (corrupted.ciphertext[0] === "A" ? "B" : "A") +
    corrupted.ciphertext.slice(1);
  const bad = `${options.file.path}.tampered.json`;
  await writeFile(bad, JSON.stringify(corrupted));
  await picker.setInputFiles(bad);
  await secret.fill(passphrase);
  await unlock.click();
  await expect(archive.getByRole("alert")).toContainText(
    "could not be unlocked",
  );
  await picker.setInputFiles(options.file.path);
  await secret.fill(passphrase);
  await unlock.click();
  await expect(archive.getByRole("checkbox")).toHaveCount(2);
  const admit = archive.getByRole("button", {
    name: "Import selected copies",
    exact: true,
  });
  await expect(admit).toBeDisabled();
  await archive
    .getByRole("checkbox", { name: /Contacts: saved request/ })
    .check();
  await capture(page, `${options.evidenceName}-import`);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,'contacts.contacts.write') where workspace_id=$1",
      [options.scope.workspaceId],
    );
    await expect(archive.getByRole("checkbox")).toHaveCount(0);
    await expect(admit).toHaveCount(0);
    expect(
      (await portabilityStorage(page, options.scope)).recoveryImports ?? {},
    ).toEqual({});
  } finally {
    await pool.query(
      "update suite.roles set permissions=array_append(permissions,'contacts.contacts.write') where workspace_id=$1 and not ('contacts.contacts.write'=any(permissions))",
      [options.scope.workspaceId],
    );
    await pool.end();
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Saved-work archives", exact: true })
    .click();
  await archive
    .getByRole("button", { name: "Open archive", exact: true })
    .click();
  await picker.setInputFiles(options.file.path);
  await secret.fill(passphrase);
  await unlock.click();
  await expect(archive.getByRole("checkbox")).toHaveCount(2);
  await archive
    .getByRole("checkbox", { name: /Contacts: saved request/ })
    .check();
  await admit.click();
  await expect(archive.getByRole("status")).toContainText("1 copy imported");
  // Exact replay and a second selection keep the original encrypted file and first import.
  await archive
    .getByRole("checkbox", { name: /Contacts: saved request/ })
    .check();
  await admit.click();
  await expect(archive.getByRole("status")).toContainText("0 copies imported");
  await archive
    .getByRole("checkbox", { name: /Contacts: saved draft/ })
    .check();
  await admit.click();
  await expect(archive.getByRole("status")).toContainText("1 copy imported");
  expect(await readFile(options.file.path)).toEqual(options.file.bytes);
  await archive
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.reload();
}

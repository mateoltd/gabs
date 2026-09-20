import { expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import type { Scope } from "../../../packages/client/src";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import {
  openSavedWorkArchive,
  savedWorkFingerprint,
} from "../../../packages/client/src/recovery/archive";
import { selectValue } from "../../e2e/controls.helpers";
import { portabilityStorage } from "./devices";
import { captureArchive } from "./archives";

/** Re-export real retained reviews with another module's draft into a third empty device. */
export async function mixedArchiveJourney(options: {
  page: Page;
  scope: Scope;
  moduleId: string;
  retained: SavedWorkRecovery;
  directory: string;
  surface: string;
  pool: Pool;
  exportFile(button: Locator, path: string): Promise<void>;
  replaceDevice(): Promise<Page>;
}) {
  let page = options.page;
  const { scope } = options;
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  const close = async () => {
    while (await page.getByRole("dialog").count()) {
      const count = await page.getByRole("dialog").count();
      await page
        .getByRole("dialog")
        .last()
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(count - 1);
    }
  };
  const effects = async () =>
    (
      await options.pool.query(
        "select module_id, resource, id, data from suite.module_records where workspace_id=$1 order by module_id,resource,id",
        [scope.workspaceId],
      )
    ).rows;
  const baseline = await effects();
  await close();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Mixed archive contact draft");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  await close();
  const source = await portabilityStorage(page, scope);
  const retained = Object.values(source.recoveryImports ?? {});
  expect(retained.length).toBeGreaterThan(2);
  expect(retained.some((copy) => copy.promotion)).toBe(true);
  expect(retained.map((copy) => copy.input)).toContainEqual(options.retained);
  expect(retained.some((copy) => copy.input.review)).toBe(true);
  await settings();
  await page
    .getByRole("button", { name: "Saved-work archives", exact: true })
    .click();
  let archive = page.getByRole("dialog", {
    name: "Saved-work archives",
    exact: true,
  });
  await archive
    .getByRole("button", { name: "Load saved work", exact: true })
    .click();
  await expect(
    archive.getByRole("checkbox", { name: /Contacts: saved draft/ }),
  ).toHaveCount(1);
  await expect(archive.getByText(/saved items are unavailable/)).toHaveCount(0);
  for (const checkbox of await archive.getByRole("checkbox").all())
    await checkbox.check();
  const passphrase = "mixed module retained archive acceptance";
  await archive
    .getByLabel("Archive passphrase", { exact: true })
    .fill(passphrase);
  await archive
    .getByLabel("Confirm archive passphrase", { exact: true })
    .fill(passphrase);
  await captureArchive(page, `${options.surface}-mixed-export`);
  const path = resolve(options.directory, "mixed-retained-archive.json");
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
    scope,
    () => {},
  );
  expect(new Set(decoded.copies.map((copy) => copy.moduleId))).toEqual(
    new Set([options.moduleId, "contacts"]),
  );
  for (const copy of retained)
    expect(decoded.copies).toContainEqual(copy.input);
  for (const copy of decoded.copies)
    expect(copy).not.toHaveProperty("promotion");
  const draft = decoded.copies.find(
    (copy) => copy.moduleId === "contacts" && copy.selection === "draft",
  )!;
  expect(draft).toMatchObject({
    data: { name: "Mixed archive contact draft" },
  });
  const originalDigest = await savedWorkFingerprint(options.retained);
  const draftDigest = await savedWorkFingerprint(draft);
  const digests = await Promise.all(decoded.copies.map(savedWorkFingerprint));
  expect(new Set(digests).size).toBe(decoded.copies.length);
  expect(await effects()).toEqual(baseline);

  page = await options.replaceDevice();
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await settings();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  expect(
    (await portabilityStorage(page, scope))?.recoveryImports ?? {},
  ).toEqual({});
  const unlock = async () => {
    await page
      .getByRole("button", { name: "Saved-work archives", exact: true })
      .click();
    const opened = page.getByRole("dialog", {
      name: "Saved-work archives",
      exact: true,
    });
    await opened
      .getByRole("button", { name: "Open archive", exact: true })
      .click();
    await opened
      .getByLabel("Encrypted saved-work archive", { exact: true })
      .setInputFiles(path);
    await opened
      .getByLabel("Archive passphrase", { exact: true })
      .fill(passphrase);
    await opened
      .getByRole("button", { name: "Unlock archive", exact: true })
      .click();
    return opened;
  };
  const deniedRoles = await options.pool.query<{ id: string }>(
    "update suite.roles set permissions=array_remove(permissions,'contacts.contacts.write') where workspace_id=$1 and 'contacts.contacts.write'=any(permissions) returning id",
    [scope.workspaceId],
  );
  expect(deniedRoles.rowCount).toBeGreaterThan(0);
  try {
    await page.reload();
    archive = await unlock();
    await expect(archive.getByRole("checkbox")).toHaveCount(
      decoded.copies.length - 1,
    );
    await expect(
      archive.getByRole("checkbox", { name: /Contacts:/ }),
    ).toHaveCount(0);
    await expect(archive).toContainText("1 saved items are unavailable");
    expect(
      (await portabilityStorage(page, scope))?.recoveryImports ?? {},
    ).toEqual({});
  } finally {
    await options.pool.query(
      "update suite.roles set permissions=array_append(permissions,'contacts.contacts.write') where id=any($1::uuid[]) and not ('contacts.contacts.write'=any(permissions))",
      [deniedRoles.rows.map((role) => role.id)],
    );
  }
  await close();
  await page.reload();
  archive = await unlock();
  await expect(archive.getByRole("checkbox")).toHaveCount(
    decoded.copies.length,
  );
  const admit = archive.getByRole("button", {
    name: "Import selected copies",
    exact: true,
  });
  await expect(admit).toBeDisabled();
  for (const checkbox of await archive.getByRole("checkbox").all()) {
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
  }
  await captureArchive(page, `${options.surface}-mixed-import`);
  await admit.click();
  await expect(archive.getByRole("status")).toContainText(
    `${decoded.copies.length} copies imported for review`,
  );
  await close();
  await page.reload();
  const stored = await portabilityStorage(page, scope);
  expect(stored.journal).toEqual([]);
  expect(stored.drafts).toEqual({});
  expect(Object.keys(stored.recoveryImports!).sort()).toEqual(digests.sort());
  for (const copy of decoded.copies) {
    const admitted = stored.recoveryImports![await savedWorkFingerprint(copy)];
    expect(admitted.input).toEqual(copy);
    expect(admitted.promotion).toBeUndefined();
  }
  expect(await effects()).toEqual(baseline);
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  const imported = page.getByRole("dialog", {
    name: "Imported saved work",
    exact: true,
  });
  for (const digest of [originalDigest, draftDigest]) {
    const copy = imported.locator(`[data-recovery-copy="${digest}"]`);
    await copy
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    await imported
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click();
    await expect(copy).toContainText(
      "Restored. The imported copy is retained separately.",
    );
    await expect(
      imported.getByRole("button", {
        name: "Refresh imported copies",
        exact: true,
      }),
    ).toBeEnabled();
  }
  const restored = await portabilityStorage(page, scope);
  expect(restored.journal).toHaveLength(1);
  if (options.retained.selection !== "request")
    throw Error("Expected retained command input");
  expect(restored.journal[0].call).toEqual(options.retained.entry.call);
  expect(restored.journal[0].settlement).toBe("cancelled");
  expect(restored.journal[0].createRecovery).toEqual(
    options.retained.entry.createRecovery,
  );
  expect(await effects()).toEqual(baseline);
  await close();
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Mixed archive contact draft",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("cell", {
      name: "Mixed archive contact draft",
      exact: true,
    }),
  ).toBeVisible();
  const final = await effects();
  expect(final.filter((row) => row.module_id === options.moduleId)).toEqual(
    baseline,
  );
  expect(final.filter((row) => row.module_id === "contacts")).toHaveLength(1);
  expect(await readFile(path)).toEqual(bytes);
}

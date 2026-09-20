import { expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ArchiveReviewContext } from "./archive-lifecycle";
import { selectValue } from "../../e2e/controls.helpers";
import { portabilityStorage } from "./devices";
import { captureArchive } from "./archives";

/** Changing the active workspace never carries decrypted previews or archive authority across. */
export async function archiveWorkspace(
  context: ArchiveReviewContext,
  options: { api: APIRequestContext; surface: string },
) {
  const { page, scope, file, passphrase } = context;
  const me = await (await options.api.get("/api/v1/me")).json();
  const other = { userId: scope.userId, workspaceId: randomUUID() };
  const created = await options.api.post("/api/v1/workspaces", {
    headers: {
      origin: "http://localhost:4300",
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    },
    data: {
      id: other.workspaceId,
      name: "Separate archive workspace",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const archive = () =>
    page.getByRole("dialog", { name: "Saved-work archives", exact: true });
  await archive().getByRole("checkbox").first().check();
  await archive()
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.reload();
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  await selectValue(page, "Workspace", other.workspaceId);
  await settings();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
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
    await expect(
      archive().getByText("corporate-archive.json", { exact: true }),
    ).toHaveCount(0);
    await archive()
      .getByLabel("Encrypted saved-work archive", { exact: true })
      .setInputFiles(file.path);
    await archive()
      .getByLabel("Archive passphrase", { exact: true })
      .fill(passphrase);
    await archive()
      .getByRole("button", { name: "Unlock archive", exact: true })
      .click();
  };
  await open();
  await expect(archive().getByRole("alert")).toContainText(
    "another account or workspace",
  );
  await expect(archive().getByRole("checkbox")).toHaveCount(0);
  await expect(
    archive().getByLabel("Archive passphrase", { exact: true }),
  ).toHaveValue("");
  const unchanged = async () => {
    for (const current of [scope, other]) {
      const stored = await portabilityStorage(page, current);
      expect(stored?.recoveryImports ?? {}).toEqual({});
      expect(stored?.journal ?? []).toEqual([]);
      expect(stored?.drafts ?? {}).toEqual({});
    }
    expect(await readFile(file.path)).toEqual(file.bytes);
  };
  await unchanged();
  await captureArchive(page, `${options.surface}-workspace-denied`, false);
  await archive()
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await selectValue(page, "Workspace", scope.workspaceId);
  await settings();
  await open();
  await expect(archive().getByRole("checkbox")).toHaveCount(2);
  for (const checkbox of await archive().getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked();
  await unchanged();
  return page;
}

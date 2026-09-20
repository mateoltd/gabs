import { expect, type ElectronApplication } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { operations } from "../../../packages/client/src/api";
import type { ArchiveReviewContext } from "./archive-lifecycle";
import { holdArchiveAuthority } from "./archive-lifecycle";
import { selectValue } from "../../e2e/controls.helpers";
import { portabilityStorage } from "./devices";
import { captureArchive } from "./archives";
import { openSavedWorkArchive } from "../../../packages/client/src/recovery/archive";

type Identity =
  operations["me"]["responses"][200]["content"]["application/json"];

/** Account changes invalidate in-flight admission and require a fresh scoped unlock. */
export async function archiveProfile(
  context: ArchiveReviewContext,
  options: { surface: string; app?: ElectronApplication },
) {
  const { page, scope, file, passphrase } = context;
  const nativeArchive = options.app
    ? await openSavedWorkArchive(
        file.bytes.toString(),
        passphrase,
        scope,
        () => {},
      )
    : undefined;
  const nativeHandle = nativeArchive
    ? await page.evaluate(
        ({ scope, first }) =>
          window.suiteDesktop!.openModuleHost(
            scope,
            first.moduleId,
            first.moduleVersion,
          ),
        { scope, first: nativeArchive.copies[0] },
      )
    : undefined;
  const identity = async (): Promise<Identity> => {
    if (!options.app) {
      const response = await page.request.get("/api/v1/me");
      expect(response.ok()).toBe(true);
      return response.json();
    }
    const response = await page.evaluate(() =>
      window.suiteDesktop!.execute({ operation: "me" }),
    );
    expect(response.status).toBe(200);
    return response.body as Identity;
  };
  const archive = () =>
    page.getByRole("dialog", { name: "Saved-work archives", exact: true });
  const closeArchive = () =>
    archive()
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  const switchProfile = async (afterSelection?: () => Promise<void>) => {
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Switch profile", exact: true })
      .click();
    await afterSelection?.();
    const profiles = page.getByRole("dialog", {
      name: "Saved online profiles",
      exact: true,
    });
    await expect(
      profiles.getByRole("combobox", { name: "Saved account", exact: true }),
    ).toBeVisible();
    await expect(archive()).toHaveCount(0);
    await expect(
      page.getByLabel("Archive passphrase", { exact: true }),
    ).toHaveCount(0);
    return profiles;
  };
  const before = await portabilityStorage(page, scope);
  const pending = await holdArchiveAuthority(page, options.app);
  let held = false;
  try {
    await archive().getByRole("checkbox").first().check();
    await archive()
      .getByRole("button", { name: "Import selected copies", exact: true })
      .click();
    await pending.arrived();
    held = true;
    await closeArchive();
    const profiles = await switchProfile(async () => {
      if (options.app) {
        await expect
          .poll(() =>
            page.evaluate(async (userId) => {
              try {
                await window.suiteDesktop!.accountRevision(userId);
                return true;
              } catch {
                return false;
              }
            }, scope.userId),
          )
          .toBe(false);
      } else {
        await expect
          .poll(async () => (await page.request.get("/api/v1/me")).status())
          .toBe(401);
      }
      await pending.release();
      held = false;
    });
    await profiles
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  } finally {
    if (held) await pending.release();
    await pending.dispose();
  }

  if (options.app) {
    // Controlled development provider selection; the API issues the actual new session.
    await options.app.evaluate(() => {
      const original = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (new URL(url).pathname === "/auth/development") {
          globalThis.fetch = original;
          return original(input, {
            ...init,
            body: JSON.stringify({ email: "sales@demo.local" }),
          });
        }
        return original(input, init);
      };
    });
  } else {
    await selectValue(page, "Local demonstration account", "sales@demo.local");
  }
  await page
    .getByRole("button", {
      name: options.app ? "Open local workspace" : "Open workspace",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  const otherIdentity = await identity();
  expect(otherIdentity.user.email).toBe("sales@demo.local");
  expect(otherIdentity.user.id).not.toBe(scope.userId);
  expect(
    otherIdentity.workspaces.map((workspace) => workspace.id),
  ).not.toContain(scope.workspaceId);
  const personal = otherIdentity.workspaces.find(
    (workspace) => workspace.kind === "personal",
  )!;
  expect(personal).toBeDefined();
  const other = { userId: otherIdentity.user.id, workspaceId: personal.id };
  await selectValue(page, "Workspace", personal.id);
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
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
  const stored = await portabilityStorage(page, other);
  expect(stored?.recoveryImports ?? {}).toEqual({});
  expect(stored?.journal ?? []).toEqual([]);
  expect(stored?.drafts ?? {}).toEqual({});
  if (options.app) {
    const result = await page.evaluate(async (scope) => {
      try {
        await window.suiteDesktop!.cacheRead(scope, "module-state");
        return true;
      } catch {
        return false;
      }
    }, scope);
    expect(result).toBe(false);
    if (!nativeHandle || !nativeArchive)
      throw Error("The original native export fixture is missing.");
    const path = `${file.path}.other-profile`;
    await options.app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
    const exported = await page.evaluate(
      async ({ handle, content, passphrase }) => {
        try {
          await window.suiteDesktop!.exportWorkArchive(
            handle,
            content,
            passphrase,
          );
          return true;
        } catch {
          return false;
        }
      },
      {
        handle: nativeHandle,
        content: JSON.stringify(nativeArchive),
        passphrase,
      },
    );
    expect(exported).toBe(false);
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  }
  await captureArchive(page, `${options.surface}-profile-denied`, false);
  await closeArchive();
  const profiles = await switchProfile();
  await selectValue(page, "Saved account", scope.userId);
  await profiles
    .getByRole("button", { name: "Continue with this account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  expect((await identity()).user.id).toBe(scope.userId);
  await selectValue(page, "Workspace", scope.workspaceId);
  await settings();
  const after = await portabilityStorage(page, scope);
  expect(after.recoveryImports ?? {}).toEqual(before.recoveryImports ?? {});
  expect(after.journal).toEqual(before.journal);
  expect(after.drafts).toEqual(before.drafts);
  await open();
  await expect(archive().getByRole("checkbox")).toHaveCount(2);
  for (const checkbox of await archive().getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked();
  expect(await readFile(file.path)).toEqual(file.bytes);
  return page;
}

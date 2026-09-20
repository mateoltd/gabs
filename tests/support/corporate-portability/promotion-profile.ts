import { expect, type ElectronApplication, type Page } from "@playwright/test";
import { assertSchema } from "@suite/module-sdk";
import { ProfileRecoverySchema } from "../../../packages/contracts/src";
import type { operations } from "../../../packages/client/src/api";
import type { Scope } from "../../../packages/client/src";
import { selectValue } from "../../e2e/controls.helpers";

type Identity =
  operations["me"]["responses"][200]["content"]["application/json"];

export async function recoverySession(page: Page) {
  const response = await page.evaluate(() =>
    window.suiteDesktop!.execute({ operation: "profileRecovery" }),
  );
  expect(response.status).toBe(200);
  assertSchema(ProfileRecoverySchema, response.body);
  return response.body;
}

/** Replace the locked actor through real sign-in, then release its obsolete restoration. */
export async function replacePromotionProfile(options: {
  page: Page;
  app: ElectronApplication;
  scope: Scope;
  release(): Promise<void>;
}) {
  const { page, app, scope } = options;
  await page
    .getByRole("button", { name: "Sign in online", exact: true })
    .click();
  // Only select the development provider identity; the API issues the real new session.
  await app.evaluate(() => {
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
  await page
    .getByRole("button", { name: "Open local workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  const response = await page.evaluate(() =>
    window.suiteDesktop!.execute({ operation: "me" }),
  );
  expect(response.status).toBe(200);
  const identity = response.body as Identity;
  expect(identity.user.email).toBe("sales@demo.local");
  expect(identity.user.id).not.toBe(scope.userId);
  expect(identity.workspaces.map((workspace) => workspace.id)).not.toContain(
    scope.workspaceId,
  );
  const personal = identity.workspaces.find(
    (workspace) => workspace.kind === "personal",
  )!;
  expect(personal).toBeDefined();
  await selectValue(page, "Workspace", personal.id);
  await options.release();
  await expect(
    page.getByRole("dialog", { name: "Imported saved work", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Saved work restored for review.", { exact: false }),
  ).toHaveCount(0);
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
  const denied = await page.evaluate(
    (workspaceId) =>
      window.suiteDesktop!.execute({
        operation: "bootstrap",
        params: { workspaceId },
      }),
    scope.workspaceId,
  );
  expect([403, 404]).toContain(denied.status);
  const otherState = (await page.evaluate(
    (scope) => window.suiteDesktop!.cacheRead(scope, "module-state"),
    {
      userId: identity.user.id,
      workspaceId: personal.id,
    },
  )) as
    | { recoveryImports?: object; journal?: unknown[]; drafts?: object }
    | undefined;
  expect(otherState?.recoveryImports ?? {}).toEqual({});
  expect(otherState?.journal ?? []).toEqual([]);
  expect(otherState?.drafts ?? {}).toEqual({});
  expect(
    await page.evaluate(() => localStorage.getItem("suite-workspace")),
  ).toBe(personal.id);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Switch profile", exact: true })
    .click();
  const profiles = page.getByRole("dialog", {
    name: "Saved online profiles",
    exact: true,
  });
  await selectValue(page, "Saved account", scope.userId);
  await profiles
    .getByRole("button", { name: "Continue with this account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  const renewed = await recoverySession(page);
  expect(renewed.userId).toBe(scope.userId);
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
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  return renewed;
}

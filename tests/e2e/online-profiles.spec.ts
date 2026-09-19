import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { setupOfflinePolicy } from "../support/offline-policy-fixture";
import { selectValue } from "./controls.helpers";
async function switchProfile(page: Page, offline = false) {
  const reloaded = offline ? page.waitForEvent("domcontentloaded") : undefined;
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Switch profile", exact: true })
    .click();
  await reloaded;
}
async function savedProfiles(page: Page) {
  const dialog = page.getByRole("dialog", {
    name: "Saved online profiles",
    exact: true,
  });
  const trigger = page.getByRole("button", {
    name: "Saved online profiles",
    exact: true,
  });
  await expect(dialog.or(trigger).first()).toBeVisible();
  if (!(await dialog.isVisible())) await trigger.click();
  await expect(
    dialog.getByRole("combobox", { name: "Saved account", exact: true }),
  ).toBeVisible();
  return dialog;
}
test("saved accounts switch with fresh authentication, retain original work and support forgetting and re-adding", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setupOfflinePolicy(page);
  await context.setOffline(true);
  const original = await f.capture();
  await switchProfile(page, true);
  expect((await f.stored()).state.journal).toEqual([original]);
  await context.setOffline(false);
  await page.reload();
  let dialog = await savedProfiles(page);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await selectValue(page, "Local demonstration account", "sales@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  const b = await (await page.request.get("/api/v1/me")).json();
  expect(b.user.id).not.toBe(f.scope.userId);
  expect(
    b.workspaces.some((w: { id: string }) => w.id === f.scope.workspaceId),
  ).toBe(false);
  expect((await f.stored()).state.journal).toEqual([original]);
  await switchProfile(page);
  dialog = await savedProfiles(page);
  await selectValue(page, "Saved account", f.scope.userId);
  await mkdir("docs/verification/online-profiles", { recursive: true });
  await page.screenshot({
    path: "docs/verification/online-profiles/chooser-wide.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Continue with this account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  expect((await (await page.request.get("/api/v1/me")).json()).user.id).toBe(
    f.scope.userId,
  );
  await selectValue(page, "Workspace", f.scope.workspaceId);
  await expect
    .poll(async () => (await f.stored()).state.journal[0]?.state, {
      timeout: 25000,
    })
    .toBe("accepted");
  expect((await f.stored()).state.journal[0]).toMatchObject({
    id: original.id,
    call: original.call,
  });
  const fresh = await (await page.request.get("/api/v1/me")).json();
  const result = await page.request.post(f.records, {
    headers: {
      origin: "http://localhost:4300",
      "x-csrf-token": fresh.csrfToken,
      "x-module-version": original.call.moduleVersion!,
    },
    data: { resource: "contacts", action: "list", input: {} },
  });
  expect(result.ok(), await result.text()).toBe(true);
  expect((await result.json()).items).toMatchObject([
    { version: 2, data: { phone: "Saved offline" } },
  ]);
  await switchProfile(page);
  dialog = await savedProfiles(page);
  await selectValue(page, "Saved account", f.scope.userId);
  await dialog
    .getByRole("button", { name: "Forget this profile", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/verification/online-profiles/forget-narrow.png",
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Remove saved sign-in", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Saved account", exact: true }),
  ).toContainText("Sam Rivera");
  expect((await f.stored()).state.journal[0].id).toBe(original.id);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await selectValue(page, "Local demonstration account", "owner@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  await switchProfile(page);
  dialog = await savedProfiles(page);
  await selectValue(page, "Saved account", f.scope.userId);
  await expect(
    dialog.getByRole("combobox", { name: "Saved account", exact: true }),
  ).toContainText("Alex Morgan");
});
test("a saved-profile sign-in rejects a provider response for a different account", async ({
  page,
}) => {
  const f = await setupOfflinePolicy(page);
  await switchProfile(page);
  let dialog = await savedProfiles(page);
  await page.route("**/auth/development", async (route) => {
    const response = await route.fetch({
      postData: JSON.stringify({ email: "sales@demo.local" }),
    });
    await route.fulfill({ response });
  });
  await dialog
    .getByRole("button", { name: "Continue with this account", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "different account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await page.request.get("/api/v1/me")).status())
    .toBe(401);
  await page.unroute("**/auth/development");
  dialog = await savedProfiles(page);
  await expect(
    dialog.getByRole("combobox", { name: "Saved account", exact: true }),
  ).toContainText("Alex Morgan");
  await dialog
    .getByRole("button", { name: "Continue with this account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  expect((await (await page.request.get("/api/v1/me")).json()).user.id).toBe(
    f.scope.userId,
  );
});

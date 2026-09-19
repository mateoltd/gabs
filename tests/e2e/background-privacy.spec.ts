import "dotenv/config";
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { setupOfflinePolicy } from "../support/offline-policy-fixture";

const root = "html[data-background-privacy]";
test("background privacy covers corporate editors and portals without losing pending or unsaved work", async ({
  page,
  context,
}) => {
  const f = await setupOfflinePolicy(page);
  await context.setOffline(true);
  const original = await f.capture();
  await page
    .getByRole("row")
    .filter({ hasText: "Policy contact" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page
    .getByLabel("Phone", { exact: true })
    .fill("Unsubmitted private input");
  await page.getByRole("combobox", { name: "Kind", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(root)).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.inert)).toBe(true);
  // A portal added after backgrounding is covered too, including descendants
  // that explicitly request visibility. It cannot escape its parent's opacity.
  await page.evaluate(() => {
    const portal = document.createElement("div");
    portal.id = "late-private-portal";
    portal.style.transition = "opacity 10s";
    portal.innerHTML =
      '<span style="visibility:visible">Private portal contents</span>';
    document.body.append(portal);
  });
  await expect(page.locator("#late-private-portal")).toHaveCSS("opacity", "0");
  await expect(page.locator("#late-private-portal")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await page.keyboard.press("Enter");
  await mkdir("docs/verification/background-privacy", { recursive: true });
  await page.screenshot({
    path: "docs/verification/background-privacy/covered-wide.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/verification/background-privacy/covered-narrow.png",
    animations: "disabled",
  });
  expect((await f.stored()).state.journal).toEqual([original]);
  await page.evaluate(() => {
    document.getElementById("late-private-portal")?.remove();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator(root)).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator(root)).toHaveCount(0);
  expect(await page.evaluate(() => document.body.inert)).toBe(false);
  await expect(
    page.getByRole("dialog", { name: "Edit record", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Phone", { exact: true })).toHaveValue(
    "Unsubmitted private input",
  );
  expect((await f.stored()).state.journal).toEqual([original]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "docs/verification/background-privacy/restored-editor.png",
    animations: "disabled",
  });
});

test("a backgrounded reload stays covered until visibility and focus return", async ({
  page,
}) => {
  const f = await setupOfflinePolicy(page);
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
  });
  await page.reload();
  await expect(page.locator(root)).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(root)).toHaveCount(1);
  await page.evaluate(() => {
    delete (document as unknown as Record<string, unknown>).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  expect((await f.stored()).snapshot.bootstrap.workspace.id).toBe(
    f.scope.workspaceId,
  );
});

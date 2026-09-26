import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";

export async function organizationIssuesJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  native = false,
) {
  const params = { workspaceId };
  const state = async () =>
    (await send({ operation: "platformState", params })).body as PlatformState;
  const initial = (await state()).organization!;
  const { version, ...policy } = initial;
  const sales = policy.ranks.find((r) => r.name === "Sales")!;
  const warehouse = policy.ranks.find((r) => r.name === "Warehouse")!;
  const viewer = policy.ranks.find((r) => r.name === "Viewer")!;
  sales.parents = [policy.rootId];
  warehouse.parents = [sales.id];
  viewer.parents = [warehouse.id];
  const write = (value: typeof policy, revision: number) =>
    send({
      operation: "platformCommand",
      params,
      body: { action: "organization", value, version: revision },
      idempotencyKey: crypto.randomUUID(),
    });
  expect((await write(policy, version)).status).toBe(200);
  const before = (await state()).organization!;
  // Direct malicious requests must be rejected independently of the editor guards.
  for (const parents of [[], [warehouse.id, policy.rootId]]) {
    const invalid = structuredClone(policy);
    invalid.ranks.find((r) => r.id === sales.id)!.parents = parents;
    expect((await write(invalid, before.version)).status).toBe(400);
    expect((await state()).organization).toEqual(before);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  const chart = page.getByRole("group", {
    name: "Organization hierarchy",
    exact: true,
  });
  const node = (name: string) =>
    chart.getByRole("button", { name: `Configure ${name}`, exact: true });
  const save = page.getByRole("button", {
    name: "Save organization",
    exact: true,
  });
  const arrange = page.getByRole("button", { name: "Arrange", exact: true });
  const issues = page.getByRole("region", {
    name: "Organization issues",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Sales", exact: true });
  await node("Sales").focus();
  await node("Sales").press("Enter");
  await dialog
    .getByRole("checkbox", { name: "Administrador", exact: true })
    .uncheck();
  await expect(dialog.getByRole("alert")).toContainText(/orphan|root|connect/i);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(issues).toBeVisible();
  await expect(chart.locator('[data-invalid="true"]')).toHaveCount(3);
  await expect(save).toBeDisabled();
  await expect(arrange).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Sales: orders.export", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "Resolve organization issues" }),
  ).toBeVisible();
  expect((await state()).organization).toEqual(before);
  const folder = "docs/verification/organization-issues";
  await mkdir(folder, { recursive: true });
  const prefix = native ? "desktop" : "web";
  await issues.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-orphan.png` });
  await issues
    .getByRole("button", { name: "Review Sales", exact: true })
    .click();
  await dialog
    .getByRole("checkbox", { name: "Administrador", exact: true })
    .check();
  await dialog
    .getByRole("checkbox", { name: "Warehouse", exact: true })
    .check();
  await expect(dialog.getByRole("alert")).toContainText(/cycle/i);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(chart.locator('[data-invalid="true"]')).toHaveCount(2);
  await expect(node("Viewer")).not.toHaveAttribute("data-invalid");
  await expect(node("Sales")).toHaveAccessibleDescription(/cycle/i);
  await expect(save).toBeDisabled();
  await expect(arrange).toBeDisabled();
  await node("Sales").focus();
  await node("Sales").press("Tab");
  await expect(node("Warehouse")).toBeFocused();
  await expect(node("Warehouse").locator("rect")).toHaveCSS(
    "stroke-dasharray",
    "4px, 2px",
  );
  await issues.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-cycle.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await node("Sales").press("Enter");
  await expect(dialog).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${folder}/${prefix}-repair-narrow.png` });
  await dialog
    .getByRole("checkbox", { name: "Warehouse", exact: true })
    .uncheck();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(issues).toHaveCount(0);
  await expect(chart.locator('[data-invalid="true"]')).toHaveCount(0);
  await expect(arrange).toBeEnabled();
  await expect(save).toBeEnabled();
  await save.click();
  await expect
    .poll(async () => (await state()).organization!.version)
    .toBe(before.version + 1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(chart.getByRole("button")).toHaveCount(policy.ranks.length);
  await expect(issues).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect((await state()).organization!.ranks).toEqual(policy.ranks);
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: `${folder}/${prefix}-repaired.png` });
}
